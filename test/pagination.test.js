const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const source=fs.readFileSync('src/routes.js','utf8');const start=source.indexOf('function nextPageFields(');const end=source.indexOf('function paginatedResponse(',start);const ctx={};vm.runInNewContext(source.slice(start,end),ctx);
test('next navigation covers first, middle, final, empty and nonaligned offset pages',()=>{for(const [page,offset,count,total,next,nextOffset] of [[1,0,100,736,2,100],[2,100,100,736,3,200],[8,700,36,736,null,null],[1,0,0,0,null,null],[9,800,0,736,null,null],[1,25,100,736,2,125]]){const r=ctx.nextPageFields({page,offset,limit:100},count,total);assert.equal(r.nextPage,next);assert.equal(r.nextOffset,nextOffset);}});
test('every documented pagination envelope includes next-page fields',()=>{const spec=require('../src/openapi').createSpec();let found=0;function check(node){if(!node||typeof node!=='object')return;if(node.properties?.hasNext){assert(node.properties.nextPage);assert(node.properties.nextOffset);found++;}for(const value of Object.values(node))check(value);}check(spec.paths);assert(found>=16);});


test('all nine list endpoints and test aliases document usable next-page navigation', () => {
  const spec = require('../src/openapi').createSpec();
  const paths = ['customers', 'items', 'sales-prices', 'inventory-posting-groups',
    'production-categories', 'salespeople', 'historical-sales-invoice-lines',
    'imported-orders', 'imported-orders/missing-on-test'];
  for (const prefix of ['/api/', '/api/test/']) {
    for (const path of paths) {
      const operation = spec.paths[prefix + path].get;
      const properties = operation.responses[200].content['application/json'].schema.properties;
      const pagination = path === 'imported-orders' ? properties.metadata.properties : properties;
      assert(pagination.nextPage, prefix + path);
      assert(pagination.nextOffset, prefix + path);
      assert.equal(pagination.nextPage.nullable, true);
      assert(operation.parameters.some(parameter => parameter.name === 'page'));
      const offset = operation.parameters.find(parameter => parameter.name === 'offset');
      assert.equal(offset.schema.default, undefined, 'Swagger must not prefill offset');
    }
  }
});
