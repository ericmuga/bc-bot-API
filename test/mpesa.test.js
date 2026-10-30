const test = require('node:test');
const assert = require('node:assert/strict');
const mpesa = require('../src/mpesa');
const config = require('../src/config');
const http = require('node:http');

// Serves the portal locally on a random port for the duration of a test.
function stubPortal(responder) {
  const calls = [];
  const original = config.fclOrders.baseUrl;
  const server = http.createServer((req, res) => {
    let text = '';
    req.on('data', (chunk) => { text += chunk; });
    req.on('end', () => {
      calls.push({ url: `${config.fclOrders.baseUrl}${req.url}`, body: JSON.parse(text) });
      const { status = 200, body } = responder(req.url);
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    });
  });
  const ready = new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    config.fclOrders.baseUrl = `http://127.0.0.1:${server.address().port}`;
    resolve();
  }));
  return { calls, ready, restore: () => { config.fclOrders.baseUrl = original; server.close(); } };
}

async function stubFetch(responder) {
  const portal = stubPortal(responder);
  await portal.ready;
  return portal;
}

test('phone numbers normalize to the 254 format and reject invalid input', () => {
  for (const input of ['0712345678', '712345678', '+254712345678', '254712345678', '0712 345 678']) {
    assert.equal(mpesa.normalizePhone(input), '254712345678');
  }
  assert.equal(mpesa.normalizePhone('0110345678'), '254110345678');
  for (const input of ['12345', '0812345678', '25471234567']) {
    assert.throws(() => mpesa.normalizePhone(input), { statusCode: 400 });
  }
});

test('STK push relays the shop cart payload to FCL Orders and surfaces rejections', async () => {
  const fetchStub = await stubFetch(() => ({ body: { ResponseCode: '0', CheckoutRequestID: 'ws_CO_1', Order_ID: 'BOT-1' } }));
  try {
    const result = await mpesa.initiateStkPush({ phone: '254712345678', amount: 10, tillNumber: '9051007', storeName: 'SHOP' });
    assert.equal(result.CheckoutRequestID, 'ws_CO_1');
    assert.equal(fetchStub.calls[0].url, `${config.fclOrders.baseUrl}/api/v1/mpesa/stk-push`);
    assert.deepEqual(fetchStub.calls[0].body, {
      phone: '254712345678', amount: 10, till_number: '9051007', store_name: 'SHOP', transaction_type: config.fclOrders.stkTransactionType
    });
  } finally {
    fetchStub.restore();
  }

  const rejected = await stubFetch(() => ({ body: { errorCode: '400.002.02', errorMessage: 'Bad Request - Invalid PhoneNumber' } }));
  try {
    await assert.rejects(mpesa.initiateStkPush({ phone: '254712345678', amount: 10, tillNumber: '1', storeName: 'S' }),
      { statusCode: 502, message: 'Bad Request - Invalid PhoneNumber' });
  } finally {
    rejected.restore();
  }
});

test('STK query maps Safaricom results to pending, paid and failed', async () => {
  for (const [body, status] of [
    [{ errorCode: '500.001.1001', errorMessage: 'The transaction is being processed' }, 'pending'],
    [{ ResultCode: '0', ResultDesc: 'The service request is processed successfully.' }, 'paid'],
    [{ ResultCode: '1032', ResultDesc: 'Request cancelled by user' }, 'failed']
  ]) {
    const fetchStub = await stubFetch(() => ({ body }));
    try {
      const result = await mpesa.queryStkPush('ws_CO_1');
      assert.equal(result.status, status);
      assert.equal(fetchStub.calls[0].url, `${config.fclOrders.baseUrl}/api/v1/mpesa/stk-query/ws_CO_1`);
    } finally {
      fetchStub.restore();
    }
  }
});

test('payments lookup sends short code, amount and date to FCL Orders', async () => {
  const rows = [{ TransID: 'TJU4XYZ123', TransAmount: '1500.00', BusinessShortCode: '9051007' }];
  const unfiltered = [...rows, { TransID: 'A', TransAmount: '1500.00', BusinessShortCode: '7062242' }, { TransID: 'B', TransAmount: '99.00', BusinessShortCode: '9051007' }];
  const fetchStub = await stubFetch(() => ({ body: unfiltered }));
  try {
    assert.deepEqual(await mpesa.fetchPayments({ businessShortCode: '9051007', amount: 1500, date: '2026-10-30' }), rows);
    assert.equal(fetchStub.calls[0].url, `${config.fclOrders.baseUrl}/api/fetch/mpesa-transactions`);
    assert.deepEqual(fetchStub.calls[0].body, { BusinessShortCode: '9051007', TransAmount: 1500, date: '2026-10-30' });
  } finally {
    fetchStub.restore();
  }
});

test('M-Pesa paths are documented and STK push has no test alias', () => {
  const spec = require('../src/openapi').createSpec();
  assert(spec.paths['/api/mpesa/stk-push'].post);
  assert(spec.paths['/api/mpesa/stk-push/{checkoutRequestId}'].get);
  assert(spec.paths['/api/mpesa/payments'].get);
  assert.equal(spec.paths['/api/test/mpesa/stk-push'], undefined);
  assert(spec.paths['/api/test/mpesa/payments'].get);
});
