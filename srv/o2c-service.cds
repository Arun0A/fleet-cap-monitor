/**
 * O2C OData Service Definition
 * Exposes all O2C entities and defines business action endpoints.
 */

using o2c from '../db/schema';

service O2CService @(path: '/api/o2c') {

  // ── Master Data ──────────────────────────────────────────────────────────

  entity Customers   as projection on o2c.Customers;
  entity Products    as projection on o2c.Products;

  // ── Transactional Entities ────────────────────────────────────────────────

  entity SalesOrders as projection on o2c.SalesOrders
    actions {
      /** Confirm a Draft order — moves it to 'Confirmed' status */
      action confirmOrder() returns SalesOrders;

      /** Cancel an order (only if Draft or Confirmed) */
      action cancelOrder() returns SalesOrders;
    };

  entity SalesOrderItems as projection on o2c.SalesOrderItems;

  entity Deliveries  as projection on o2c.Deliveries
    actions {
      /** Mark a Pending delivery as Shipped */
      action markShipped(trackingNo: String, carrier: String) returns Deliveries;

      /** Mark a Shipped delivery as Delivered */
      action markDelivered() returns Deliveries;
    };

  entity Invoices    as projection on o2c.Invoices
    actions {
      /** Record payment against an invoice */
      action recordPayment(paymentRef: String) returns Invoices;
    };

  // ── Unbound Business Process Actions ─────────────────────────────────────

  /** Create a delivery document for a Confirmed Sales Order */
  action createDelivery(
    orderID     : UUID,
    plannedDate : Date,
    carrier     : String
  ) returns o2c.Deliveries;

  /** Generate an invoice for a Delivered Sales Order */
  action generateInvoice(
    orderID : UUID
  ) returns o2c.Invoices;

  // ── Analytics Queries ─────────────────────────────────────────────────────

  /** Summary view for dashboard */
  function getOrderSummary() returns array of {
    status       : String;
    count        : Integer;
    totalRevenue : Decimal;
  };
}
