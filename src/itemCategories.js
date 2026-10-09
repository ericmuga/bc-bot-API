const { sql, getPool, bracket } = require('./db');
const config = require('./config');

async function addItemCategories(items) {
  const codes = [...new Set(items.map(item => String(item.productionCategory || '').trim()).filter(Boolean))];
  const byCode = new Map();
  if (codes.length) {
    const pool = await getPool('itemAttributes');
    const table = `${bracket(config.sqlItemAttributes.schema)}.${bracket(config.tables.itemAttributes)}`;
    // Keep each lookup below SQL Server's parameter limit, even with a larger page size.
    for (let offset = 0; offset < codes.length; offset += 1000) {
      const request = pool.request();
      const parameters = codes.slice(offset, offset + 1000).map((code, index) => {
        request.input(`code${index}`, sql.NVarChar, code);
        return `@code${index}`;
      });
      const result = await request.query(`
        SELECT child.[Code] AS code, child.[Attribute] AS category,
          child.[Parent_Code] AS parentCode, parent.[Attribute] AS parentCategory
        FROM ${table} child
        LEFT JOIN ${table} parent ON parent.[Code] = child.[Parent_Code]
        WHERE child.[Code] IN (${parameters.join(', ')})
      `);
      for (const row of result.recordset) byCode.set(String(row.code).trim(), row);
    }
  }
  return items.map(item => {
    const attribute = byCode.get(String(item.productionCategory || '').trim());
    return {
      ...item,
      category: attribute?.category || '',
      parentCategoryCode: attribute?.parentCode || '',
      parentCategory: attribute?.parentCategory || ''
    };
  });
}

module.exports = { addItemCategories };
