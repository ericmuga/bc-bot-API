const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function boolFromEnv(value, fallback) {
  if (value === undefined || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'y'].includes(String(value).toLowerCase());
}

function intFromEnv(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function companyMapFromEnv(value) {
  const fallback = {
    CM: 'CM3',
    FCL: 'FCL1',
    FLM: 'FLM1',
    RMK: 'RMK'
  };

  if (!value) {
    return fallback;
  }

  return value
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((companies, entry) => {
      const [code, prefix] = entry.split('=').map((part) => (part || '').trim());
      if (code && prefix) {
        companies[code.toUpperCase()] = prefix.replace(/\$$/, '');
      }

      return companies;
    }, {});
}

function accessModeFromEnv(value) {
  const normalized = String(value || 'both').trim().toLowerCase();
  if (['sql', 'api', 'bcapi', 'both'].includes(normalized)) {
    return normalized === 'bcapi' ? 'api' : normalized;
  }

  return 'both';
}

function keyValueMapFromEnv(value) {
  if (!value) {
    return {};
  }

  return value
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((map, entry) => {
      const [key, mappedValue] = entry.split('=').map((part) => (part || '').trim());
      if (key && mappedValue) {
        map[key.toUpperCase()] = mappedValue;
      }

      return map;
    }, {});
}

function sqlWriteMirrorFromEnv(name, envPrefix) {
  const enabled = boolFromEnv(process.env[`${envPrefix}_ENABLED`], false);
  const server = process.env[`${envPrefix}_SERVER`] || '';

  if (!enabled && !server) {
    return null;
  }

  return {
    name,
    server,
    port: intFromEnv(process.env[`${envPrefix}_PORT`], intFromEnv(process.env.SQL_WRITE_PORT, intFromEnv(process.env.SQL_PORT, 1433))),
    database: process.env[`${envPrefix}_DATABASE`] || process.env.SQL_WRITE_DATABASE || process.env.SQL_DATABASE || '',
    user: process.env[`${envPrefix}_USER`] || '',
    password: process.env[`${envPrefix}_PASSWORD`] || '',
    encrypt: boolFromEnv(process.env[`${envPrefix}_ENCRYPT`], boolFromEnv(process.env.SQL_WRITE_ENCRYPT, boolFromEnv(process.env.SQL_ENCRYPT, false))),
    trustServerCertificate: boolFromEnv(
      process.env[`${envPrefix}_TRUST_SERVER_CERTIFICATE`],
      boolFromEnv(process.env.SQL_WRITE_TRUST_SERVER_CERTIFICATE, boolFromEnv(process.env.SQL_TRUST_SERVER_CERTIFICATE, true))
    ),
    schema: process.env[`${envPrefix}_SCHEMA`] || process.env.SQL_WRITE_SCHEMA || process.env.SQL_SCHEMA || 'dbo'
  };
}

function bcApiMirrorFromEnv(name, envPrefix) {
  const enabled = boolFromEnv(process.env[`${envPrefix}_ENABLED`], false);
  const baseUrl = process.env[`${envPrefix}_BASE_URL`] || '';

  if (!enabled && !baseUrl) {
    return null;
  }

  return {
    name,
    baseUrl: baseUrl.replace(/\/$/, ''),
    publisher: process.env[`${envPrefix}_PUBLISHER`] || process.env.BC_API_PUBLISHER || 'fcl',
    group: process.env[`${envPrefix}_GROUP`] || process.env.BC_API_GROUP || 'bot',
    version: process.env[`${envPrefix}_VERSION`] || process.env.BC_API_VERSION || 'v1.0',
    companyIds: keyValueMapFromEnv(process.env[`${envPrefix}_COMPANY_IDS`] || process.env.BC_API_COMPANY_IDS),
    username: process.env[`${envPrefix}_USERNAME`] || '',
    password: process.env[`${envPrefix}_PASSWORD`] || process.env[`${envPrefix}_WEB_SERVICE_ACCESS_KEY`] || '',
    bearerToken: process.env[`${envPrefix}_BEARER_TOKEN`] || '',
    timeoutMs: intFromEnv(process.env[`${envPrefix}_TIMEOUT_MS`], intFromEnv(process.env.BC_API_TIMEOUT_MS, 30000))
  };
}

const accessMode = accessModeFromEnv(process.env.BC_ACCESS_MODE);
const companyPrefixes = companyMapFromEnv(process.env.BC_COMPANY_PREFIXES);
const sqlWriteMirrors = [
  sqlWriteMirrorFromEnv('test', 'SQL_WRITE_TEST')
].filter(Boolean);
const bcApiMirrors = [
  bcApiMirrorFromEnv('test', 'BC_API_TEST')
].filter(Boolean);

function defaultCompanyCodeFromEnv() {
  const explicitCode = (process.env.DEFAULT_COMPANY_CODE || '').trim().toUpperCase();
  if (explicitCode) {
    return explicitCode;
  }

  const legacyCompanyName = (process.env.BC_COMPANY_NAME || '').trim().replace(/\$$/, '').toUpperCase();
  const matchingCode = Object.entries(companyPrefixes)
    .find(([, prefix]) => String(prefix).replace(/\$$/, '').toUpperCase() === legacyCompanyName)?.[0];

  return matchingCode || legacyCompanyName || 'FCL';
}

const config = {
  port: intFromEnv(process.env.PORT, 3500),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
  apiKey: process.env.BOT_API_KEY || '',
  access: {
    mode: accessMode,
    sqlEnabled: accessMode === 'sql' || accessMode === 'both',
    apiPagesEnabled: accessMode === 'api' || accessMode === 'both'
  },
  sql: {
    server: process.env.SQL_SERVER || 'localhost',
    port: intFromEnv(process.env.SQL_PORT, 1433),
    database: process.env.SQL_DATABASE || '',
    user: process.env.SQL_USER || '',
    password: process.env.SQL_PASSWORD || '',
    encrypt: boolFromEnv(process.env.SQL_ENCRYPT, false),
    trustServerCertificate: boolFromEnv(process.env.SQL_TRUST_SERVER_CERTIFICATE, true),
    schema: process.env.SQL_SCHEMA || 'dbo',
    companyName: process.env.BC_COMPANY_NAME || ''
  },
  sqlWrite: {
    server: process.env.SQL_WRITE_SERVER || process.env.SQL_SERVER || 'localhost',
    port: intFromEnv(process.env.SQL_WRITE_PORT, intFromEnv(process.env.SQL_PORT, 1433)),
    database: process.env.SQL_WRITE_DATABASE || process.env.SQL_DATABASE || '',
    user: process.env.SQL_WRITE_USER || process.env.SQL_USER || '',
    password: process.env.SQL_WRITE_PASSWORD || process.env.SQL_PASSWORD || '',
    encrypt: boolFromEnv(process.env.SQL_WRITE_ENCRYPT, boolFromEnv(process.env.SQL_ENCRYPT, false)),
    trustServerCertificate: boolFromEnv(process.env.SQL_WRITE_TRUST_SERVER_CERTIFICATE, boolFromEnv(process.env.SQL_TRUST_SERVER_CERTIFICATE, true)),
    schema: process.env.SQL_WRITE_SCHEMA || process.env.SQL_SCHEMA || 'dbo'
  },
  sqlWriteMirrors,
  companies: {
    defaultCode: defaultCompanyCodeFromEnv(),
    prefixes: companyPrefixes
  },
  tables: {
    importedOrders: process.env.SQL_TABLE_IMPORTED_ORDERS || '',
    importedSalesAL: process.env.SQL_TABLE_IMPORTED_SALES_AL || '',
    importedReturnOrders: process.env.SQL_TABLE_IMPORTED_RETURN_ORDERS || '',
    importedCreditNotesAL: process.env.SQL_TABLE_IMPORTED_CREDIT_NOTES_AL || '',
    customer: process.env.SQL_TABLE_CUSTOMER || '',
    customerExt: process.env.SQL_TABLE_CUSTOMER_EXT || '',
    itemUnitOfMeasure: process.env.SQL_TABLE_ITEM_UNIT_OF_MEASURE || '',
    inventoryPostingGroup: process.env.SQL_TABLE_INVENTORY_POSTING_GROUP || '',
    item: process.env.SQL_TABLE_ITEM || '',
    itemExt: process.env.SQL_TABLE_ITEM_EXT || '',
    shipToAddress: process.env.SQL_TABLE_SHIP_TO_ADDRESS || '',
    shipToAddressExt: process.env.SQL_TABLE_SHIP_TO_ADDRESS_EXT || '',
    salespersonPurchaser: process.env.SQL_TABLE_SALESPERSON_PURCHASER || '',
    salespersonPurchaserExt: process.env.SQL_TABLE_SALESPERSON_PURCHASER_EXT || '',
    contact: process.env.SQL_TABLE_CONTACT || '',
    districtGroupCode: process.env.SQL_TABLE_DISTRICT_GROUP_CODE || '',
    salesHeader: process.env.SQL_TABLE_SALES_HEADER || '',
    salesHeaderExt: process.env.SQL_TABLE_SALES_HEADER_EXT || '',
    salesInvoiceHeader: process.env.SQL_TABLE_SALES_INVOICE_HEADER || '',
    salesPrice: process.env.SQL_TABLE_SALES_PRICE || '',
    salesInvoiceLine: process.env.SQL_TABLE_SALES_INVOICE_LINE || '',
    salesCrMemoHeader: process.env.SQL_TABLE_SALES_CR_MEMO_HEADER || ''
  },
  bcApi: {
    baseUrl: (process.env.BC_API_BASE_URL || '').replace(/\/$/, ''),
    publisher: process.env.BC_API_PUBLISHER || 'fcl',
    group: process.env.BC_API_GROUP || 'bot',
    version: process.env.BC_API_VERSION || 'v1.0',
    companyIds: keyValueMapFromEnv(process.env.BC_API_COMPANY_IDS),
    username: process.env.BC_API_USERNAME || '',
    password: process.env.BC_API_PASSWORD || process.env.BC_API_WEB_SERVICE_ACCESS_KEY || '',
    bearerToken: process.env.BC_API_BEARER_TOKEN || '',
    timeoutMs: intFromEnv(process.env.BC_API_TIMEOUT_MS, 30000)
  },
  bcApiMirrors,
  filters: {
    customers: process.env.CUSTOMERS_WHERE || '[Web Portal] = 1 AND [Blocked] = 0',
    items: process.env.ITEMS_WHERE || '[PDA Item] = 1 AND [Blocked] = 0'
  },
  defaults: {
    importedOrderStatus: intFromEnv(process.env.DEFAULT_IMPORTED_ORDER_STATUS, 0),
    limit: intFromEnv(process.env.DEFAULT_LIMIT, 100),
    maxLimit: intFromEnv(process.env.MAX_LIMIT, 1000),
    importDuplicateRecheckDelayMs: intFromEnv(process.env.IMPORT_DUPLICATE_RECHECK_DELAY_MS, 5000)
  }
};

// Global attributes are shared by every company and read from the designated server.
config.sqlItemAttributes = {
  ...config.sql,
  server: process.env.SQL_ITEM_ATTRIBUTES_SERVER || '172.16.10.8',
  port: intFromEnv(process.env.SQL_ITEM_ATTRIBUTES_PORT, 1433),
  database: process.env.SQL_ITEM_ATTRIBUTES_DATABASE || 'FCL',
  user: process.env.SQL_ITEM_ATTRIBUTES_USER || config.sql.user,
  password: process.env.SQL_ITEM_ATTRIBUTES_PASSWORD || config.sql.password,
  schema: process.env.SQL_ITEM_ATTRIBUTES_SCHEMA || 'dbo'
};
config.tables.itemAttributes = process.env.SQL_TABLE_ITEM_ATTRIBUTES || 'Item Attributes$23dc970e-11e8-4d9b-8613-b7582aec86ba';

module.exports = config;
