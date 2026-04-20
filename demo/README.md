Demo run helper
================

This folder contains a small helper script to run the local demo: it deploys the CDS model into `dev.db`, starts the CAP dev server and the worker, and sends a sample telemetry payload to trigger an alert.

Usage
-----
From the project root:

```bash
chmod +x demo/run-demo.sh
./demo/run-demo.sh
```

The script writes logs to `demo/app.log` and `demo/worker.log`.

Notes
-----
- The script uses `npx cds deploy --to sqlite:./dev.db` to create the database tables. If you prefer to run the deploy manually, run that command in the project root first.
- The script starts the CAP server with `cds watch` which is convenient for development.
- If you run into port conflicts, stop other services using port 4004 or edit `manifest.yml` / CDS settings as needed.
