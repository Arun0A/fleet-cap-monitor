#!/usr/bin/env bash
set -euo pipefail

# Query the running FleetService and pretty-print Devices, Alerts and WorkOrders
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

HOST=${1:-http://localhost:4004}

echo "Querying service at $HOST..."

ENDPOINTS=(
  "/api/fleet/Devices"
  "/api/fleet/Alerts"
  "/api/fleet/WorkOrders"
  "/api/fleet/Telemetry"
)

pretty() {
  if command -v jq >/dev/null 2>&1; then
    jq '.'
  else
    # Node fallback: try to parse and pretty-print JSON
    node -e "let s=''; process.stdin.on('data',c=>s+=c); process.stdin.on('end',()=>{try{console.log(JSON.stringify(JSON.parse(s),null,2));}catch(e){console.log(s);} });"
  fi
}

for ep in "${ENDPOINTS[@]}"; do
  echo
  echo "==> $ep"
  curl -s "$HOST$ep" | pretty || echo "(no data or service unavailable)"
done

echo
echo "Done."
