# Fleet Monitoring — SAP CAP Capstone Project

## Overview
A full-stack **fleet monitoring** application built on the **SAP Cloud Application Programming (CAP)** model for SAP BTP.

The application covers the fleet flow:
```
Register Device
    → Ingest Telemetry
    → Create Alert on threshold breach
    → Auto-create / manage Work Orders
    → Complete maintenance lifecycle
```

## Technology Stack
| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Framework | SAP CAP (CDS) |
| OData | CAP auto-generated OData v4 |
| Database (dev) | SQLite |
| Database (prod) | SAP HANA Cloud |
| Frontend | HTML5 / Vanilla JS (Fiori-styled) |
| Testing | Jest + cds.test |

## Project Structure
```
fleet-cap-project/
├── db/schema.cds              # Fleet entities: devices, telemetry, alerts, work orders
├── srv/o2c-service.cds        # Fleet OData service + actions
├── srv/o2c-service.js         # Fleet business logic
├── srv/telemetry.js           # Telemetry ingestion helper
├── srv/event-handlers.js      # Alert -> work order event handling
├── app/webapp/index.html      # Fleet dashboard UI
├── test/*.test.js             # Integration tests for fleet flows
└── package.json
```

## Prerequisites
- **Node.js** ≥ 18  ([download](https://nodejs.org))
- **SAP CDS CLI**:
  ```bash
  npm install -g @sap/cds-dk
  ```

## Quick Start (Local Development)
```bash
# 1. Install dependencies
npm install

# 2. Start the application (with live reload)
npm run watch

# 3. Open in browser
#    OData service:  http://localhost:4004/api/fleet
#    UI Dashboard:   http://localhost:4004/app/webapp/index.html
#    CDS Metadata:   http://localhost:4004/$metadata
```

## Running Tests
```bash
npm test
```
Tests cover device registration, telemetry ingestion, alert generation, work-order management, and fleet summary reporting.

## API Reference (OData v4)

### Entities
| Entity | URL |
|---|---|
| Devices | `GET /api/fleet/Devices` |
| Telemetry | `GET /api/fleet/Telemetry` |
| Alerts | `GET /api/fleet/Alerts` |
| Technicians | `GET /api/fleet/Technicians` |
| Work Orders | `GET /api/fleet/WorkOrders` |

### Actions
| Action | Method | URL |
|---|---|---|
| Register Device | POST | `/api/fleet/registerDevice` |
| Ingest Telemetry | POST | `/api/fleet/ingestTelemetry` |
| Create Work Order | POST | `/api/fleet/createWorkOrder` |
| Assign Work Order | POST | `/api/fleet/WorkOrders({id})/FleetService.assignWorkOrder` |
| Complete Work Order | POST | `/api/fleet/WorkOrders({id})/FleetService.completeWorkOrder` |
| Fleet Summary | GET | `/api/fleet/getFleetSummary()` |

## Deployment to SAP BTP
1. Install Cloud Foundry CLI and MBT tool
2. Update `package.json` to use `@sap/hana-client` for production
3. `mbt build && cf deploy mta_archives/o2c-cap-project_1.0.0.mtar`

## Business Rules Implemented
- Duplicate device IDs are rejected
- Telemetry updates `lastSeen` on the device
- Threshold breaches create alerts automatically
- Alerts create work orders without duplication
- Work orders can be assigned and completed through bound actions

## Author
KIIT Capstone Project — SAP BTP Program
