'use strict';

/**
 * O2C Service Implementation
 * ─────────────────────────────────────────────────────────────────────────────
 * Contains all custom event handlers that implement the Order-to-Cash business
 * logic on top of the generated OData service.
 *
 * Flow enforced here:
 *   Draft → (confirmOrder) → Confirmed
 *   Confirmed → (createDelivery) → Delivered
 *   Delivered → (generateInvoice) → Invoiced
 *   Invoiced → (recordPayment) → Paid
 *   Draft|Confirmed → (cancelOrder) → Cancelled
 */

const cds = require('@sap/cds');

module.exports = cds.service.impl(async function (srv) {

  const { Customers, Products, SalesOrders, SalesOrderItems, Deliveries, Invoices } =
    srv.entities;

  // Register in-process event handlers
  const eventHandlers = require('./event-handlers');
  eventHandlers.register(srv);

  // ── Security helpers (scope/role checks) ─────────────────────────────────
  /**
   * Extract scopes from the request (tries several common properties).
   * Returns an array of scope strings, or [] if none found.
   */
  function _getScopes(req) {
    try {
      // Common places where decoded JWT scopes may live
      const candidate = req.user || req.auth && req.auth.decoded || req._ && req._.user || {};
      if (!candidate) return [];
      if (Array.isArray(candidate.scope)) return candidate.scope;
      if (Array.isArray(candidate.scopes)) return candidate.scopes;
      if (typeof candidate.scope === 'string') return candidate.scope.split(/\s+/).filter(Boolean);
      if (typeof candidate.scopes === 'string') return candidate.scopes.split(/\s+/).filter(Boolean);
    } catch (e) {
      /* ignore */
    }
    return [];
  }

  /**
   * Check whether the request has a scope that ends with the given suffix,
   * e.g. check `_hasScope(req, 'Order.manage')` will match `o2c-app.Order.manage`.
   * In local/dev (when not running on CF) this helper permits access if no scopes
   * are present to avoid blocking offline development.
   */
  function _hasScope(req, suffix) {
    const scopes = _getScopes(req);
    if (!scopes || !scopes.length) {
      // Allow when running locally (no CF environment detected)
      if (!process.env.VCAP_SERVICES && process.env.CDS_ENV !== 'cf') {
        // eslint-disable-next-line no-console
        console.log('[SEC] No scopes found - development mode bypass for', suffix);
        return true;
      }
      return false;
    }
    return scopes.some(s => s === suffix || s.endsWith('.' + suffix));
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** Generate a human-readable order number like SO-20250001 */
  function generateOrderNumber() {
    const year = new Date().getFullYear();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `SO-${year}${rand}`;
  }

  /** Generate invoice number like INV-20250001 */
  function generateInvoiceNumber() {
    const year = new Date().getFullYear();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `INV-${year}${rand}`;
  }

  /** Add N days to a Date and return ISO date string */
  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  }

  /** Round a number to 2 decimal places */
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  // ── Sales Order: BEFORE CREATE ────────────────────────────────────────────

  /**
   * Auto-populate order number and order date before inserting a new order.
   */
  srv.before('CREATE', 'SalesOrders', async (req) => {
    const order = req.data;
    if (!order.orderNumber) order.orderNumber = generateOrderNumber();
    if (!order.orderDate)   order.orderDate   = new Date().toISOString().split('T')[0];
  });

  // ── Sales Order Items: BEFORE CREATE ─────────────────────────────────────

  /**
   * When a line item is created:
   *  1. Copy unit price and tax rate from the product master.
   *  2. Calculate netPrice, taxAmount, totalPrice.
   *  3. Validate that enough stock is available.
   */
  srv.before('CREATE', 'SalesOrderItems', async (req) => {
    const item = req.data;

    // Fetch product details
    const product = await SELECT.one.from(Products).where({ ID: item.product_ID });
    if (!product) req.error(404, `Product ${item.product_ID} not found`);

    // Copy pricing from product master
    item.unitPrice = item.unitPrice ?? product.unitPrice;
    item.taxRate   = item.taxRate   ?? product.taxRate;
    item.discount  = item.discount  ?? 0;

    // Calculate line totals
    const gross    = round2(item.quantity * item.unitPrice);
    const discount = round2(gross * (item.discount / 100));
    item.netPrice  = round2(gross - discount);
    item.taxAmount = round2(item.netPrice * (item.taxRate / 100));
    item.totalPrice = round2(item.netPrice + item.taxAmount);

    // Stock check
    if (product.stockQty < item.quantity) {
      req.error(400, `Insufficient stock for product "${product.name}". Available: ${product.stockQty}`);
    }
  });

  // ── Sales Order Items: AFTER CREATE ──────────────────────────────────────

  /**
   * After a line item is saved, roll up totals to the parent Sales Order.
   */
  srv.after('CREATE', 'SalesOrderItems', async (item) => {
    await _recalcOrderTotals(item.order_ID);
  });

  srv.after('UPDATE', 'SalesOrderItems', async (item) => {
    await _recalcOrderTotals(item.order_ID);
  });

  srv.after('DELETE', 'SalesOrderItems', async (item) => {
    await _recalcOrderTotals(item.order_ID);
  });

  /** Recompute and persist net/tax/total amounts on the Sales Order. */
  async function _recalcOrderTotals(orderID) {
    const items = await SELECT.from(SalesOrderItems).where({ order_ID: orderID });
    const netAmount   = round2(items.reduce((s, i) => s + (i.netPrice   || 0), 0));
    const taxAmount   = round2(items.reduce((s, i) => s + (i.taxAmount  || 0), 0));
    const totalAmount = round2(items.reduce((s, i) => s + (i.totalPrice || 0), 0));
    await UPDATE(SalesOrders, orderID).with({ netAmount, taxAmount, totalAmount });
  }

  // ── Bound Action: SalesOrders / confirmOrder ──────────────────────────────

  /**
   * Confirm a Draft Sales Order.
   * Business rules:
   *  - Order must be in Draft status.
   *  - Order must have at least one line item.
   *  - Customer credit limit must not be exceeded.
   */
  srv.on('confirmOrder', 'SalesOrders', async (req) => {
    if (!_hasScope(req, 'Order.manage')) return req.error(403, 'Forbidden: requires Order.manage scope');
    const orderID = req.params[0]?.ID ?? req.params[0];
    const order   = await SELECT.one.from(SalesOrders, orderID)
                          .columns('*', 'customer.creditLimit as creditLimit',
                                        'customer.name as customerName');

    if (!order)                       return req.error(404, 'Sales Order not found');
    if (order.status !== 'Draft')     return req.error(400, `Only Draft orders can be confirmed. Current status: ${order.status}`);

    const items = await SELECT.from(SalesOrderItems).where({ order_ID: orderID });
    if (!items.length)                return req.error(400, 'Cannot confirm an order with no line items');

    if (order.totalAmount > order.creditLimit) {
      return req.error(400, `Order total (${order.totalAmount}) exceeds customer credit limit (${order.creditLimit})`);
    }

    // Deduct stock for each line item
    for (const item of items) {
      await UPDATE(Products, item.product_ID)
        .with({ stockQty: { '-=': item.quantity } });
    }

    await UPDATE(SalesOrders, orderID).with({ status: 'Confirmed' });
    const updated = await SELECT.one.from(SalesOrders, orderID);

    // Publish OrderConfirmed event: 1) in-process (srv.emit) 2) attempt external messaging
    const payload = { orderID, orderNumber: updated.orderNumber, customer: updated.customer_ID };

    try {
      // in-process emission (will be handled by registered subscribers)
      srv.emit('OrderConfirmed', payload);

      // try to publish to an external messaging service (Event Mesh) if configured
      try {
        const messaging = await cds.connect.to('messaging');
        if (messaging) {
          if (typeof messaging.emit === 'function') {
            await messaging.emit('OrderConfirmed', payload);
          } else if (typeof messaging.publish === 'function') {
            await messaging.publish('OrderConfirmed', payload);
          } else if (typeof messaging.send === 'function') {
            await messaging.send('OrderConfirmed', payload);
          }
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.log('[EVENT] external messaging not available, continuing (dev fallback)');
      }
    } catch (e) {
      // do not block confirmOrder success on event delivery failures
      // eslint-disable-next-line no-console
      console.error('[EVENT] failed to publish OrderConfirmed', e && e.message);
    }

    return updated;
  });

  // ── Bound Action: SalesOrders / cancelOrder ───────────────────────────────

  /**
   * Cancel a Sales Order (Draft or Confirmed only).
   * Returns stock if the order was already confirmed.
   */
  srv.on('cancelOrder', 'SalesOrders', async (req) => {
    if (!_hasScope(req, 'Order.manage')) return req.error(403, 'Forbidden: requires Order.manage scope');
    const orderID = req.params[0]?.ID ?? req.params[0];
    const order   = await SELECT.one.from(SalesOrders, orderID);

    if (!order) return req.error(404, 'Sales Order not found');
    if (!['Draft', 'Confirmed'].includes(order.status)) {
      return req.error(400, `Cannot cancel order in status: ${order.status}`);
    }

    // Return stock if order was confirmed
    if (order.status === 'Confirmed') {
      const items = await SELECT.from(SalesOrderItems).where({ order_ID: orderID });
      for (const item of items) {
        await UPDATE(Products, item.product_ID)
          .with({ stockQty: { '+=': item.quantity } });
      }
    }

    await UPDATE(SalesOrders, orderID).with({ status: 'Cancelled' });
    return SELECT.one.from(SalesOrders, orderID);
  });

  // ── Unbound Action: createDelivery ────────────────────────────────────────

  /**
   * Create a Delivery document for a Confirmed Sales Order.
   */
  srv.on('createDelivery', async (req) => {
    if (!_hasScope(req, 'Delivery.manage')) return req.error(403, 'Forbidden: requires Delivery.manage scope');
    const { orderID, plannedDate, carrier } = req.data;
    const order = await SELECT.one.from(SalesOrders, orderID);

    if (!order)                         return req.error(404, 'Sales Order not found');
    if (order.status !== 'Confirmed')   return req.error(400, `Only Confirmed orders can be delivered. Current status: ${order.status}`);

    // Check if delivery already exists
    const existing = await SELECT.one.from(Deliveries).where({ order_ID: orderID });
    if (existing) return req.error(409, 'A delivery document already exists for this order');

    const delivery = {
      ID:          cds.utils.uuid(),
      order_ID:    orderID,
      plannedDate: plannedDate || addDays(new Date(), 3),
      status:      'Pending',
      carrier:     carrier || 'Standard Courier',
    };

    await INSERT.into(Deliveries).entries(delivery);
    await UPDATE(SalesOrders, orderID).with({ status: 'Delivered' });

    return SELECT.one.from(Deliveries, delivery.ID);
  });

  // ── Bound Action: Deliveries / markShipped ────────────────────────────────

  srv.on('markShipped', 'Deliveries', async (req) => {
    if (!_hasScope(req, 'Delivery.manage')) return req.error(403, 'Forbidden: requires Delivery.manage scope');
    const deliveryID = req.params[0]?.ID ?? req.params[0];
    const { trackingNo, carrier } = req.data;
    const delivery = await SELECT.one.from(Deliveries, deliveryID);

    if (!delivery) return req.error(404, 'Delivery not found');
    if (delivery.status !== 'Pending') return req.error(400, `Delivery is already ${delivery.status}`);

    await UPDATE(Deliveries, deliveryID).with({
      status: 'Shipped', trackingNo, carrier,
    });
    return SELECT.one.from(Deliveries, deliveryID);
  });

  // ── Bound Action: Deliveries / markDelivered ──────────────────────────────

  srv.on('markDelivered', 'Deliveries', async (req) => {
    if (!_hasScope(req, 'Delivery.manage')) return req.error(403, 'Forbidden: requires Delivery.manage scope');
    const deliveryID = req.params[0]?.ID ?? req.params[0];
    const delivery   = await SELECT.one.from(Deliveries, deliveryID);

    if (!delivery) return req.error(404, 'Delivery not found');
    if (delivery.status !== 'Shipped') return req.error(400, `Delivery must be Shipped before marking Delivered`);

    await UPDATE(Deliveries, deliveryID).with({
      status:     'Delivered',
      actualDate: new Date().toISOString().split('T')[0],
    });
    return SELECT.one.from(Deliveries, deliveryID);
  });

  // ── Unbound Action: generateInvoice ──────────────────────────────────────

  /**
   * Generate an Invoice for a Delivered Sales Order.
   * Copies amounts from the order; due date = invoice date + 30 days.
   */
  srv.on('generateInvoice', async (req) => {
    if (!_hasScope(req, 'Invoice.manage')) return req.error(403, 'Forbidden: requires Invoice.manage scope');
    const { orderID } = req.data;
    const order = await SELECT.one.from(SalesOrders, orderID);

    if (!order)                         return req.error(404, 'Sales Order not found');
    if (order.status !== 'Delivered')   return req.error(400, `Only Delivered orders can be invoiced. Current status: ${order.status}`);

    const existing = await SELECT.one.from(Invoices).where({ order_ID: orderID });
    if (existing) return req.error(409, 'An invoice already exists for this order');

    const today   = new Date().toISOString().split('T')[0];
    const invoice = {
      ID:            cds.utils.uuid(),
      invoiceNumber: generateInvoiceNumber(),
      order_ID:      orderID,
      invoiceDate:   today,
      dueDate:       addDays(new Date(), 30),
      netAmount:     order.netAmount,
      taxAmount:     order.taxAmount,
      totalAmount:   order.totalAmount,
      isPaid:        false,
    };

    await INSERT.into(Invoices).entries(invoice);
    await UPDATE(SalesOrders, orderID).with({ status: 'Invoiced' });

    return SELECT.one.from(Invoices, invoice.ID);
  });

  // ── Bound Action: Invoices / recordPayment ────────────────────────────────

  /**
   * Record a payment against an Invoice.
   * Marks the invoice paid and moves the Sales Order to 'Paid'.
   */
  srv.on('recordPayment', 'Invoices', async (req) => {
    if (!_hasScope(req, 'Invoice.manage')) return req.error(403, 'Forbidden: requires Invoice.manage scope');
    const invoiceID  = req.params[0]?.ID ?? req.params[0];
    const { paymentRef } = req.data;
    const invoice    = await SELECT.one.from(Invoices, invoiceID);

    if (!invoice)          return req.error(404, 'Invoice not found');
    if (invoice.isPaid)    return req.error(400, 'Invoice is already paid');

    await UPDATE(Invoices, invoiceID).with({
      isPaid:      true,
      paymentDate: new Date().toISOString(),
      paymentRef:  paymentRef || `PAY-${Date.now()}`,
    });

    await UPDATE(SalesOrders, invoice.order_ID).with({ status: 'Paid' });
    return SELECT.one.from(Invoices, invoiceID);
  });

  // ── Function: getOrderSummary ─────────────────────────────────────────────

  /**
   * Returns a grouped count + revenue per order status — used by the dashboard.
   */
  srv.on('getOrderSummary', async () => {
    const rows = await SELECT
      .from(SalesOrders)
      .columns('status', 'count(*) as count', 'sum(totalAmount) as totalRevenue')
      .groupBy('status');
    return rows.map(r => ({
      status:       r.status,
      count:        Number(r.count),
      totalRevenue: round2(Number(r.totalRevenue) || 0),
    }));
  });

});
