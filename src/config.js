require('dotenv').config();

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

const accessMode = accessModeFromEnv(process.env.BC_ACCESS_MODE);

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
  companies: {
    defaultCode: (process.env.DEFAULT_COMPANY_CODE || process.env.BC_COMPANY_NAME || 'FCL').toUpperCase(),
    prefixes: companyMapFromEnv(process.env.BC_COMPANY_PREFIXES)
  },
  tables: {
    importedOrders: process.env.SQL_TABLE_IMPORTED_ORDERS || '',
    importedSalesAL: process.env.SQL_TABLE_IMPORTED_SALES_AL || '',
    importedReturnOrders: process.env.SQL_TABLE_IMPORTED_RETURN_ORDERS || '',
    importedCreditNotesAL: process.env.SQL_TABLE_IMPORTED_CREDIT_NOTES_AL || '',
    customer: process.env.SQL_TABLE_CUSTOMER || '',
    customerExt: process.env.SQL_TABLE_CUSTOMER_EXT || '',
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

module.exports = config;
