const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const express = require('express');
const { createRequire } = require('node:module');
const localRequire = createRequire(path.resolve('src/routes.js'));

function fixture(stubStage = true) {
  const calls = [];
  const config = {
    companies: { defaultCode: 'FCL', prefixes: { CM: 'CM3', FCL: 'FCL1', FLM: 'FLM1', RMK: 'RMK' } },
    sqlWrite: { server: 'live', port: 1433, database: 'BC' },
    sqlWriteMirrors: [{ name: 'test', server: 'test', port: 1433, database: 'BC', user: 'test', password: 'test' }],
    bcApi: { baseUrl: 'https://live.example/BC' },
    bcApiMirrors: [{ name: 'test', baseUrl: 'https://test.example/BC' }],
    access: { sqlEnabled: true },
    defaults: { importDuplicateRecheckDelayMs: 0 },
  };
  const db = {
    sql: {},
    getCompanyConfig(code = 'FCL') { if (!config.companies.prefixes[code]) throw Object.assign(new Error('Invalid company'), { statusCode: 400 }); return { code }; },
    async getPool(role) { calls.push({ pool: role }); throw new Error('Stopped at database boundary'); },
  };
  const api = {
    async getLinesByExternalDocumentNo(entity, company, field, document, target) { calls.push({ read: target, company }); return []; },
    async postLine(entity, company, line, target) { calls.push({ write: target, entity, company }); return line; },
  };
  const context = {
    require(name) { return name === './config' ? config : name === './db' ? db : name === './bcApi' ? api : localRequire(name); },
    module: { exports: {} }, __dirname: path.resolve('src'), setTimeout,
  };
  let code = fs.readFileSync('src/routes.js', 'utf8');
  if (stubStage) {
    context.recordStage = async (body, role, target) => { calls.push({ role, target, company: body.company }); return { target, company: body.company, status: 'imported' }; };
    code += '\nstageImportedOrderSql = recordStage;';
  }
  vm.runInNewContext(code, context);
  const app = express();
  app.use(express.json());
  app.use('/api', context.module.exports);
  app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ error: err.message }));
  return { app, calls, config };
}
async function withServer(f, run) {
  const server = f.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const request = async (url, body) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  try { await run(request); } finally { await new Promise(resolve => server.close(resolve)); }
}
const body = { externalDocumentNo: 'TEST-1', sellToCustomerNo: '101', shipmentDate: '2026-09-21', salespersonCode: '019', lines: [{ itemNo: 'A', quantity: 1, unitOfMeasure: 'PC', unitPrice: 10 }] };

test('SQL test batches route only to test and preserve company selection; normal writes retain fan-out', async () => {
  const f = fixture();
  await withServer(f, async request => {
    for (const company of ['CM', 'FCL', 'FLM', 'RMK']) {
      assert.equal((await request(`/api/test/imported-orders?company=${company}&target=live`, { orders: [body, body], target: 'live' })).status, 201);
      assert(f.calls.slice(-2).every(c => c.role === 'write:test' && c.company === company));
    }
    const result = await request('/api/test/imported-orders', { company: 'CM', orders: [body, { ...body, company: 'RMK' }] });
    assert.equal(result.body.orders[0].company, 'CM');
    assert.equal(result.body.orders[1].company, 'RMK');
    assert(f.calls.every(c => c.target === 'test'));
    await request('/api/imported-orders', body);
    assert.deepEqual(f.calls.slice(-2).map(c => c.role), ['write', 'write:test']);
  });
});

test('BC API test duplicate checks and writes use test for every document type; reads unchanged', async () => {
  const f = fixture();
  await withServer(f, async request => {
    for (const documentType of ['order', 'invoice', 'returnOrder', 'creditNote']) {
      const res = await request('/api/test/bc-api/imported-orders?company=CM&target=live', { ...body, documentType, target: 'live' });
      assert.equal(res.status, 201); assert.equal(res.body.target, 'test');
    }
    assert(f.calls.every(c => (c.read || c.write).name === 'test'));
    assert.equal(f.calls.filter(c => c.write).length, 4);
    f.calls.length = 0;
    await request('/api/test/bc-api/imported-orders/TEST-1');
    assert(f.calls.every(c => c.read === f.config.bcApi));
  });
});

test('missing and primary-equivalent test destinations fail closed before any calls', async () => {
  for (const provider of ['sql', 'api']) for (const same of [false, true]) {
    const f = fixture();
    if (provider === 'sql') f.config.sqlWriteMirrors = same ? [{ ...f.config.sqlWriteMirrors[0], ...f.config.sqlWrite }] : [];
    else f.config.bcApiMirrors = same ? [{ name: 'test', ...f.config.bcApi }] : [];
    await withServer(f, async request => {
      const result = await request(`/api/test/${provider === 'api' ? 'bc-api/' : ''}imported-orders`, body);
      assert.equal(result.status, 503); assert.equal(f.calls.length, 0);
    });
  }
});

test('actual SQL staging requests only the test connection', async () => {
  const f = fixture(false);
  await withServer(f, async request => {
    await request('/api/test/imported-orders', body);
    assert.deepEqual(f.calls, [{ pool: 'write:test' }]);
  });
});

test('OpenAPI includes test variants of all documented API paths', () => {
  const spec = require('../src/openapi').createSpec();
  for (const p of Object.keys(spec.paths).filter(p => p.startsWith('/api/') && !p.startsWith('/api/test/'))) {
    assert(spec.paths[p.replace('/api/', '/api/test/')]);
  }
});
