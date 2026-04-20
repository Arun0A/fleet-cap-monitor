/**
 * Order-to-Cash (O2C) Data Model
 * SAP CAP Core Data Services Schema
 * Covers: Customer → Quotation → Sales Order → Delivery → Invoice → Payment
 */

namespace o2c;

// ─────────────────────────────────────────────
// MASTER DATA
// ─────────────────────────────────────────────

/** Customer master — buying party in the O2C cycle */
entity Customers {
  key ID            : UUID;
      name          : String(100) not null;
      email         : String(100);
      phone         : String(20);
      city          : String(50);
      country       : String(50) default 'India';
      creditLimit   : Decimal(13, 2) default 500000;
      isActive      : Boolean default true;
      orders        : Association to many SalesOrders on orders.customer = $self;
      createdAt     : Timestamp @cds.on.insert: $now;
}

/** Product / material master */
entity Products {
  key ID            : UUID;
      code          : String(20) not null;
      name          : String(100) not null;
      description   : String(500);
      unitPrice     : Decimal(13, 2) not null;
      taxRate       : Decimal(5, 2) default 18.00;   // GST %
      stockQty      : Integer default 0;
      unit          : String(10) default 'EA';        // Each, KG, L, etc.
      isActive      : Boolean default true;
      createdAt     : Timestamp @cds.on.insert: $now;
}

// ─────────────────────────────────────────────
// TRANSACTIONAL DATA
// ─────────────────────────────────────────────

/** Valid statuses for a Sales Order lifecycle */
type OrderStatus : String(20) enum {
  Draft     = 'Draft';
  Confirmed = 'Confirmed';
  Delivered = 'Delivered';
  Invoiced  = 'Invoiced';
  Paid      = 'Paid';
  Cancelled = 'Cancelled';
}

/** Sales Order — central document in O2C */
entity SalesOrders {
  key ID            : UUID;
      orderNumber   : String(20);                     // human-readable ref
      orderDate     : Date;
      customer      : Association to Customers not null;
      status        : OrderStatus default 'Draft';
      netAmount     : Decimal(13, 2) default 0;
      taxAmount     : Decimal(13, 2) default 0;
      totalAmount   : Decimal(13, 2) default 0;
      notes         : String(500);
      items         : Composition of many SalesOrderItems on items.order = $self;
      delivery      : Association to one Deliveries on delivery.order = $self;
      invoice       : Association to one Invoices   on invoice.order  = $self;
      createdAt     : Timestamp @cds.on.insert: $now;
      updatedAt     : Timestamp @cds.on.update: $now;
}

/** Line items within a Sales Order */
entity SalesOrderItems {
  key ID            : UUID;
      order         : Association to SalesOrders not null;
      product       : Association to Products not null;
      quantity      : Integer not null;
      unitPrice     : Decimal(13, 2) not null;  // copied from product at order time
      discount      : Decimal(5, 2) default 0;  // % discount per line
      netPrice      : Decimal(13, 2);            // (quantity × unitPrice) × (1 - discount/100)
      taxRate       : Decimal(5, 2);             // copied from product
      taxAmount     : Decimal(13, 2);
      totalPrice    : Decimal(13, 2);            // netPrice + taxAmount
}

/** Delivery document — proof of goods despatch */
entity Deliveries {
  key ID            : UUID;
      order         : Association to SalesOrders not null;
      plannedDate   : Date;
      actualDate    : Date;
      status        : String(20) enum {
                        Pending   = 'Pending';
                        Shipped   = 'Shipped';
                        Delivered = 'Delivered';
                      } default 'Pending';
      trackingNo    : String(50);
      carrier       : String(100);
      createdAt     : Timestamp @cds.on.insert: $now;
}

/** Invoice / billing document */
entity Invoices {
  key ID            : UUID;
      invoiceNumber : String(20);
      order         : Association to SalesOrders not null;
      invoiceDate   : Date;
      dueDate       : Date;
      netAmount     : Decimal(13, 2);
      taxAmount     : Decimal(13, 2);
      totalAmount   : Decimal(13, 2);
      isPaid        : Boolean default false;
      paymentDate   : Timestamp;
      paymentRef    : String(100);
      createdAt     : Timestamp @cds.on.insert: $now;
}
