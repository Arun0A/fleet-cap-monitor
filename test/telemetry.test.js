'use strict';

const cds = require('@sap/cds');
const { GET, POST, axios } = cds.test(__dirname + '/..');

axios.defaults.validateStatus = () => true;

const API = '/api/fleet';

function uniqueId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function rows(entity) {
  const res = await GET(`${API}/${entity}`);
  expect(res.status).toBe(200);
  return res.data.value;
}

describe('Telemetry flow', () => {
  test('telemetry below the threshold is stored without creating an alert', async () => {
    const deviceId = uniqueId('cool');
    const device = await POST(`${API}/registerDevice`, {
      deviceId,
      name: 'Coolant Monitor',
      model: 'C-1'
    });

    expect(device.status).toBe(200);

    const ingested = await POST(`${API}/ingestTelemetry`, {
      deviceID: device.data.ID,
      metric: 'temperature',
      value: 42,
      unit: 'C',
      threshold: 100
    });

    expect(ingested.status).toBe(200);

    const telemetry = (await rows('Telemetry')).filter(row => row.device_ID === device.data.ID);
    const alerts = (await rows('Alerts')).filter(row => row.device_ID === device.data.ID);
    const workOrders = (await rows('WorkOrders')).filter(row => row.device_ID === device.data.ID);

    expect(telemetry).toHaveLength(1);
    expect(Number(telemetry[0].value)).toBe(42);
    expect(alerts).toHaveLength(0);
    expect(workOrders).toHaveLength(0);
  });
});
