const cds = require('@sap/cds');

/**
 * Event handlers for O2C domain events.
 * Exposes a register function to wire up in-process subscriptions and
 * a handler function that can be invoked by external event subscribers.
 */

module.exports = {
  register: function (srv) {
    // In-process subscription: other parts of the app can emit 'OrderConfirmed'
    srv.on('OrderConfirmed', async (msg) => {
      try {
        await module.exports.handleOrderConfirmed(msg, srv);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[EVENT] error handling OrderConfirmed', e && e.message);
      }
    });
  },

  /**
   * Handle an OrderConfirmed event payload by creating a Delivery record
   * for the confirmed sales order. This mirrors the behavior of the
   * `createDelivery` action so the flow works whether triggered by events
   * or by direct action calls.
   *
   * payload: { orderID, plannedDate?, carrier? }
   */
  handleOrderConfirmed: async function (payload, srv) {
    const { SalesOrders, Deliveries } = srv.entities;

    const { orderID, plannedDate, carrier } = payload || {};
    if (!orderID) throw new Error('OrderConfirmed payload missing orderID');

    const order = await SELECT.one.from(SalesOrders, orderID);
    if (!order) throw Object.assign(new Error('Sales Order not found'), { code: 404 });
    if (order.status !== 'Confirmed') throw Object.assign(new Error('Only Confirmed orders can be delivered'), { code: 400 });

    const existing = await SELECT.one.from(Deliveries).where({ order_ID: orderID });
    if (existing) throw Object.assign(new Error('A delivery document already exists for this order'), { code: 409 });

    const delivery = {
      ID:          cds.utils.uuid(),
      order_ID:    orderID,
      plannedDate: plannedDate || new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().split('T')[0],
      status:      'Pending',
      carrier:     carrier || 'Standard Courier',
    };

    await INSERT.into(Deliveries).entries(delivery);
    await UPDATE(SalesOrders, orderID).with({ status: 'Delivered' });

    return delivery;
  }
};
