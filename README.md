# Order-to-Cash (O2C) — SAP CAP Capstone Project

## Overview
A full-stack **Order-to-Cash** business process application built on the **SAP Cloud Application Programming (CAP)** model for the SAP BTP platform.

The application covers the complete O2C cycle:
```
Sales Order (Draft)
    → Confirm Order
    → Create Delivery → Mark Shipped → Mark Delivered
    → Generate Invoice
    → Record Payment  ✓ Paid
```

## Technology Stack
| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Framework | SAP CAP (CDS) |
| OData | CAP auto-generated OData v4 |
| Database (dev) | SQLite (in-memory) |
| Database (prod) | SAP HANA Cloud |
| Frontend | HTML5 / Vanilla JS (Fiori-styled) |
| Testing | Jest + cds.test |

## Project Structure
```
o2c-cap-project/
├── db/
│   ├── schema.cds           # All entity definitions (Customers, Products,
│   │                        #   SalesOrders, SalesOrderItems, Deliveries,
│   │                        #   Invoices)
│   └── data/
│       ├── o2c.Customers.csv  # Seed data — 5 customers
│       └── o2c.Products.csv   # Seed data — 6 products
├── srv/
│   ├── o2c-service.cds      # OData service + action definitions
│   └── o2c-service.js       # Business logic (event handlers)
├── app/
│   └── webapp/
│       └── index.html       # SAP Fiori-styled dashboard UI
├── test/
│   └── o2c.test.js          # Full end-to-end Jest test suite
├── package.json
├── .cdsrc.json
└── README.md
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
#    OData service:  http://localhost:4004/api/o2c
#    UI Dashboard:   http://localhost:4004/app/webapp/index.html
#    CDS Metadata:   http://localhost:4004/$metadata
```

## Running Tests
```bash
npm test
```
Tests cover the full O2C lifecycle: order creation → confirmation → delivery → invoicing → payment.

## API Reference (OData v4)

### Entities
| Entity | URL |
|---|---|
| Customers | `GET /api/o2c/Customers` |
| Products | `GET /api/o2c/Products` |
| Sales Orders | `GET /api/o2c/SalesOrders` |
| Sales Order Items | `GET /api/o2c/SalesOrderItems` |
| Deliveries | `GET /api/o2c/Deliveries` |
| Invoices | `GET /api/o2c/Invoices` |

### Actions
| Action | Method | URL |
|---|---|---|
| Confirm Order | POST | `/api/o2c/SalesOrders({id})/O2CService.confirmOrder` |
| Cancel Order | POST | `/api/o2c/SalesOrders({id})/O2CService.cancelOrder` |
| Create Delivery | POST | `/api/o2c/createDelivery` |
| Mark Shipped | POST | `/api/o2c/Deliveries({id})/O2CService.markShipped` |
| Mark Delivered | POST | `/api/o2c/Deliveries({id})/O2CService.markDelivered` |
| Generate Invoice | POST | `/api/o2c/generateInvoice` |
| Record Payment | POST | `/api/o2c/Invoices({id})/O2CService.recordPayment` |
| Order Summary | GET | `/api/o2c/getOrderSummary()` |

## Deployment to SAP BTP
1. Install Cloud Foundry CLI and MBT tool
2. Update `package.json` to use `@sap/hana-client` for production
3. `mbt build && cf deploy mta_archives/o2c-cap-project_1.0.0.mtar`

## Business Rules Implemented
- Orders must have at least one line item before confirmation
- Credit limit check on order confirmation
- Stock is automatically deducted on confirmation, restored on cancellation
- Duplicate delivery / invoice prevention
- Full status transition validation (Draft → Confirmed → Delivered → Invoiced → Paid)
- Line item pricing auto-populated from product master
- GST (18%) auto-calculated per line

## Author
KIIT Capstone Project — SAP BTP Program
