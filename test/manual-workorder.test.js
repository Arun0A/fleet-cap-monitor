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

test('manual createWorkOrder reuses the existing work order for an alert', async () => {
  const deviceId = uniqueId('manual');
  const { data: device } = await POST(`${API}/registerDevice`, {
    deviceId,
    name: 'Manual Flow',
    model: 'MX'
  });

  await POST(`${API}/ingestTelemetry`, {
    deviceID: device.ID,
    metric: 'pressure',
    value: 180,
    unit: 'psi'
  });

  const alert = (await rows('Alerts')).find(row => row.device_ID === device.ID);

  const created = await POST(`${API}/createWorkOrder`, {
    alertID: alert.ID,
    description: 'Created from UI'
  });

  expect(created.status).toBe(200);

  const workOrders = (await rows('WorkOrders')).filter(row => row.alert_ID === alert.ID);
  expect(workOrders).toHaveLength(1);
});
