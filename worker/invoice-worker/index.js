const cds = require('@sap/cds');

// Simple invoice worker:
// - Connects to the CDS model
// - Polls for SalesOrders with status 'Delivered' and no Invoice
// - Creates an Invoice and moves the SalesOrder to 'Invoiced'

function generateInvoiceNumber() {
  const year = new Date().getFullYear();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `INV-${year}${rand}`;
}

async function createInvoiceForOrder(order) {
  const { ID: orderID, netAmount, taxAmount, totalAmount } = order;
  const invoice = {
    ID: cds.utils && cds.utils.uuid ? cds.utils.uuid() : ('' + Date.now()),
    invoiceNumber: generateInvoiceNumber(),
    order_ID: orderID,
    invoiceDate: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().split('T')[0],
    netAmount: order.netAmount || netAmount || 0,
    taxAmount: order.taxAmount || taxAmount || 0,
    totalAmount: order.totalAmount || totalAmount || 0,
    isPaid: false
  };

  await cds.run(INSERT.into('o2c.Invoices').entries(invoice));
  await cds.run(UPDATE('o2c.SalesOrders').set({ status: 'Invoiced' }).where({ ID: orderID }));
  return invoice;
}

async function pollLoop() {
  try {
    const orders = await cds.run(SELECT.from('o2c.SalesOrders').where({ status: 'Delivered' }));
    for (const order of orders) {
      const existing = await cds.run(SELECT.one.from('o2c.Invoices').where({ order_ID: order.ID }));
      if (existing) continue;
      try {
        const invoice = await createInvoiceForOrder(order);
        console.log('[worker] Created invoice', invoice.invoiceNumber, 'for order', order.ID);
      } catch (e) {
        console.error('[worker] failed to create invoice for', order.ID, e && e.message);
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
