const cds = require('@sap/cds');

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

    if (!data || !data.device_ID) throw new Error('ingestTelemetry requires device_ID and value');

    const now = new Date().toISOString();
    const telemetry = {
      ID: cds.utils && cds.utils.uuid ? cds.utils.uuid() : ('' + Date.now()),
      device_ID: data.device_ID,
      metric: data.metric || 'unknown',
      value: data.value,
      recordedAt: now
    };

    await cds.run(INSERT.into(Telemetry).entries(telemetry));

    // update device lastSeen if device exists
    try {
      await cds.run(UPDATE(Devices).set({ lastSeen: now }).where({ ID: data.device_ID }));
    } catch (e) {
      // ignore if device not present during dev
    }

    // threshold detection: either provided threshold or default
    const threshold = typeof data.threshold === 'number' ? data.threshold : 100;
    if (typeof data.value === 'number' && data.value > threshold) {
      const alert = {
        ID: cds.utils && cds.utils.uuid ? cds.utils.uuid() : ('' + (Date.now() + 1)),
        telemetry_ID: telemetry.ID,
        device_ID: telemetry.device_ID,
        description: data.description || `Value ${data.value} exceeded threshold ${threshold}`,
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

      return { telemetry, alert };
    }

    return { telemetry };
  }
};
