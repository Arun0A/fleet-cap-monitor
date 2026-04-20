const cds = require('@sap/cds');

/**
 * Event handlers for O2C domain events.
 * Exposes a register function to wire up in-process subscriptions and
 * a handler function that can be invoked by external event subscribers.
 */

module.exports = {
  register: function (srv) {
    // In-process subscription: other parts of the app can emit 'AlertCreated'
    srv.on('AlertCreated', async (msg) => {
      try {
        await module.exports.handleAlertCreated(msg, srv);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[EVENT] error handling AlertCreated', e && e.message);
      }
    });
  },

  /**
   * Handle an AlertCreated event payload by creating a WorkOrder record
   * for the affected device. This mirrors the behavior of the
   * `createWorkOrder` action so the flow works whether triggered by events
   * or by direct action calls.
   *
   * payload: { alertID, deviceID }
   */
  handleAlertCreated: async function (payload, srv) {
    const { Alerts, WorkOrders } = srv.entities;

    const { alertID, deviceID } = payload || {};
    if (!alertID) throw new Error('AlertCreated payload missing alertID');

    const alert = await SELECT.one.from(Alerts, alertID);
    if (!alert) throw Object.assign(new Error('Alert not found'), { code: 404 });

    // avoid duplicate work orders for the same alert
    const existing = await SELECT.one.from(WorkOrders).where({ alert_ID: alertID });
    if (existing) return existing;

    const work = {
      ID: cds.utils.uuid(),
      workNo: `WO-${Date.now()}`,
      device_ID: deviceID,
      alert_ID: alertID,
      status: 'Open',
      description: alert.description || 'Auto-generated from alert'
    };

    await INSERT.into(WorkOrders).entries(work);
    return work;
  }
};
