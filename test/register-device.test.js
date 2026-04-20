'use strict';

const cds = require('@sap/cds');
const { POST, axios } = cds.test(__dirname + '/..');

axios.defaults.validateStatus = () => true;

const API = '/api/fleet';

function uniqueId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

test('registerDevice creates a device and blocks duplicates', async () => {
  const deviceId = uniqueId('dev');

  const created = await POST(`${API}/registerDevice`, {
    deviceId,
    name: 'Truck 1',
    model: 'Volvo FH'
  });

  expect(created.status).toBe(200);
  expect(created.data.deviceId).toBe(deviceId);

  const duplicate = await POST(`${API}/registerDevice`, {
    deviceId,
    name: 'Truck 1 again',
    model: 'Volvo FH'
  });

  expect(duplicate.status).toBe(409);
});
