const sql = require('mssql');
const config = require('./config');

let poolPromise;
const tableCache = new Map();

function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect({
      server: config.sql.server,
      port: config.sql.port,
      database: config.sql.database,
      user: config.sql.user,
      password: config.sql.password,
      options: {
        encrypt: config.sql.encrypt,
        trustServerCertificate: config.sql.trustServerCertificate
      },
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
      }
    }).catch((err) => {
      poolPromise = undefined;
      throw err;
    });
  }

  return poolPromise;
}

function bracket(identifier) {
  return `[${String(identifier).replace(/]/g, ']]')}]`;
}

function qualifiedTableName(tableName) {
  if (tableName.includes('.')) {
    return tableName
      .split('.')
      .map((part) => bracket(part.replace(/^\[|\]$/g, '')))
      .join('.');
  }

  return `${bracket(config.sql.schema)}.${bracket(tableName)}`;
}

function getCompanyConfig(companyCode) {
  const code = (companyCode || config.companies.defaultCode).toUpperCase();
  const prefix = config.companies.prefixes[code];
  if (!prefix) {
    const allowed = Object.keys(config.companies.prefixes).join(', ');
    const error = new Error(`Invalid company '${code}'. Use one of: ${allowed}.`);
    error.statusCode = 400;
    throw error;
  }

  return { code, prefix };
}

async function resolveTable(logicalName, override, companyCode) {
  if (override) {
    return qualifiedTableName(override);
  }

  const company = getCompanyConfig(companyCode);
  const cacheKey = `${config.sql.schema}:${company.code}:${company.prefix}:${logicalName}`;
  if (tableCache.has(cacheKey)) {
    return tableCache.get(cacheKey);
  }

  const pool = await getPool();
  const companyPrefix = `${company.prefix}$`;
  const request = pool.request()
    .input('schema', sql.NVarChar, config.sql.schema)
    .input('exactCompany', sql.NVarChar, `${companyPrefix}${logicalName}`)
    .input('companyLike', sql.NVarChar, `${companyPrefix}${logicalName}$%`);

  const result = await request.query(`
    SELECT TOP 1 TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = @schema
      AND TABLE_TYPE = 'BASE TABLE'
      AND (
        TABLE_NAME = @exactCompany OR
        TABLE_NAME LIKE @companyLike
      )
    ORDER BY
      CASE
        WHEN TABLE_NAME = @exactCompany THEN 0
        WHEN TABLE_NAME LIKE @companyLike THEN 1
        ELSE 3
      END,
      TABLE_NAME
  `);

  if (!result.recordset.length) {
    throw new Error(`Could not resolve SQL table for ${company.code}/${company.prefix}$${logicalName}. Set the matching SQL_TABLE_* env var if this table is custom.`);
  }

  const table = qualifiedTableName(result.recordset[0].TABLE_NAME);
  tableCache.set(cacheKey, table);
  return table;
}

async function resolveFirstTable(logicalNames, override, companyCode) {
  if (override) {
    return qualifiedTableName(override);
  }

  let lastError;
  for (const logicalName of logicalNames) {
    try {
      return await resolveTable(logicalName, '', companyCode);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError;
}

async function getTables(companyCode) {
  const [
    importedOrders,
    importedSalesAL,
    customer,
    item,
    shipToAddress,
    salespersonPurchaser,
    contact,
    salesHeader,
    salesInvoiceHeader
  ] = await Promise.all([
    resolveTable('Imported Orders', config.tables.importedOrders, companyCode),
    resolveTable('Imported SalesAL', config.tables.importedSalesAL, companyCode),
    resolveTable('Customer', config.tables.customer, companyCode),
    resolveTable('Item', config.tables.item, companyCode),
    resolveTable('Ship-to Address', config.tables.shipToAddress, companyCode),
    resolveFirstTable(['Salesperson/Purchaser', 'Salesperson_Purchaser'], config.tables.salespersonPurchaser, companyCode),
    resolveTable('Contact', config.tables.contact, companyCode),
    resolveTable('Sales Header', config.tables.salesHeader, companyCode),
    resolveTable('Sales Invoice Header', config.tables.salesInvoiceHeader, companyCode)
  ]);

  return {
    importedOrders,
    importedSalesAL,
    customer,
    item,
    shipToAddress,
    salespersonPurchaser,
    contact,
    salesHeader,
    salesInvoiceHeader
  };
}

async function getAllCompanyTables() {
  const entries = await Promise.all(Object.keys(config.companies.prefixes).map(async (code) => ({
    code,
    prefix: `${config.companies.prefixes[code]}$`,
    tables: await getTables(code).catch((err) => ({ error: err.message }))
  })));

  return entries.reduce((companies, entry) => {
    companies[entry.code] = {
      prefix: entry.prefix,
      tables: entry.tables
    };
    return companies;
  }, {});
}

module.exports = {
  sql,
  getPool,
  getTables,
  getAllCompanyTables,
  getCompanyConfig,
  bracket
};
