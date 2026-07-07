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

const config = {
  port: intFromEnv(process.env.PORT, 3500),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
  apiKey: process.env.BOT_API_KEY || '',
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
    item: process.env.SQL_TABLE_ITEM || '',
    shipToAddress: process.env.SQL_TABLE_SHIP_TO_ADDRESS || '',
    salespersonPurchaser: process.env.SQL_TABLE_SALESPERSON_PURCHASER || '',
    contact: process.env.SQL_TABLE_CONTACT || '',
    salesHeader: process.env.SQL_TABLE_SALES_HEADER || '',
    salesInvoiceHeader: process.env.SQL_TABLE_SALES_INVOICE_HEADER || '',
    salesCrMemoHeader: process.env.SQL_TABLE_SALES_CR_MEMO_HEADER || ''
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
