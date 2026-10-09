const { sql, getPool, resolveTable } = require('./db');
const config = require('./config');

async function addItemUnits(items, companyCode) {
  if (!items.length) return items;
  const table = await resolveTable('Item Unit of Measure', config.tables.itemUnitOfMeasure, companyCode);
  const pool = await getPool();
  const itemNos = [...new Set(items.map(item => item.itemNo))];
  const byItem = new Map();
  for (let offset = 0; offset < itemNos.length; offset += 1000) {
    const request = pool.request();
    const parameters = itemNos.slice(offset, offset + 1000).map((itemNo, index) => {
      request.input(`item${index}`, sql.NVarChar, itemNo);
      return `@item${index}`;
    });
    const result = await request.query(`
      SELECT [Item No_] AS itemNo, [Code] AS code,
        [Qty_ per Unit of Measure] AS StandardUnitConversionFactor
      FROM ${table}
      WHERE [Item No_] IN (${parameters.join(', ')})
      ORDER BY [Item No_], [Code]
    `);
    for (const row of result.recordset) {
      if (!byItem.has(row.itemNo)) byItem.set(row.itemNo, new Map());
      byItem.get(row.itemNo).set(row.code, {
        code: row.code,
        StandardUnitConversionFactor: row.StandardUnitConversionFactor
      });
    }
  }
  return items.map(item => {
    const units = byItem.get(item.itemNo) || new Map();
    const base = item.baseUnitOfMeasure;
    // Always expose the declared base at 1, including when its UOM row is absent.
    if (base) units.set(base, { code: base, StandardUnitConversionFactor: 1 });
    return {
      ...item,
      unitsOfMeasure: [
        ...(base ? [units.get(base)] : []),
        ...[...units.values()].filter(unit => unit.code !== base)
      ]
    };
  });
}

module.exports = { addItemUnits };
