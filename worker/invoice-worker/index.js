const cds = require('@sap/cds');

// Simple workorder worker:
// - Connects to the CDS model
// - Polls for Alerts that don't have WorkOrders
// - Creates a WorkOrder and marks it Open

function generateInvoiceNumber() {
  const year = new Date().getFullYear();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `INV-${year}${rand}`;
}

async function createWorkOrderForAlert(alert) {
  const { ID: alertID } = alert;
  const work = {
    ID: cds.utils && cds.utils.uuid ? cds.utils.uuid() : ('' + Date.now()),
    workNo: `WO-${Date.now()}`,
    device_ID: alert.telemetry_ID && alert.telemetry && alert.telemetry.device_ID ? alert.telemetry.device_ID : null,
    alert_ID: alertID,
    status: 'Open',
    description: alert.description || 'Auto-generated from alert'
  };

  await cds.run(INSERT.into('fleet.WorkOrders').entries(work));
  return work;
}

async function pollLoop() {
  try {
    const alerts = await cds.run(SELECT.from('fleet.Alerts'));
    for (const alert of alerts) {
      const existing = await cds.run(SELECT.one.from('fleet.WorkOrders').where({ alert_ID: alert.ID }));
      if (existing) continue;
      try {
        const work = await createWorkOrderForAlert(alert);
        console.log('[worker] Created work order', work.workNo, 'for alert', alert.ID);
      } catch (e) {
        console.error('[worker] failed to create work order for', alert.ID, e && e.message);
      }
    }
  } catch (e) {
    console.error('[worker] poll error', e && e.message);
  }
}

async function start() {
  try {
    await cds.connect();
    console.log('[worker] connected to CDS');
  } catch (e) {
    console.error('[worker] failed to connect', e && e.message);
    process.exit(1);
  }

  // Initial run then interval
  await pollLoop();
  setInterval(pollLoop, 5000);
}

start();
