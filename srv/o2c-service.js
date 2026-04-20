'use strict';

/**
 * Fleet Service Implementation
 * Contains custom handlers for telemetry ingestion, alerting and work order flows.
 */

const cds = require('@sap/cds');
const { INSERT, SELECT, UPDATE } = cds.ql;

module.exports = cds.service.impl(async function (srv) {

  const { Devices, Technicians, Telemetry, Alerts, WorkOrders } = srv.entities;

  // Register in-process event handlers
  const eventHandlers = require('./event-handlers');
  eventHandlers.register(srv);

  // telemetry helper
  const telemetry = require('./telemetry');

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

  /** Generate a work order number like WO-20260001 */
  function generateWorkNo() {
    const year = new Date().getFullYear();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `WO-${year}${rand}`;
  }

  /** Add N days to a Date and return ISO date string */
  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  }

  // ── Sales Order: BEFORE CREATE ────────────────────────────────────────────

  // Auto-set device lastSeen when telemetry is ingested (handled in ingestTelemetry)

  // Unbound Action: registerDevice
  srv.on('registerDevice', async (req) => {
    if (!_hasScope(req, 'Device.manage')) return req.error(403, 'Forbidden: requires Device.manage scope');
    const { deviceId, name, model } = req.data;
    if (!deviceId) return req.error(400, 'deviceId is required');

    const existing = await SELECT.one.from(Devices).where({ deviceId });
    if (existing) return req.error(409, `Device '${deviceId}' already exists`);

    const device = { ID: cds.utils.uuid(), deviceId, name, model };
    await cds.run(INSERT.into(Devices).entries(device));
    return SELECT.one.from(Devices, device.ID);
  });

  // Unbound Action: ingestTelemetry (keeps event/alert logic above)
  srv.on('ingestTelemetry', async (req) => {
    if (!_hasScope(req, 'Telemetry.ingest')) return req.error(403, 'Forbidden: requires Telemetry.ingest scope');
    try {
      const result = await telemetry.ingestTelemetry(req.data, srv);
      return result;
    } catch (e) {
      console.error('[srv] ingestTelemetry error', e && e.message);
      return req.error(500, e && e.message);
    }
  });

  // Fleet: assign a work order to a technician
  srv.on('assignWorkOrder', 'WorkOrders', async (req) => {
    if (!_hasScope(req, 'WorkOrder.manage')) return req.error(403, 'Forbidden: requires WorkOrder.manage scope');
    const workID = req.params[0]?.ID ?? req.params[0];
    const { technicianID } = req.data;
    const tech = await SELECT.one.from(Technicians, technicianID);
    if (!tech) return req.error(404, 'Technician not found');
    await cds.run(UPDATE(WorkOrders, workID).with({ assignedTo_ID: technicianID, status: 'Assigned' }));
    return SELECT.one.from(WorkOrders, workID);
  });

  // Fleet: mark a work order completed
  srv.on('completeWorkOrder', 'WorkOrders', async (req) => {
    if (!_hasScope(req, 'WorkOrder.manage')) return req.error(403, 'Forbidden: requires WorkOrder.manage scope');
    const workID = req.params[0]?.ID ?? req.params[0];
    await cds.run(UPDATE(WorkOrders, workID).with({ status: 'Completed', closedAt: new Date().toISOString() }));
    return SELECT.one.from(WorkOrders, workID);
  });

  // Unbound createWorkOrder (manual)
  srv.on('createWorkOrder', async (req) => {
    if (!_hasScope(req, 'WorkOrder.manage')) return req.error(403, 'Forbidden: requires WorkOrder.manage scope');
    const { alertID, description } = req.data;
    if (!alertID) return req.error(400, 'alertID is required');

    const alert = await SELECT.one.from(Alerts, alertID);
    if (!alert) return req.error(404, 'Alert not found');

    const existing = await SELECT.one.from(WorkOrders).where({ alert_ID: alertID });
    if (existing) return existing;

    const work = {
      ID: cds.utils.uuid(),
      workNo: generateWorkNo(),
      device_ID: alert.device_ID,
      alert_ID: alertID,
      description: description || alert.description || 'Auto-generated from alert',
      status: 'Open'
    };
    await cds.run(INSERT.into(WorkOrders).entries(work));
    return SELECT.one.from(WorkOrders, work.ID);
  });

  // Fleet summary for dashboard
  srv.on('getFleetSummary', async () => {
    const rows = await SELECT.from(WorkOrders).columns('status', 'count(*) as count').groupBy('status');
    return rows.map(r => ({ status: r.status, count: Number(r.count) }));
  });

});
