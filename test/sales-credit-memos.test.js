const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const express = require('express');
const { createRequire } = require('node:module');
const localRequire = createRequire(path.resolve('src/routes.js'));

// Loads the real router with a fake SQL pool that records each query and its inputs.
function fixture(recordset = []) {
  const queries = [];
  const config = {
    companies: { defaultCode: 'FCL', prefixes: { CM: 'CM3', FCL: 'FCL1', FLM: 'FLM1', RMK: 'RMK' } },
    tables: { salesCrMemoHeader: '', salesCrMemoLine: '' },
    defaults: { limit: 100, maxLimit: 1000 },
    access: { sqlEnabled: true }
  };
  const db = {
    sql: { Int: 'Int', NVarChar: 'NVarChar', Date: 'Date' },
    bracket: (name) => `[${name}]`,
    getCompanyConfig(code = 'FCL') {
      if (!config.companies.prefixes[code]) throw Object.assign(new Error('Invalid company'), { statusCode: 400 });
      return { code, prefix: config.companies.prefixes[code] };
    },
    async resolveTable(name, override, company) { return `[${config.companies.prefixes[company]}$${name}]`; },
    async getPool() {
      return {
        request() {
          const inputs = {};
          const request = {
            input(name, type, value) { inputs[name] = value; return request; },
            async query(text) { queries.push({ text, inputs }); return { recordset }; }
          };
          return request;
        }
      };
    }
  };
  const context = {
    require(name) { return name === './config' ? config : name === './db' ? db : localRequire(name); },
    module: { exports: {} }, __dirname: path.resolve('src'), setTimeout
  };
  vm.runInNewContext(fs.readFileSync('src/routes.js', 'utf8'), context);
  const app = express();
  app.use('/api', context.module.exports);
  app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ error: err.message }));
  return { app, queries };
}

async function get(f, url) {
  const server = f.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`);
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const header = {
  creditMemoNo: 'CR0087595', postingDate: '2026-10-30', documentDate: '2026-10-30', externalDocumentNo: 'PRICE OVERCHARGE',
  appliesToDocType: 2, appliesToDocNo: 'IN01050278', returnOrderNo: '', preAssignedNo: 'CR0087595', reasonCode: null,
  salespersonCode: '062', customerNo: '914', customerName: 'MAJID', shipToCode: '3', shipToName: 'DSPTCH', locationCode: '3535',
  totalAmount: 1500, totalAmountIncludingVat: 1740, totalCount: 2
};
const line = (lineNo, amount) => ({
  lineNo, itemNo: `J${lineNo}`, description: 'Pork', quantity: '2.5', unitOfMeasureCode: 'KG', unitPrice: '480',
  amount: String(amount), amountIncludingVat: String(amount * 1.16), returnReasonCode: 'BOD', lineLocationCode: '3536'
});

test('credit memo rows are grouped into headers with their item lines', async () => {
  const f = fixture([
    { ...header, ...line(10000, 1200) },
    { ...header, ...line(20000, 100) },
    // A credit memo without item lines still appears, with an empty lines array.
    { ...header, creditMemoNo: 'CR0087600', appliesToDocType: 0, lineNo: null }
  ]);
  const res = await get(f, '/api/sales-credit-memos');
  assert.equal(res.status, 200);
  assert.equal(res.body.count, 2);
  assert.equal(res.body.totalCount, 2);

  const [first, second] = res.body.data;
  assert.equal(first.creditMemoNo, 'CR0087595');
  assert.equal(first.appliesToDocType, 'Invoice');
  assert.equal(first.reasonCode, '');
  // Header totals come from SQL across all lines, not from the item lines returned.
  assert.equal(first.amount, 1500);
  assert.equal(first.amountIncludingVat, 1740);
  assert.deepEqual(first.lines.map((l) => l.lineNo), [10000, 20000]);
  assert.deepEqual(first.lines[0], {
    lineNo: 10000, itemNo: 'J10000', description: 'Pork', quantity: 2.5, unitOfMeasureCode: 'KG', unitPrice: 480,
    amount: 1200, amountIncludingVat: 1392, returnReasonCode: 'BOD', locationCode: '3536'
  });
  assert.equal(second.appliesToDocType, '');
  assert.deepEqual(second.lines, []);
});

test('credit memos default to today and read the company credit memo tables', async () => {
  const f = fixture();
  const res = await get(f, '/api/sales-credit-memos?company=CM');
  assert.equal(res.status, 200);
  const { text, inputs } = f.queries[0];
  assert.match(text, /FROM \[CM3\$Sales Cr_Memo Header\] h/);
  assert.match(text, /LEFT JOIN \[CM3\$Sales Cr_Memo Line\] l/);
  assert.match(text, /l\.\[Type\] = 2/);
  assert.match(text, /\[Posting Date\] BETWEEN @postingDateFrom AND @postingDateTo/);
  assert.equal(inputs.postingDateFrom, new Date().toLocaleDateString('en-CA'));
  assert.equal(res.body.postingDateFrom, inputs.postingDateFrom);
});

test('document lookups search all dates unless a date is supplied', async () => {
  for (const query of ['creditMemoNo=CR1,CR2', 'externalDocumentNo=BOT-CN-1', 'appliesToDocNo=IN01050278']) {
    const f = fixture();
    const res = await get(f, `/api/sales-credit-memos?${query}`);
    assert.equal(res.status, 200, query);
    assert.equal(res.body.postingDateFrom, null, query);
    assert.doesNotMatch(f.queries[0].text, /@postingDateFrom/, query);
  }

  const f = fixture();
  await get(f, '/api/sales-credit-memos?creditMemoNo=CR1,CR2&appliesToDocNo=IN1&postingDate=2026-10-01');
  const { text, inputs } = f.queries[0];
  assert.match(text, /h\.\[No_\] IN \(@creditMemoNo0, @creditMemoNo1\)/);
  assert.match(text, /h\.\[Applies-to Doc_ No_\] = @appliesToDocNo/);
  assert.deepEqual([inputs.creditMemoNo0, inputs.creditMemoNo1, inputs.appliesToDocNo, inputs.postingDateFrom], ['CR1', 'CR2', 'IN1', '2026-10-01']);
});

test('invalid credit memo date filters are rejected before querying', async () => {
  for (const query of [
    'postingDate=2026-10-01&postingDateFrom=2026-10-01&postingDateTo=2026-10-02',
    'postingDateFrom=2026-10-10&postingDateTo=2026-10-01',
    'postingDateFrom=2026-01-01&postingDateTo=2026-03-01',
    'postingDate=2026-13-40'
  ]) {
    const f = fixture();
    const res = await get(f, `/api/sales-credit-memos?${query}`);
    assert.equal(res.status, 400, query);
    assert.equal(f.queries.length, 0, query);
  }
});

test('credit memo endpoint is documented with paging and test alias', () => {
  const spec = require('../src/openapi').createSpec();
  for (const prefix of ['/api/', '/api/test/']) {
    const operation = spec.paths[`${prefix}sales-credit-memos`].get;
    const names = operation.parameters.map((p) => p.name);
    assert(names.includes('creditMemoNo') && names.includes('appliesToDocNo') && !names.includes('invoiceNo'));
    const properties = operation.responses[200].content['application/json'].schema.properties;
    assert(properties.nextPage && properties.data.items.properties.lines);
    assert(properties.data.items.properties.creditMemoNo);
  }
});
