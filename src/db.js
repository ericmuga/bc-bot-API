const { AsyncLocalStorage } = require('async_hooks');
const sql = require('mssql');
const config = require('./config');

const BASE_APP_ID = '437dbf0e-84ff-417a-965d-ed2bb9650972';
const poolPromises = new Map();
const tableCache = new Map();
const testModeContext = new AsyncLocalStorage();

// Requests under /test run in test mode: their default read and write connections go to the
// SQL_WRITE_TEST_* target and never fall back to the live database.
function runInTestMode(callback) {
  return testModeContext.run(true, callback);
}

function isTestMode() {
  return testModeContext.getStore() === true;
}

// Roles: 'read', 'write' (follow test mode), 'write:primary' (always the live write target,
// for live-vs-test comparisons), 'write:<mirror>' and 'itemAttributes' (fixed targets).
function poolKeyForRole(role = 'read') {
  if (role === 'itemAttributes') return role;
  if (role === 'write:primary') return 'write';
  if (String(role).startsWith('write:')) return role;
  if (isTestMode()) return 'write:test';
  return role === 'write' ? 'write' : 'read';
}

function connectionConfigForPoolKey(key) {
  if (key === 'itemAttributes') return config.sqlItemAttributes;
  if (key === 'write') return config.sqlWrite;
  if (key.startsWith('write:')) {
    const mirrorName = key.slice('write:'.length);
    const mirror = config.sqlWriteMirrors.find((target) => target.name === mirrorName);
    if (!mirror || !mirror.server || !mirror.database) {
      const error = mirrorName === 'test'
        ? new Error('SQL test target is not configured. Set SQL_WRITE_TEST_SERVER, SQL_WRITE_TEST_DATABASE, SQL_WRITE_TEST_USER, and SQL_WRITE_TEST_PASSWORD.')
        : new Error(`SQL write mirror '${mirrorName}' is not configured.`);
      error.statusCode = 503;
      throw error;
    }

    return mirror;
  }

  return config.sql;
}

function connectionConfigForRole(role = 'read') {
  return connectionConfigForPoolKey(poolKeyForRole(role));
}

function getPool(role = 'read') {
  const normalizedRole = poolKeyForRole(role);
  if (!poolPromises.has(normalizedRole)) {
    const connectionConfig = connectionConfigForPoolKey(normalizedRole);
    const poolPromise = new sql.ConnectionPool({
      server: connectionConfig.server,
      port: connectionConfig.port,
      database: connectionConfig.database,
      user: connectionConfig.user,
      password: connectionConfig.password,
      options: {
        encrypt: connectionConfig.encrypt,
        trustServerCertificate: connectionConfig.trustServerCertificate
      },
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
      }
    }).connect().catch((err) => {
      poolPromises.delete(normalizedRole);
      throw err;
    });
    poolPromises.set(normalizedRole, poolPromise);
  }

  return poolPromises.get(normalizedRole);
}

function bracket(identifier) {
  return `[${String(identifier).replace(/]/g, ']]')}]`;
}

function qualifiedTableName(tableName, role = 'read') {
  if (tableName.includes('.')) {
    return tableName
      .split('.')
      .map((part) => bracket(part.replace(/^\[|\]$/g, '')))
      .join('.');
  }

  return `${bracket(connectionConfigForRole(role).schema)}.${bracket(tableName)}`;
}

function unqualifiedTableName(tableName) {
  const cleaned = String(tableName || '')
    .split('.')
    .pop()
    .replace(/^\[|\]$/g, '')
    .replace(/]]/g, ']');

  return cleaned;
}

function overrideMatchesCompany(override, company) {
  if (!override) {
    return false;
  }

  const tableName = unqualifiedTableName(override);
  const prefix = `${company.prefix}$`;
  return tableName.startsWith(prefix);
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

async function resolveTable(logicalName, override, companyCode, role = 'read') {
  const company = getCompanyConfig(companyCode);
  if (override && overrideMatchesCompany(override, company)) {
    return qualifiedTableName(override, role);
  }

  const connectionConfig = connectionConfigForRole(role);
  const cacheKey = `${role}:${connectionConfig.server}:${connectionConfig.database}:${connectionConfig.schema}:${company.code}:${company.prefix}:${logicalName}`;
  if (tableCache.has(cacheKey)) {
    return tableCache.get(cacheKey);
  }

  const pool = await getPool(role);
  const companyPrefix = `${company.prefix}$`;
  const request = pool.request()
    .input('schema', sql.NVarChar, connectionConfig.schema)
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

  const table = qualifiedTableName(result.recordset[0].TABLE_NAME, role);
  tableCache.set(cacheKey, table);
  return table;
}

async function resolveFirstTable(logicalNames, override, companyCode, role = 'read') {
  if (override) {
    return qualifiedTableName(override, role);
  }

  let lastError;
  for (const logicalName of logicalNames) {
    try {
      return await resolveTable(logicalName, '', companyCode, role);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError;
}

async function resolveFirstOptionalTable(logicalNames, override, companyCode, role = 'read') {
  try {
    return await resolveFirstTable(logicalNames, override, companyCode, role);
  } catch (err) {
    return '';
  }
}

async function resolveOptionalTable(logicalName, override, companyCode, role = 'read') {
  try {
    return await resolveTable(logicalName, override, companyCode, role);
  } catch (err) {
    return '';
  }
}

async function getTables(companyCode, role = 'read') {
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
    resolveTable('Imported Orders', config.tables.importedOrders, companyCode, role),
    resolveTable('Imported SalesAL', config.tables.importedSalesAL, companyCode, role),
    resolveOptionalTable('Imported Return Orders', config.tables.importedReturnOrders, companyCode, role),
    resolveOptionalTable('Imported Credit Notes AL', config.tables.importedCreditNotesAL, companyCode, role),
    resolveTable('Customer', config.tables.customer, companyCode, role),
    resolveOptionalTable(`Customer$${BASE_APP_ID}$ext`, config.tables.customerExt, companyCode, role),
    resolveTable('Item', config.tables.item, companyCode, role),
    resolveOptionalTable(`Item$${BASE_APP_ID}$ext`, config.tables.itemExt, companyCode, role),
    resolveTable('Ship-to Address', config.tables.shipToAddress, companyCode, role),
    resolveOptionalTable(`Ship-to Address$${BASE_APP_ID}$ext`, config.tables.shipToAddressExt, companyCode, role),
    resolveFirstTable(['Salesperson/Purchaser', 'Salesperson_Purchaser'], config.tables.salespersonPurchaser, companyCode, role),
    resolveFirstOptionalTable([
      `Salesperson/Purchaser$${BASE_APP_ID}$ext`,
      `Salesperson_Purchaser$${BASE_APP_ID}$ext`
    ], config.tables.salespersonPurchaserExt, companyCode, role),
    resolveTable('Contact', config.tables.contact, companyCode, role),
    resolveOptionalTable('District Group Code', config.tables.districtGroupCode, companyCode, role),
    resolveTable('Sales Header', config.tables.salesHeader, companyCode, role),
    resolveOptionalTable(`Sales Header$${BASE_APP_ID}$ext`, config.tables.salesHeaderExt, companyCode, role),
    resolveTable('Sales Invoice Header', config.tables.salesInvoiceHeader, companyCode, role),
    resolveTable('Sales Invoice Line', config.tables.salesInvoiceLine, companyCode, role),
    resolveFirstTable(['Sales Cr.Memo Header', 'Sales Cr_Memo Header', 'Sales Cr_ Memo Header'], config.tables.salesCrMemoHeader, companyCode, role)
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
  resolveTable,
  getTables,
  getAllCompanyTables,
  getCompanyConfig,
  bracket,
  runInTestMode,
  isTestMode
};
