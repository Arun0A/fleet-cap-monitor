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

test('assignWorkOrder and completeWorkOrder update the lifecycle', async () => {
  const deviceId = uniqueId('assign');
  const { data: device } = await POST(`${API}/registerDevice`, {
    deviceId,
    name: 'Assigned Vehicle',
    model: 'T-1'
  });

  const technician = await POST(`${API}/Technicians`, {
    name: 'Asha Kumar',
    email: `${uniqueId('asha')}@example.com`,
    phone: '9999999999'
  });

  await POST(`${API}/ingestTelemetry`, {
    deviceID: device.ID,
    metric: 'battery',
    value: 150,
    unit: 'V'
  });

  const alert = (await rows('Alerts')).find(row => row.device_ID === device.ID);
  const workOrder = (await rows('WorkOrders')).find(row => row.alert_ID === alert.ID);

  const assign = await POST(
    `${API}/WorkOrders(${workOrder.ID})/FleetService.assignWorkOrder`,
    { technicianID: technician.data.ID }
  );
  expect(assign.status).toBe(200);
  expect(assign.data.status).toBe('Assigned');
  expect(assign.data.assignedTo_ID).toBe(technician.data.ID);

  const completed = await POST(
    `${API}/WorkOrders(${workOrder.ID})/FleetService.completeWorkOrder`,
    {}
  );
  expect(completed.status).toBe(200);
  expect(completed.data.status).toBe('Completed');
  expect(completed.data.closedAt).toBeTruthy();
});
