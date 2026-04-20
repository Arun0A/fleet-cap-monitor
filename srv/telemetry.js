const cds = require('@sap/cds');
const { INSERT, UPDATE } = cds.ql;

/**
 * Telemetry processing helper
 * - inserts Telemetry
 * - updates Device.lastSeen
 * - checks thresholds and creates Alerts
 * - emits in-process AlertCreated and attempts to publish to messaging adapters
 */
module.exports = {
  ingestTelemetry: async function (data, srv) {
    const Telemetry = (srv.entities && srv.entities.Telemetry) || 'fleet.Telemetry';
    const Devices = (srv.entities && srv.entities.Devices) || 'fleet.Devices';
    const Alerts = (srv.entities && srv.entities.Alerts) || 'fleet.Alerts';

    if (!data) throw new Error('ingestTelemetry requires device identifier and value');
    // support both `device_ID` (used internally) and `deviceID` (CDS action param)
    if (!data.device_ID && !data.deviceID) throw new Error('ingestTelemetry requires device_ID or deviceID and value');
    if (!data.value && data.value !== 0) throw new Error('ingestTelemetry requires numeric value');
    const deviceId = data.device_ID || data.deviceID;

    const now = new Date().toISOString();
    const numericValue = Number(data.value);
    const threshold = data.threshold != null ? Number(data.threshold) : 100;
    const telemetry = {
      ID: cds.utils && cds.utils.uuid ? cds.utils.uuid() : ('' + Date.now()),
      device_ID: deviceId,
      metric: data.metric || 'unknown',
      value: numericValue,
      recordedAt: now
    };

    await cds.run(INSERT.into(Telemetry).entries(telemetry));

    // update device lastSeen if device exists
    try {
      await cds.run(UPDATE(Devices).set({ lastSeen: now }).where({ ID: deviceId }));
    } catch (e) {
      // ignore if device not present during dev
    }

    // threshold detection: either provided threshold or default
    if (Number.isFinite(numericValue) && numericValue > threshold) {
      const alert = {
        ID: cds.utils && cds.utils.uuid ? cds.utils.uuid() : ('' + (Date.now() + 1)),
        telemetry_ID: telemetry.ID,
        device_ID: telemetry.device_ID,
        description: data.description || `Value ${numericValue} exceeded threshold ${threshold}`,
        isAlert: true,
        createdAt: now
      };

      await cds.run(INSERT.into(Alerts).entries(alert));

      const payload = { alertID: alert.ID, deviceID: alert.device_ID };

      // in-process emit
      try {
        srv.emit && srv.emit('AlertCreated', payload);
      } catch (e) {
        // ignore
      }

      // try to publish via messaging adapter (Event Mesh)
      try {
        const messaging = await cds.connect.to('messaging');
        if (messaging) {
          if (typeof messaging.publish === 'function') {
            await messaging.publish('AlertCreated', payload);
          } else if (typeof messaging.emit === 'function') {
            await messaging.emit('AlertCreated', payload);
          } else if (typeof messaging.send === 'function') {
            await messaging.send({ event: 'AlertCreated', data: payload });
          }
        }
      } catch (e) {
        // don't fail telemetry ingestion if messaging is not available
        // console.warn('[telemetry] messaging publish failed', e && e.message);
      }

      // Also create a WorkOrder immediately (simple demo-friendly behavior)
      try {
        const WorkOrders = (srv.entities && srv.entities.WorkOrders) || 'fleet.WorkOrders';
        const work = {
          ID: cds.utils && cds.utils.uuid ? cds.utils.uuid() : ('' + (Date.now() + 2)),
          workNo: 'WO-' + (new Date()).getTime(),
          device_ID: alert.device_ID,
          alert_ID: alert.ID,
          status: 'Open',
          description: `Auto-generated from alert ${alert.ID}`,
          createdAt: now
        };
        await cds.run(INSERT.into(WorkOrders).entries(work));
      } catch (e) {
        // non-fatal for telemetry ingestion
      }

      return { telemetry, alert };
    }

    return { telemetry };
  }
};
