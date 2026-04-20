#!/usr/bin/env bash
set -euo pipefail

# Demo helper: deploy model to dev.db, start CAP app and worker in background,
# and seed one device + ingest one telemetry event to trigger an alert.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "Installing project dependencies (may take a moment)..."
npm install

echo "Starting CAP dev server in-memory (logs -> demo/app.log)..."
# Run in-memory to avoid file-backed sqlite issues during local demos
npx cds watch --in-memory &> demo/app.log &
APP_PID=$!
sleep 3

echo "Seeding device via OData registerDevice action..."
RESP=$(curl -s -X POST -H "Content-Type: application/json" \
  http://localhost:4004/api/fleet/registerDevice \
  -d '{"deviceId":"demo-device-1","name":"Demo Device","model":"X1"}' || true)

# try to extract returned ID (CDS returns { ID: 'uuid', ... })
DEVICE_ID=$(node -e "try{const r=JSON.parse(process.argv[1]); console.log(r.ID||r.id||''); }catch(e){console.log(''); }" "$RESP")
if [ -z "$DEVICE_ID" ]; then
  echo "Could not parse device ID from response; attempting to lookup by deviceId field..."
  # fallback: query Devices by deviceId
  DEVICE_ID=$(curl -s "http://localhost:4004/api/fleet/Devices?\$filter=deviceId%20eq%20'demo-device-1'" | node -e "let s=''; process.stdin.on('data',c=>s+=c); process.stdin.on('end',()=>{try{const r=JSON.parse(s); if(Array.isArray(r.value)&&r.value[0]) console.log(r.value[0].ID||r.value[0].id||'');}catch(e){}});")
fi

if [ -z "$DEVICE_ID" ]; then
  echo "WARNING: could not determine device UUID. The ingest step may fail if you use a non-UUID value."
  DEVICE_ID="demo-device-1"
fi

echo "Ingesting telemetry to trigger an alert for device ID: $DEVICE_ID"
curl -s -X POST -H "Content-Type: application/json" \
  http://localhost:4004/api/fleet/ingestTelemetry \
  -d "{\"deviceID\":\"$DEVICE_ID\",\"metric\":\"temperature\",\"value\":250}" || true

echo "Demo started. App PID=$APP_PID"
echo "Tail logs: tail -f demo/app.log"

exit 0
