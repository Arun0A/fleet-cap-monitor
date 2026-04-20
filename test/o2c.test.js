'use strict';

/**
 * O2C Service Unit Tests
 * Tests the complete Order-to-Cash flow end-to-end using cds.test helper.
 * Run: npm test
 */

const cds  = require('@sap/cds');
const { GET, POST, PATCH, axios } = cds.test(__dirname + '/..');

// Make Axios throw on non-2xx so we can use try/catch cleanly
axios.defaults.validateStatus = () => true;

const API = '/api/o2c';

// ── Helpers ────────────────────────────────────────────────────────────────

let customers, products;

beforeAll(async () => {
  const c = await GET(`${API}/Customers`);
  const p = await GET(`${API}/Products`);
  customers = c.data.value;
  products  = p.data.value;
  expect(customers.length).toBeGreaterThan(0);
  expect(products.length).toBeGreaterThan(0);
});

async function createDraftOrder() {
  const customer = customers[0];
  const res = await POST(`${API}/SalesOrders`, {
    customer_ID: customer.ID,
    orderDate:   '2025-06-01',
    notes:       'Test order',
  });
  expect(res.status).toBe(201);
  return res.data;
}

async function addLineItem(orderID, productID, quantity = 2, discount = 0) {
  const product = products.find(p => p.ID === productID) || products[0];
  const res = await POST(`${API}/SalesOrderItems`, {
    order_ID:   orderID,
    product_ID: product.ID,
    quantity,
    discount,
  });
  expect(res.status).toBe(201);
  return res.data;
}

// ── Test Suites ────────────────────────────────────────────────────────────

describe('Master Data', () => {
  test('should return seeded customers', async () => {
    const { data } = await GET(`${API}/Customers`);
    expect(data.value.length).toBeGreaterThanOrEqual(5);
  });

  test('should return seeded products with prices', async () => {
    const { data } = await GET(`${API}/Products`);
    expect(data.value.length).toBeGreaterThanOrEqual(6);
    data.value.forEach(p => {
      expect(Number(p.unitPrice)).toBeGreaterThan(0);
      expect(Number(p.taxRate)).toBeGreaterThan(0);
    });
  });
});

describe('Sales Order Creation', () => {
  test('should create a Draft order with auto-generated order number', async () => {
    const order = await createDraftOrder();
    expect(order.status).toBe('Draft');
    expect(order.orderNumber).toMatch(/^SO-\d+$/);
  });

  test('should add line items and auto-calculate totals', async () => {
    const order  = await createDraftOrder();
    const item   = await addLineItem(order.ID, products[0].ID, 2, 10); // qty=2, disc=10%

    const gross  = 2 * Number(products[0].unitPrice);
    const net    = gross * 0.9;
    const tax    = net * (Number(products[0].taxRate) / 100);
    const total  = net + tax;

    expect(Number(item.netPrice)).toBeCloseTo(net, 1);
    expect(Number(item.taxAmount)).toBeCloseTo(tax, 1);
    expect(Number(item.totalPrice)).toBeCloseTo(total, 1);

    // Verify order totals rolled up
    const { data: updatedOrder } = await GET(`${API}/SalesOrders(${order.ID})`);
    expect(Number(updatedOrder.totalAmount)).toBeCloseTo(total, 1);
  });
});

describe('Order Confirmation', () => {
  test('should confirm a Draft order with items', async () => {
    const order = await createDraftOrder();
    await addLineItem(order.ID, products[0].ID, 1);

    const res = await POST(`${API}/SalesOrders(${order.ID})/O2CService.confirmOrder`, {});
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('Confirmed');
  });

  test('should reject confirmation of empty order', async () => {
    const order = await createDraftOrder();
    const res   = await POST(`${API}/SalesOrders(${order.ID})/O2CService.confirmOrder`, {});
    expect(res.status).toBe(400);
  });

  test('should not confirm an already Confirmed order', async () => {
    const order = await createDraftOrder();
    await addLineItem(order.ID, products[1].ID, 1);
    await POST(`${API}/SalesOrders(${order.ID})/O2CService.confirmOrder`, {});

    const res = await POST(`${API}/SalesOrders(${order.ID})/O2CService.confirmOrder`, {});
    expect(res.status).toBe(400);
  });
});

describe('Delivery Process', () => {
  test('should create a delivery for a Confirmed order', async () => {
    const order = await createDraftOrder();
    await addLineItem(order.ID, products[2].ID, 1);
    await POST(`${API}/SalesOrders(${order.ID})/O2CService.confirmOrder`, {});

    const res = await POST(`${API}/createDelivery`, {
      orderID:     order.ID,
      plannedDate: '2025-06-10',
      carrier:     'BlueDart',
    });
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('Pending');

    const { data: updOrder } = await GET(`${API}/SalesOrders(${order.ID})`);
    expect(updOrder.status).toBe('Delivered');
  });

  test('should mark delivery as Shipped then Delivered', async () => {
    const order = await createDraftOrder();
    await addLineItem(order.ID, products[3].ID, 1);
    await POST(`${API}/SalesOrders(${order.ID})/O2CService.confirmOrder`, {});
    const { data: delivery } = await POST(`${API}/createDelivery`, { orderID: order.ID });

    const shipped = await POST(
      `${API}/Deliveries(${delivery.ID})/O2CService.markShipped`,
      { trackingNo: 'TRK-001', carrier: 'BlueDart' }
    );
    expect(shipped.data.status).toBe('Shipped');

    const delivered = await POST(`${API}/Deliveries(${delivery.ID})/O2CService.markDelivered`, {});
    expect(delivered.data.status).toBe('Delivered');
    expect(delivered.data.actualDate).toBeTruthy();
  });
});

describe('Invoicing & Payment', () => {
  async function buildDeliveredOrder() {
    const order = await createDraftOrder();
    await addLineItem(order.ID, products[4].ID, 2);
    await POST(`${API}/SalesOrders(${order.ID})/O2CService.confirmOrder`, {});
    await POST(`${API}/createDelivery`, { orderID: order.ID });
    return order;
  }

  test('should generate an invoice for a Delivered order', async () => {
    const order = await buildDeliveredOrder();
    const res   = await POST(`${API}/generateInvoice`, { orderID: order.ID });
    expect(res.status).toBe(200);
    expect(res.data.invoiceNumber).toMatch(/^INV-\d+$/);
    expect(res.data.isPaid).toBe(false);

    const { data: updOrder } = await GET(`${API}/SalesOrders(${order.ID})`);
    expect(updOrder.status).toBe('Invoiced');
  });

  test('should record payment and mark order as Paid', async () => {
    const order   = await buildDeliveredOrder();
    const { data: inv } = await POST(`${API}/generateInvoice`, { orderID: order.ID });

    const paid = await POST(
      `${API}/Invoices(${inv.ID})/O2CService.recordPayment`,
      { paymentRef: 'NEFT-20250601-001' }
    );
    expect(paid.data.isPaid).toBe(true);
    expect(paid.data.paymentRef).toBe('NEFT-20250601-001');

    const { data: updOrder } = await GET(`${API}/SalesOrders(${order.ID})`);
    expect(updOrder.status).toBe('Paid');
  });

  test('should not record payment twice', async () => {
    const order = await buildDeliveredOrder();
    const { data: inv } = await POST(`${API}/generateInvoice`, { orderID: order.ID });
    await POST(`${API}/Invoices(${inv.ID})/O2CService.recordPayment`, { paymentRef: 'REF-1' });

    const res = await POST(`${API}/Invoices(${inv.ID})/O2CService.recordPayment`, { paymentRef: 'REF-2' });
    expect(res.status).toBe(400);
  });
});

describe('Order Summary', () => {
  test('should return grouped summary with counts', async () => {
    const { data } = await GET(`${API}/getOrderSummary()`);
    expect(Array.isArray(data.value)).toBe(true);
    data.value.forEach(row => {
      expect(row).toHaveProperty('status');
      expect(row).toHaveProperty('count');
      expect(row).toHaveProperty('totalRevenue');
    });
  });
});
