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

  // Try to connect to external messaging (Event Mesh) and subscribe to AlertCreated
  let messaging;
  try {
    messaging = await cds.connect.to('messaging');
    if (messaging) console.log('[worker] connected to messaging adapter');
  } catch (e) {
    console.warn('[worker] no messaging adapter available, will fallback to polling');
  }

  if (messaging && typeof messaging.subscribe === 'function') {
    // Typical API: messaging.subscribe(eventName, handler)
    try {
      await messaging.subscribe('AlertCreated', async (msg) => {
        try {
          const payload = msg.data || msg.payload || msg;
          console.log('[worker] received AlertCreated via messaging', payload && payload.ID);
          // load full alert from DB if needed
          const alertId = payload && (payload.ID || payload.alert_ID || payload.alertId);
          const alert = alertId ? await cds.run(SELECT.one.from('fleet.Alerts').where({ ID: alertId })) : payload;
          if (!alert) return;
          const existing = await cds.run(SELECT.one.from('fleet.WorkOrders').where({ alert_ID: alert.ID }));
          if (existing) return;
          const work = await createWorkOrderForAlert(alert);
          console.log('[worker] Created work order', work.workNo, 'for alert', alert.ID);
        } catch (err) {
          console.error('[worker] error handling AlertCreated message', err && err.message);
        }
      });
      console.log('[worker] subscribed to AlertCreated');
    } catch (e) {
      console.warn('[worker] messaging subscribe failed, falling back to polling', e && e.message);
      await pollLoop();
      setInterval(pollLoop, 5000);
    }

  } else if (messaging && typeof messaging.on === 'function') {
    // Some adapters expose an EventEmitter-like API
    messaging.on('event', async (evt) => {
      if (!evt || !evt.type) return;
      if (evt.type === 'AlertCreated' || evt.event === 'AlertCreated') {
        try {
          const payload = evt.data || evt.payload || evt;
          const alertId = payload && (payload.ID || payload.alert_ID || payload.alertId);
          const alert = alertId ? await cds.run(SELECT.one.from('fleet.Alerts').where({ ID: alertId })) : payload;
          if (!alert) return;
          const existing = await cds.run(SELECT.one.from('fleet.WorkOrders').where({ alert_ID: alert.ID }));
          if (existing) return;
          const work = await createWorkOrderForAlert(alert);
          console.log('[worker] Created work order', work.workNo, 'for alert', alert.ID);
        } catch (err) {
          console.error('[worker] event handler failed', err && err.message);
        }
      }
    });
    console.log('[worker] hooked messaging EventEmitter');

  } else {
    // Fallback to polling when no messaging adapter is bound
    await pollLoop();
    setInterval(pollLoop, 5000);
  }
}

start();
