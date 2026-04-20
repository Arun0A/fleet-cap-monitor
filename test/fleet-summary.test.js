'use strict';

const cds = require('@sap/cds');
const { GET } = cds.test(__dirname + '/..');

const API = '/api/fleet';

test('getFleetSummary returns grouped work-order counts', async () => {
  const summary = await GET(`${API}/getFleetSummary()`);

  expect(summary.status).toBe(200);
  expect(Array.isArray(summary.data.value)).toBe(true);
  summary.data.value.forEach(row => {
    expect(row).toHaveProperty('status');
    expect(row).toHaveProperty('count');
  });
});
