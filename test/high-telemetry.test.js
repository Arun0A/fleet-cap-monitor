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

test('high telemetry creates an alert and exactly one work order', async () => {
  const deviceId = uniqueId('sensor');
  const { data: device } = await POST(`${API}/registerDevice`, {
    deviceId,
    name: 'Engine Sensor',
    model: 'M-100'
  });

  const ingested = await POST(`${API}/ingestTelemetry`, {
    deviceID: device.ID,
    metric: 'temperature',
    value: 250,
    unit: 'C'
  });

  expect(ingested.status).toBe(200);

  const alerts = (await rows('Alerts')).filter(row => row.device_ID === device.ID);
  expect(alerts).toHaveLength(1);

  const workOrders = (await rows('WorkOrders')).filter(row => row.device_ID === device.ID);
  expect(workOrders).toHaveLength(1);
  expect(workOrders[0].alert_ID).toBe(alerts[0].ID);
  expect(workOrders[0].status).toBe('Open');

  const deviceAfter = await GET(`${API}/Devices(${device.ID})`);
  expect(deviceAfter.status).toBe(200);
  expect(deviceAfter.data.lastSeen).toBeTruthy();
});
