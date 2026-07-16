const sql = require('mssql');
const config = require('./config');

const BASE_APP_ID = '437dbf0e-84ff-417a-965d-ed2bb9650972';
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
    .input('companyLike', sql.NVarChar, `${companyPrefix}${logicalName}$%`)
    .input('baseAppLike', sql.NVarChar, `${companyPrefix}${logicalName}$${BASE_APP_ID}`);

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
        WHEN TABLE_NAME = @baseAppLike THEN 1
        WHEN TABLE_NAME LIKE @companyLike THEN 2
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

async function resolveFirstOptionalTable(logicalNames, override, companyCode) {
  try {
    return await resolveFirstTable(logicalNames, override, companyCode);
  } catch (err) {
    return '';
  }
}

async function resolveOptionalTable(logicalName, override, companyCode) {
  try {
    return await resolveTable(logicalName, override, companyCode);
  } catch (err) {
    return '';
  }
}

async function getTables(companyCode) {
  const [
    importedOrders,
    importedSalesAL,
    importedReturnOrders,
    importedCreditNotesAL,
    customer,
    customerExt,
    item,
    itemExt,
    shipToAddress,
    shipToAddressExt,
    salespersonPurchaser,
    salespersonPurchaserExt,
    contact,
    districtGroupCode,
    salesHeader,
    salesHeaderExt,
    salesInvoiceHeader,
    salesInvoiceLine,
    salesCrMemoHeader
  ] = await Promise.all([
    resolveTable('Imported Orders', config.tables.importedOrders, companyCode),
    resolveTable('Imported SalesAL', config.tables.importedSalesAL, companyCode),
    resolveOptionalTable('Imported Return Orders', config.tables.importedReturnOrders, companyCode),
    resolveOptionalTable('Imported Credit Notes AL', config.tables.importedCreditNotesAL, companyCode),
    resolveTable('Customer', config.tables.customer, companyCode),
    resolveOptionalTable(`Customer$${BASE_APP_ID}$ext`, config.tables.customerExt, companyCode),
    resolveTable('Item', config.tables.item, companyCode),
    resolveOptionalTable(`Item$${BASE_APP_ID}$ext`, config.tables.itemExt, companyCode),
    resolveTable('Ship-to Address', config.tables.shipToAddress, companyCode),
    resolveOptionalTable(`Ship-to Address$${BASE_APP_ID}$ext`, config.tables.shipToAddressExt, companyCode),
    resolveFirstTable(['Salesperson/Purchaser', 'Salesperson_Purchaser'], config.tables.salespersonPurchaser, companyCode),
    resolveFirstOptionalTable([
      `Salesperson/Purchaser$${BASE_APP_ID}$ext`,
      `Salesperson_Purchaser$${BASE_APP_ID}$ext`
    ], config.tables.salespersonPurchaserExt, companyCode),
    resolveTable('Contact', config.tables.contact, companyCode),
    resolveOptionalTable('District Group Code', config.tables.districtGroupCode, companyCode),
    resolveTable('Sales Header', config.tables.salesHeader, companyCode),
    resolveOptionalTable(`Sales Header$${BASE_APP_ID}$ext`, config.tables.salesHeaderExt, companyCode),
    resolveTable('Sales Invoice Header', config.tables.salesInvoiceHeader, companyCode),
    resolveTable('Sales Invoice Line', config.tables.salesInvoiceLine, companyCode),
    resolveFirstTable(['Sales Cr.Memo Header', 'Sales Cr_Memo Header', 'Sales Cr_ Memo Header'], config.tables.salesCrMemoHeader, companyCode)
  ]);

  return {
    importedOrders,
    importedSalesAL,
    importedReturnOrders,
    importedCreditNotesAL,
    customer,
    customerExt,
    item,
    itemExt,
    shipToAddress,
    shipToAddressExt,
    salespersonPurchaser,
    salespersonPurchaserExt,
    contact,
    districtGroupCode,
    salesHeader,
    salesHeaderExt,
    salesInvoiceHeader,
    salesInvoiceLine,
    salesCrMemoHeader
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
