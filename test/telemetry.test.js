const cds = require('@sap/cds');
const { INSERT, SELECT } = cds;
const telemetry = require('../srv/telemetry');
const eventHandlers = require('../srv/event-handlers');

describe('Telemetry -> Alert -> WorkOrder flow', () => {
  beforeAll(async () => {
    // cds configuration in package.json uses sqlite :memory:, so connect will use in-memory DB
    await cds.connect();
  });

  afterAll(async () => {
    try { await cds.disconnect(); } catch (e) { /* ignore */ }
  });

  test('ingesting high telemetry creates Alert and then WorkOrder', async () => {
    // create a device
    const device = { ID: cds.utils && cds.utils.uuid ? cds.utils.uuid() : ('' + Date.now()), deviceId: 'dev-1', name: 'Device 1' };
    await cds.run(INSERT.into('fleet.Devices').entries(device));

    // ingest telemetry over the default threshold (100)
    const payload = { device_ID: device.ID, value: 250, metric: 'temperature' };
    const result = await telemetry.ingestTelemetry(payload, { entities: null, emit: () => {} });

    expect(result).toBeDefined();
    expect(result.telemetry).toBeDefined();

    // An alert should have been created
    const alert = await cds.run(SELECT.one.from('fleet.Alerts').where({ device_ID: device.ID }));
    expect(alert).toBeDefined();
    expect(alert.isAlert).toBeTruthy();

    // invoke the event handler to create a WorkOrder from this alert
    const work = await eventHandlers.handleAlertCreated({ alertID: alert.ID, deviceID: device.ID }, { entities: { Alerts: 'fleet.Alerts', WorkOrders: 'fleet.WorkOrders' } });
    expect(work).toBeDefined();

    const fetched = await cds.run(SELECT.one.from('fleet.WorkOrders').where({ alert_ID: alert.ID }));
    expect(fetched).toBeDefined();
    expect(fetched.status).toBe('Open');
  }, 20000);
});
