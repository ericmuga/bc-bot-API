const express = require('express');
const { sql, getPool, getTables, getAllCompanyTables, getCompanyConfig, bracket } = require('./db');
const config = require('./config');

const router = express.Router();

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function limitFromQuery(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return config.defaults.limit;
  }

  return Math.min(parsed, config.defaults.maxLimit);
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    const error = new Error(`${name} is required.`);
    error.statusCode = 400;
    throw error;
  }

  return value.trim();
}

function optionalString(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}

function companyFromRequest(req) {
  return optionalString(req.params.company || req.query.company || req.body?.company || config.companies.defaultCode).toUpperCase();
}

function maskedValue(value) {
  if (!value) {
    return '';
  }

  const text = String(value);
  if (text.length <= 2) {
    return '*'.repeat(text.length);
  }

  return `${text[0]}${'*'.repeat(Math.max(text.length - 2, 1))}${text[text.length - 1]}`;
}

function maskedDatabaseInfo(companyCode) {
  const company = getCompanyConfig(companyCode);
  return {
    server: maskedValue(config.sql.server),
    database: maskedValue(config.sql.database),
    schema: config.sql.schema,
    defaultCompany: config.companies.defaultCode,
    selectedCompany: company.code,
    selectedPrefix: `${company.prefix}$`
  };
}

function requiredNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    const error = new Error(`${name} must be a number.`);
    error.statusCode = 400;
    throw error;
  }

  return parsed;
}

function optionalNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'n'].includes(normalized)) {
    return false;
  }

  const error = new Error('pdaOrder must be a boolean.');
  error.statusCode = 400;
  throw error;
}

function toBcDate(value, name) {
  const text = requireString(value, name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const error = new Error(`${name} must be in YYYY-MM-DD format.`);
    error.statusCode = 400;
    throw error;
  }

  return text;
}

function documentTypeFromValue(value) {
  const normalized = optionalString(value || 'order').toLowerCase().replace(/[\s_-]/g, '');
  if (['order', 'orders', 'salesorder', 'salesorders'].includes(normalized)) {
    return 'order';
  }

  if (['invoice', 'invoices', 'salesinvoice', 'salesinvoices'].includes(normalized)) {
    return 'invoice';
  }

  if (['returnorder', 'returnorders', 'salesreturnorder', 'salesreturnorders', 'return', 'returns'].includes(normalized)) {
    return 'returnOrder';
  }

  if (['creditnote', 'creditnotes', 'creditmemo', 'creditmemos', 'salescreditmemo', 'salescreditmemos'].includes(normalized)) {
    return 'creditNote';
  }

  const error = new Error('documentType must be one of order, invoice, returnOrder, or creditNote.');
  error.statusCode = 400;
  throw error;
}

function importedOrderStatusName(status) {
  const statuses = ['Order', 'Execute', 'Post', 'Cancelled', 'Error'];
  return statuses[Number(status)] || 'Unknown';
}

function importedReturnOrderStatusName(status) {
  const statuses = ['Pending', 'Processed', 'Cancelled', 'Error'];
  return statuses[Number(status)] || 'Unknown';
}

function importedOrderStatusValue(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const statusByName = {
    order: 0,
    execute: 1,
    post: 2,
    cancelled: 3,
    canceled: 3,
    error: 4
  };
  const normalized = String(value).trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(statusByName, normalized)) {
    return statusByName[normalized];
  }

  const parsed = Number.parseInt(normalized, 10);
  if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 4) {
    return parsed;
  }

  const error = new Error('status must be one of Order, Execute, Post, Cancelled, Error, or 0-4.');
  error.statusCode = 400;
  throw error;
}

function unquoteSqlIdentifier(value) {
  return String(value || '').replace(/^\[/, '').replace(/\]$/, '').replace(/]]/g, ']');
}

function splitQualifiedTableName(qualifiedTableName) {
  const parts = String(qualifiedTableName)
    .split(/\]\.\[/)
    .map(unquoteSqlIdentifier);

  if (parts.length === 2) {
    return {
      schema: parts[0],
      table: parts[1]
    };
  }

  return {
    schema: config.sql.schema,
    table: unquoteSqlIdentifier(qualifiedTableName)
  };
}

async function getExistingColumns(pool, qualifiedTableName, columnNames) {
  const tableInfo = splitQualifiedTableName(qualifiedTableName);
  const request = pool.request()
    .input('schema', sql.NVarChar, tableInfo.schema)
    .input('table', sql.NVarChar, tableInfo.table);
  const parameterNames = columnNames.map((columnName, index) => {
    const parameterName = `column${index}`;
    request.input(parameterName, sql.NVarChar, columnName);
    return `@${parameterName}`;
  });

  const result = await request.query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @schema
      AND TABLE_NAME = @table
      AND COLUMN_NAME IN (${parameterNames.join(', ')})
  `);

  return new Set(result.recordset.map((row) => row.COLUMN_NAME));
}

async function buildColumnAwareWhere(pool, qualifiedTableName, requestedFilters) {
  const existingColumns = await getExistingColumns(
    pool,
    qualifiedTableName,
    requestedFilters.map((filter) => filter.column)
  );
  const filters = requestedFilters
    .filter((filter) => existingColumns.has(filter.column))
    .map((filter) => `${bracket(filter.column)} ${filter.operator} ${filter.value}`);

  return filters.length ? filters.join(' AND ') : '1 = 1';
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function salesHeaderDocumentTypeName(documentType) {
  const documentTypes = ['Quote', 'Order', 'Invoice', 'Credit Memo', 'Blanket Order', 'Return Order'];
  return documentTypes[Number(documentType)] || 'Unknown';
}

function salesHeaderStatusName(status) {
  const statuses = ['Open', 'Released', 'Pending Approval', 'Pending Prepayment', 'Execute', 'Post'];
  return statuses[Number(status)] || 'Unknown';
}

function summarizeImportedOrderStatus(lines) {
  const counts = lines.reduce((summary, line) => {
    summary[line.statusName] = (summary[line.statusName] || 0) + 1;
    return summary;
  }, {});

  if (counts.Error) {
    return { state: 'error', counts };
  }

  if (counts.Cancelled && counts.Cancelled === lines.length) {
    return { state: 'cancelled', counts };
  }

  if (counts.Post && counts.Post === lines.length) {
    return { state: 'salesOrder', counts };
  }

  if (counts.Execute) {
    return { state: 'processing', counts };
  }

  return { state: 'imported', counts };
}

function summarizeImportedReturnOrderStatus(lines) {
  const counts = lines.reduce((summary, line) => {
    summary[line.statusName] = (summary[line.statusName] || 0) + 1;
    return summary;
  }, {});

  if (counts.Error) {
    return { state: 'error', counts };
  }

  if (counts.Cancelled && counts.Cancelled === lines.length) {
    return { state: 'cancelled', counts };
  }

  if (counts.Processed && counts.Processed === lines.length) {
    return { state: 'salesReturnOrder', counts };
  }

  return { state: 'imported', counts };
}

function summarizeImportedSalesLikeStatus(lines) {
  const executedCount = lines.filter((line) => line.executed).length;
  const postedCount = lines.filter((line) => line.posted).length;
  const errorCount = collectLineErrors(lines).length;

  return {
    state: errorCount ? 'error' : postedCount === lines.length ? 'posted' : executedCount ? 'processing' : 'imported',
    counts: {
      imported: lines.length - executedCount,
      executed: executedCount,
      posted: postedCount,
      error: errorCount
    }
  };
}

function collectLineErrors(lines) {
  return lines
    .filter((line) => line.error || line.statusName === 'Error')
    .map((line) => ({
      externalDocumentNo: line.externalDocumentNo,
      lineNo: line.lineNo,
      itemNo: line.itemNo,
      errorMessage: line.errorMessage || (line.statusName === 'Error' ? 'Line is marked as Error in Business Central.' : '')
    }));
}

function buildBcOrderStatus(externalDocumentNo, importedLines, importedSalesLines, importedReturnLines, importedCreditNoteLines, salesDocuments) {
  const importedSummary = summarizeImportedOrderStatus(importedLines);
  const importedReturnSummary = summarizeImportedReturnOrderStatus(importedReturnLines);
  const importedSalesSummary = summarizeImportedSalesLikeStatus(importedSalesLines);
  const importedCreditNoteSummary = summarizeImportedSalesLikeStatus(importedCreditNoteLines);
  const errors = [
    ...collectLineErrors(importedLines),
    ...collectLineErrors(importedSalesLines),
    ...collectLineErrors(importedReturnLines),
    ...collectLineErrors(importedCreditNoteLines)
  ];

  if (salesDocuments.postedInvoices.length) {
    const invoice = salesDocuments.postedInvoices[0];
    return {
      externalDocumentNo,
      orderStatus: 'Invoiced',
      bcStage: 'Posted Sales Invoice',
      sourceTable: 'Sales Invoice Header',
      documentNo: invoice.invoiceNo,
      documentType: 'Invoice',
      postingDate: invoice.postingDate,
      sellToCustomerNo: invoice.sellToCustomerNo,
      importedOrderState: importedSummary.state,
      statusCounts: importedSummary.counts,
      errors,
      salesDocuments
    };
  }

  if (salesDocuments.postedCreditMemos.length) {
    const creditMemo = salesDocuments.postedCreditMemos[0];
    return {
      externalDocumentNo,
      orderStatus: 'Posted Credit Memo',
      bcStage: 'Posted Sales Credit Memo',
      sourceTable: 'Sales Cr.Memo Header',
      documentNo: creditMemo.creditMemoNo,
      documentType: 'Credit Memo',
      postingDate: creditMemo.postingDate,
      sellToCustomerNo: creditMemo.sellToCustomerNo,
      statusCounts: importedCreditNoteSummary.counts,
      errors,
      salesDocuments
    };
  }

  if (salesDocuments.salesHeaders.length) {
    const salesHeader = salesDocuments.salesHeaders[0];
    return {
      externalDocumentNo,
      orderStatus: salesHeaderStatusName(salesHeader.status),
      bcStage: 'Sales Header',
      sourceTable: 'Sales Header',
      documentNo: salesHeader.documentNo,
      documentType: salesHeaderDocumentTypeName(salesHeader.documentType),
      documentTypeValue: salesHeader.documentType,
      statusValue: salesHeader.status,
      sellToCustomerNo: salesHeader.sellToCustomerNo,
      importedOrderState: importedSummary.state,
      statusCounts: importedSummary.counts,
      errors,
      salesDocuments
    };
  }

  if (importedLines.length) {
    return {
      externalDocumentNo,
      orderStatus: importedSummary.state,
      bcStage: 'Imported Orders',
      sourceTable: 'Imported Orders',
      documentNo: externalDocumentNo,
      lineCount: importedLines.length,
      statusCounts: importedSummary.counts,
      expectedLineCount: importedLines[0]?.expectedLineCount || 0,
      errors,
      salesDocuments
    };
  }

  if (importedSalesLines.length) {
    return {
      externalDocumentNo,
      orderStatus: importedSalesSummary.state,
      bcStage: 'Imported SalesAL',
      sourceTable: 'Imported SalesAL',
      documentNo: externalDocumentNo,
      documentType: 'Invoice',
      lineCount: importedSalesLines.length,
      expectedLineCount: importedSalesLines[0]?.expectedLineCount || 0,
      statusCounts: importedSalesSummary.counts,
      errors,
      salesDocuments
    };
  }

  if (importedReturnLines.length) {
    return {
      externalDocumentNo,
      orderStatus: importedReturnSummary.state,
      bcStage: 'Imported Return Orders',
      sourceTable: 'Imported Return Orders',
      documentNo: externalDocumentNo,
      documentType: 'Return Order',
      lineCount: importedReturnLines.length,
      statusCounts: importedReturnSummary.counts,
      errors,
      salesDocuments
    };
  }

  if (importedCreditNoteLines.length) {
    return {
      externalDocumentNo,
      orderStatus: importedCreditNoteSummary.state,
      bcStage: 'Imported Credit Notes AL',
      sourceTable: 'Imported Credit Notes AL',
      documentNo: externalDocumentNo,
      documentType: 'Credit Note',
      lineCount: importedCreditNoteLines.length,
      expectedLineCount: importedCreditNoteLines[0]?.expectedLineCount || 0,
      statusCounts: importedCreditNoteSummary.counts,
      errors,
      salesDocuments
    };
  }

  return null;
}

async function getSalesDocumentsByExternalDocumentNo(pool, tables, externalDocumentNo) {
  const salesHeaderResult = await pool.request()
    .input('externalDocumentNo', sql.NVarChar, externalDocumentNo)
    .query(`
      SELECT
        ${bracket('No_')} AS documentNo,
        ${bracket('Document Type')} AS documentType,
        ${bracket('Status')} AS status,
        ${bracket('Sell-to Customer No_')} AS sellToCustomerNo,
        ${bracket('External Document No_')} AS externalDocumentNo
      FROM ${tables.salesHeader}
      WHERE ${bracket('External Document No_')} = @externalDocumentNo
    `);

  const postedInvoiceResult = await pool.request()
    .input('externalDocumentNo', sql.NVarChar, externalDocumentNo)
    .query(`
      SELECT
        ${bracket('No_')} AS invoiceNo,
        ${bracket('Posting Date')} AS postingDate,
        ${bracket('Sell-to Customer No_')} AS sellToCustomerNo,
        ${bracket('External Document No_')} AS externalDocumentNo
      FROM ${tables.salesInvoiceHeader}
      WHERE ${bracket('External Document No_')} = @externalDocumentNo
    `);

  const postedCreditMemoResult = await pool.request()
    .input('externalDocumentNo', sql.NVarChar, externalDocumentNo)
    .query(`
      SELECT
        ${bracket('No_')} AS creditMemoNo,
        ${bracket('Posting Date')} AS postingDate,
        ${bracket('Sell-to Customer No_')} AS sellToCustomerNo,
        ${bracket('External Document No_')} AS externalDocumentNo
      FROM ${tables.salesCrMemoHeader}
      WHERE ${bracket('External Document No_')} = @externalDocumentNo
    `);

  return {
    salesHeaders: salesHeaderResult.recordset,
    postedInvoices: postedInvoiceResult.recordset,
    postedCreditMemos: postedCreditMemoResult.recordset
  };
}

async function getImportedOrderLinesByExternalDocumentNo(pool, tables, externalDocumentNo) {
  const result = await pool.request()
    .input('externalDocumentNo', sql.NVarChar, externalDocumentNo)
    .query(`
      SELECT
        ${bracket('External Document No_')} AS externalDocumentNo,
        ${bracket('Line No_')} AS lineNo,
        ${bracket('Item No_')} AS itemNo,
        ${bracket('Quantity')} AS quantity,
        ${bracket('Status')} AS status,
        ${bracket('Expected Line Count')} AS expectedLineCount,
        ${bracket('Error Message')} AS errorMessage,
        ${bracket('PDA Order')} AS pdaOrder,
        ${bracket('Product Specification')} AS productSpecification
      FROM ${tables.importedOrders}
      WHERE ${bracket('External Document No_')} = @externalDocumentNo
      ORDER BY ${bracket('Line No_')}
    `);

  return result.recordset.map((line) => ({
    ...line,
    statusName: importedOrderStatusName(line.status)
  }));
}

async function getImportedSalesLinesByExternalDocumentNo(pool, tables, externalDocumentNo) {
  const result = await pool.request()
    .input('externalDocumentNo', sql.NVarChar, externalDocumentNo)
    .query(`
      SELECT
        ${bracket('ExtDocNo')} AS externalDocumentNo,
        ${bracket('LineNo')} AS lineNo,
        ${bracket('ItemNo')} AS itemNo,
        ${bracket('Qty')} AS quantity,
        ${bracket('SUOM')} AS unitOfMeasure,
        ${bracket('UnitPrice')} AS unitPrice,
        ${bracket('LineAmount')} AS lineAmount,
        ${bracket('Executed')} AS executed,
        ${bracket('Posted')} AS posted,
        ${bracket('Expected Line Count')} AS expectedLineCount,
        ${bracket('Error')} AS error,
        ${bracket('Error Message')} AS errorMessage
      FROM ${tables.importedSalesAL}
      WHERE ${bracket('ExtDocNo')} = @externalDocumentNo
      ORDER BY ${bracket('LineNo')}
    `);

  return result.recordset;
}

async function getImportedReturnLinesByExternalDocumentNo(pool, tables, externalDocumentNo) {
  if (!tables.importedReturnOrders) {
    return [];
  }

  const result = await pool.request()
    .input('externalDocumentNo', sql.NVarChar, externalDocumentNo)
    .query(`
      SELECT
        ${bracket('External Document No_')} AS externalDocumentNo,
        ${bracket('Line No_')} AS lineNo,
        ${bracket('Item No_')} AS itemNo,
        ${bracket('Quantity')} AS quantity,
        ${bracket('Unit of Measure')} AS unitOfMeasure,
        ${bracket('Status')} AS status,
        ${bracket('Return Reason Code')} AS returnReasonCode,
        ${bracket('Original Order No_')} AS originalOrderNo,
        ${bracket('Error Text')} AS errorMessage
      FROM ${tables.importedReturnOrders}
      WHERE ${bracket('External Document No_')} = @externalDocumentNo
      ORDER BY ${bracket('Line No_')}
    `);

  return result.recordset.map((line) => ({
    ...line,
    statusName: importedReturnOrderStatusName(line.status)
  }));
}

async function getImportedCreditNoteLinesByExternalDocumentNo(pool, tables, externalDocumentNo) {
  if (!tables.importedCreditNotesAL) {
    return [];
  }

  const result = await pool.request()
    .input('externalDocumentNo', sql.NVarChar, externalDocumentNo)
    .query(`
      SELECT
        ${bracket('ExtDocNo')} AS externalDocumentNo,
        ${bracket('LineNo')} AS lineNo,
        ${bracket('ItemNo')} AS itemNo,
        ${bracket('Qty')} AS quantity,
        ${bracket('SUOM')} AS unitOfMeasure,
        ${bracket('UnitPrice')} AS unitPrice,
        ${bracket('LineAmount')} AS lineAmount,
        ${bracket('Executed')} AS executed,
        ${bracket('Posted')} AS posted,
        ${bracket('Expected Line Count')} AS expectedLineCount,
        ${bracket('Error')} AS error,
        ${bracket('Error Message')} AS errorMessage,
        ${bracket('Tax Applied Document No_')} AS taxAppliedDocumentNo
      FROM ${tables.importedCreditNotesAL}
      WHERE ${bracket('ExtDocNo')} = @externalDocumentNo
      ORDER BY ${bracket('LineNo')}
    `);

  return result.recordset;
}

async function findExistingExternalDocument(pool, tables, externalDocumentNo) {
  const [importedLines, importedSalesLines, importedReturnLines, importedCreditNoteLines, salesDocuments] = await Promise.all([
    getImportedOrderLinesByExternalDocumentNo(pool, tables, externalDocumentNo),
    getImportedSalesLinesByExternalDocumentNo(pool, tables, externalDocumentNo),
    getImportedReturnLinesByExternalDocumentNo(pool, tables, externalDocumentNo),
    getImportedCreditNoteLinesByExternalDocumentNo(pool, tables, externalDocumentNo),
    getSalesDocumentsByExternalDocumentNo(pool, tables, externalDocumentNo)
  ]);
  const matches = [];

  if (importedLines.length) {
    matches.push({
      sourceTable: 'Imported Orders',
      count: importedLines.length
    });
  }

  if (importedSalesLines.length) {
    matches.push({
      sourceTable: 'Imported SalesAL',
      count: importedSalesLines.length
    });
  }

  if (importedReturnLines.length) {
    matches.push({
      sourceTable: 'Imported Return Orders',
      count: importedReturnLines.length
    });
  }

  if (importedCreditNoteLines.length) {
    matches.push({
      sourceTable: 'Imported Credit Notes AL',
      count: importedCreditNoteLines.length
    });
  }

  if (salesDocuments.salesHeaders.length) {
    matches.push({
      sourceTable: 'Sales Header',
      count: salesDocuments.salesHeaders.length,
      documents: salesDocuments.salesHeaders.map((document) => document.documentNo)
    });
  }

  if (salesDocuments.postedInvoices.length) {
    matches.push({
      sourceTable: 'Sales Invoice Header',
      count: salesDocuments.postedInvoices.length,
      documents: salesDocuments.postedInvoices.map((document) => document.invoiceNo)
    });
  }

  if (salesDocuments.postedCreditMemos.length) {
    matches.push({
      sourceTable: 'Sales Cr.Memo Header',
      count: salesDocuments.postedCreditMemos.length,
      documents: salesDocuments.postedCreditMemos.map((document) => document.creditMemoNo)
    });
  }

  return matches;
}

async function assertExternalDocumentCanBeImported(pool, tables, companyCode, externalDocumentNo) {
  const beforeDelayMatches = await findExistingExternalDocument(pool, tables, externalDocumentNo);
  if (beforeDelayMatches.length) {
    const error = new Error('External document number already exists in Business Central.');
    error.statusCode = 409;
    error.details = {
      company: companyCode,
      externalDocumentNo,
      matches: beforeDelayMatches
    };
    throw error;
  }

  const delayMs = config.defaults.importDuplicateRecheckDelayMs;
  if (delayMs > 0) {
    await delay(delayMs);
  }

  const afterDelayMatches = await findExistingExternalDocument(pool, tables, externalDocumentNo);
  if (afterDelayMatches.length) {
    const error = new Error('External document number appeared in Business Central during import safety recheck.');
    error.statusCode = 409;
    error.details = {
      company: companyCode,
      externalDocumentNo,
      delayMs,
      matches: afterDelayMatches
    };
    throw error;
  }
}

async function sendExternalDocumentStatus(req, res, companyCode) {
  const pool = await getPool();
  const company = getCompanyConfig(companyCode);
  const tables = await getTables(company.code);
  const externalDocumentNo = requireString(req.params.externalDocumentNo, 'externalDocumentNo');
  const [salesDocuments, importedLines, importedSalesLines, importedReturnLines, importedCreditNoteLines] = await Promise.all([
    getSalesDocumentsByExternalDocumentNo(pool, tables, externalDocumentNo),
    getImportedOrderLinesByExternalDocumentNo(pool, tables, externalDocumentNo),
    getImportedSalesLinesByExternalDocumentNo(pool, tables, externalDocumentNo),
    getImportedReturnLinesByExternalDocumentNo(pool, tables, externalDocumentNo),
    getImportedCreditNoteLinesByExternalDocumentNo(pool, tables, externalDocumentNo)
  ]);
  const status = buildBcOrderStatus(externalDocumentNo, importedLines, importedSalesLines, importedReturnLines, importedCreditNoteLines, salesDocuments);

  if (!status) {
    return res.status(404).json({ error: 'Document not found in imported staging, Sales Header, Sales Invoice Header, or Sales Cr.Memo Header.' });
  }

  return res.json({ company: company.code, ...status });
}

async function getExternalDocumentStatus(pool, tables, externalDocumentNo) {
  const [salesDocuments, importedLines, importedSalesLines, importedReturnLines, importedCreditNoteLines] = await Promise.all([
    getSalesDocumentsByExternalDocumentNo(pool, tables, externalDocumentNo),
    getImportedOrderLinesByExternalDocumentNo(pool, tables, externalDocumentNo),
    getImportedSalesLinesByExternalDocumentNo(pool, tables, externalDocumentNo),
    getImportedReturnLinesByExternalDocumentNo(pool, tables, externalDocumentNo),
    getImportedCreditNoteLinesByExternalDocumentNo(pool, tables, externalDocumentNo)
  ]);

  return buildBcOrderStatus(
    externalDocumentNo,
    importedLines,
    importedSalesLines,
    importedReturnLines,
    importedCreditNoteLines,
    salesDocuments
  );
}

function addImportedOrderFilter(filters, request, query, queryName, sqlType, columnName, parameterName = queryName) {
  const value = optionalString(query[queryName]);
  if (!value) {
    return;
  }

  request.input(parameterName, sqlType, value);
  filters.push(`${bracket(columnName)} = @${parameterName}`);
}

router.get('/health', asyncHandler(async (req, res) => {
  const pool = await getPool();
  await pool.request().query('SELECT 1 AS ok');
  const companyCode = companyFromRequest(req);
  res.json({
    ok: true,
    database: maskedDatabaseInfo(companyCode)
  });
}));

router.get('/status', asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  const pool = await getPool();
  await pool.request().query('SELECT 1 AS ok');
  const companyCode = companyFromRequest(req);
  const tables = optionalString(req.query.company)
    ? await getTables(companyCode)
    : await getAllCompanyTables();

  res.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    database: maskedDatabaseInfo(companyCode),
    tables,
    companies: Object.keys(config.companies.prefixes).map((code) => ({
      code,
      prefix: `${config.companies.prefixes[code]}$`
    })),
  defaults: {
      importedOrderStatus: config.defaults.importedOrderStatus,
      importedOrderStatusName: importedOrderStatusName(config.defaults.importedOrderStatus),
      limit: config.defaults.limit,
      maxLimit: config.defaults.maxLimit,
      importDuplicateRecheckDelayMs: config.defaults.importDuplicateRecheckDelayMs
    }
  });
}));

router.post('/status/batch', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const companyCode = companyFromRequest(req);
  const company = getCompanyConfig(companyCode);
  const externalDocumentNos = Array.isArray(body.externalDocumentNos)
    ? body.externalDocumentNos.map((value) => optionalString(value)).filter(Boolean)
    : [];

  if (!externalDocumentNos.length) {
    return res.status(400).json({ error: 'externalDocumentNos must be a non-empty array.' });
  }

  const uniqueExternalDocumentNos = [...new Set(externalDocumentNos)];
  const pool = await getPool();
  const tables = await getTables(company.code);
  const data = [];

  for (const externalDocumentNo of uniqueExternalDocumentNos) {
    const status = await getExternalDocumentStatus(pool, tables, externalDocumentNo);
    data.push(status
      ? { company: company.code, found: true, ...status }
      : {
        company: company.code,
        found: false,
        externalDocumentNo,
        orderStatus: 'notFound',
        bcStage: 'Not Found',
        sourceTable: ''
      });
  }

  res.json({
    company: company.code,
    count: data.length,
    data
  });
}));

router.get('/status/:externalDocumentNo', asyncHandler(async (req, res) => {
  const companyCode = companyFromRequest(req);
  return sendExternalDocumentStatus(req, res, companyCode);
}));

router.get('/:company/status/:externalDocumentNo', asyncHandler(async (req, res) => {
  const companyCode = companyFromRequest(req);
  return sendExternalDocumentStatus(req, res, companyCode);
}));

router.get('/customers', asyncHandler(async (req, res) => {
  const pool = await getPool();
  const companyCode = companyFromRequest(req);
  const { customer, shipToAddress } = await getTables(companyCode);
  const limit = limitFromQuery(req.query.limit);
  const search = optionalString(req.query.search);

  const request = pool.request()
    .input('limit', sql.Int, limit)
    .input('search', sql.NVarChar, `%${search}%`);
  const customerWhere = await buildColumnAwareWhere(pool, customer, [
    { column: 'Web Portal', operator: '=', value: '1' },
    { column: 'Blocked', operator: '=', value: '0' }
  ]);

  const searchClause = search
    ? `AND (${bracket('No_')} LIKE @search OR ${bracket('Name')} LIKE @search)`
    : '';

  const result = await request.query(`
    WITH FilteredCustomers AS (
      SELECT TOP (@limit)
        ${bracket('No_')} AS customerNo,
        ${bracket('Name')} AS name
      FROM ${customer}
      WHERE ${customerWhere}
        ${searchClause}
      ORDER BY ${bracket('No_')}
    )
    SELECT
      fc.customerNo AS id,
      fc.customerNo,
      fc.name,
      sta.${bracket('Code')} AS shipToCode,
      sta.${bracket('Name')} AS shipToName
    FROM FilteredCustomers fc
    LEFT JOIN ${shipToAddress} sta
      ON sta.${bracket('Customer No_')} = fc.customerNo
    ORDER BY fc.customerNo, sta.${bracket('Code')}
  `);

  const customers = [];
  const byCustomerNo = new Map();
  for (const row of result.recordset) {
    let customerRow = byCustomerNo.get(row.customerNo);
    if (!customerRow) {
      customerRow = {
        id: row.customerNo,
        customerNo: row.customerNo,
        name: row.name,
        shipTo: []
      };
      byCustomerNo.set(row.customerNo, customerRow);
      customers.push(customerRow);
    }

    if (row.shipToCode) {
      customerRow.shipTo.push({
        code: row.shipToCode,
        name: row.shipToName || ''
      });
    }
  }

  res.json({ company: getCompanyConfig(companyCode).code, data: customers });
}));

router.get('/items', asyncHandler(async (req, res) => {
  const pool = await getPool();
  const companyCode = companyFromRequest(req);
  const { item } = await getTables(companyCode);
  const limit = limitFromQuery(req.query.limit);
  const search = optionalString(req.query.search);

  const request = pool.request()
    .input('limit', sql.Int, limit)
    .input('search', sql.NVarChar, `%${search}%`);
  const itemWhere = await buildColumnAwareWhere(pool, item, [
    { column: 'PDA Item', operator: '=', value: '1' },
    { column: 'Blocked', operator: '=', value: '0' }
  ]);

  const searchClause = search
    ? `AND (${bracket('No_')} LIKE @search OR ${bracket('Description')} LIKE @search)`
    : '';

  const result = await request.query(`
    SELECT TOP (@limit)
      ${bracket('No_')} AS id,
      ${bracket('No_')} AS itemNo,
      ${bracket('Description')} AS description,
      ${bracket('Base Unit of Measure')} AS baseUnitOfMeasure,
      ${bracket('Sales Unit of Measure')} AS salesUnitOfMeasure
    FROM ${item}
    WHERE ${itemWhere}
      ${searchClause}
    ORDER BY ${bracket('No_')}
  `);

  res.json({ company: getCompanyConfig(companyCode).code, data: result.recordset });
}));

router.get('/salespeople', asyncHandler(async (req, res) => {
  const pool = await getPool();
  const companyCode = companyFromRequest(req);
  const { salespersonPurchaser, contact } = await getTables(companyCode);
  const limit = limitFromQuery(req.query.limit);
  const search = optionalString(req.query.search);

  const request = pool.request()
    .input('limit', sql.Int, limit)
    .input('search', sql.NVarChar, `%${search}%`);
  const contactColumns = await getExistingColumns(pool, contact, ['Salesperson Code', 'Phone No_', 'Name', 'No_']);
  const canJoinContacts = contactColumns.has('Salesperson Code') && contactColumns.has('Name');
  const contactCodeSelect = contactColumns.has('No_')
    ? `ct.${bracket('No_')} AS contactCode`
    : `CAST('' AS nvarchar(20)) AS contactCode`;
  const contactPhoneSelect = contactColumns.has('Phone No_')
    ? `ct.${bracket('Phone No_')} AS contactPhone`
    : `CAST('' AS nvarchar(30)) AS contactPhone`;
  const contactJoin = canJoinContacts
    ? `LEFT JOIN ${contact} ct ON ct.${bracket('Salesperson Code')} = sp.salespersonCode`
    : '';
  const contactSelect = canJoinContacts
    ? `${contactCodeSelect}, ct.${bracket('Name')} AS contactName, ${contactPhoneSelect}`
    : `CAST('' AS nvarchar(20)) AS contactCode, CAST(NULL AS nvarchar(100)) AS contactName, CAST('' AS nvarchar(30)) AS contactPhone`;

  const searchClause = search
    ? `WHERE (${bracket('Code')} LIKE @search OR ${bracket('Name')} LIKE @search)`
    : '';

  const result = await request.query(`
    WITH FilteredSalespeople AS (
      SELECT TOP (@limit)
        ${bracket('Code')} AS salespersonCode,
        ${bracket('Name')} AS name
      FROM ${salespersonPurchaser}
      ${searchClause}
      ORDER BY ${bracket('Code')}
    )
    SELECT
      sp.salespersonCode,
      sp.name,
      ${contactSelect}
    FROM FilteredSalespeople sp
    ${contactJoin}
    ORDER BY sp.salespersonCode, contactName
  `);

  const salespeople = [];
  const bySalespersonCode = new Map();
  for (const row of result.recordset) {
    let salesperson = bySalespersonCode.get(row.salespersonCode);
    if (!salesperson) {
      salesperson = {
        salespersonCode: row.salespersonCode,
        name: row.name,
        contacts: []
      };
      bySalespersonCode.set(row.salespersonCode, salesperson);
      salespeople.push(salesperson);
    }

    if (row.contactName) {
      salesperson.contacts.push({
        code: row.contactCode || '',
        name: row.contactName,
        phone: row.contactPhone || ''
      });
    }
  }

  res.json({ company: getCompanyConfig(companyCode).code, data: salespeople });
}));

router.get('/imported-orders', asyncHandler(async (req, res) => {
  const pool = await getPool();
  const companyCode = companyFromRequest(req);
  const { importedOrders } = await getTables(companyCode);
  const limit = limitFromQuery(req.query.limit);
  const request = pool.request()
    .input('limit', sql.Int, limit);
  const filters = [];

  addImportedOrderFilter(filters, request, req.query, 'externalDocumentNo', sql.NVarChar, 'External Document No_');
  addImportedOrderFilter(filters, request, req.query, 'sellToCustomerNo', sql.NVarChar, 'Sell-to Customer No_');
  addImportedOrderFilter(filters, request, req.query, 'customerNo', sql.NVarChar, 'Sell-to Customer No_');
  addImportedOrderFilter(filters, request, req.query, 'salespersonCode', sql.NVarChar, 'Salesperson Code');
  addImportedOrderFilter(filters, request, req.query, 'shipToCode', sql.NVarChar, 'Ship-to Code');
  addImportedOrderFilter(filters, request, req.query, 'shipToName', sql.NVarChar, 'Ship-to Name');
  addImportedOrderFilter(filters, request, req.query, 'itemNo', sql.NVarChar, 'Item No_');

  if (optionalString(req.query.shipmentDate)) {
    request.input('shipmentDate', sql.Date, toBcDate(req.query.shipmentDate, 'shipmentDate'));
    filters.push(`${bracket('Shipment Date')} = @shipmentDate`);
  }

  if (optionalString(req.query.shipmentDateFrom)) {
    request.input('shipmentDateFrom', sql.Date, toBcDate(req.query.shipmentDateFrom, 'shipmentDateFrom'));
    filters.push(`${bracket('Shipment Date')} >= @shipmentDateFrom`);
  }

  if (optionalString(req.query.shipmentDateTo)) {
    request.input('shipmentDateTo', sql.Date, toBcDate(req.query.shipmentDateTo, 'shipmentDateTo'));
    filters.push(`${bracket('Shipment Date')} <= @shipmentDateTo`);
  }

  const status = importedOrderStatusValue(req.query.status);
  if (status !== null) {
    request.input('status', sql.Int, status);
    filters.push(`${bracket('Status')} = @status`);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const result = await request.query(`
    SELECT TOP (@limit)
      ${bracket('Sell-to Customer No_')} AS sellToCustomerNo,
      ${bracket('Shipment Date')} AS shipmentDate,
      ${bracket('Salesperson Code')} AS salespersonCode,
      ${bracket('Ship-to Code')} AS shipToCode,
      ${bracket('External Document No_')} AS externalDocumentNo,
      ${bracket('Item No_')} AS itemNo,
      ${bracket('Quantity')} AS quantity,
      ${bracket('Unit of Measure')} AS unitOfMeasure,
      ${bracket('Ship-to Name')} AS shipToName,
      ${bracket('Line No_')} AS lineNo,
      ${bracket('Status')} AS status,
      ${bracket('Expected Line Count')} AS expectedLineCount,
      ${bracket('Error Message')} AS errorMessage,
      ${bracket('Customer Specification')} AS customerSpecification,
      ${bracket('Company')} AS company,
      ${bracket('External Order URL')} AS externalOrderUrl,
      ${bracket('PDA Order')} AS pdaOrder,
      ${bracket('Product Specification')} AS productSpecification
    FROM ${importedOrders}
    ${whereClause}
    ORDER BY ${bracket('External Document No_')}, ${bracket('Line No_')}
  `);

  res.json({
    company: getCompanyConfig(companyCode).code,
    count: result.recordset.length,
    data: result.recordset.map((line) => ({
      ...line,
      statusName: importedOrderStatusName(line.status)
    }))
  });
}));

router.get('/imported-orders/:externalDocumentNo', asyncHandler(async (req, res) => {
  const pool = await getPool();
  const companyCode = companyFromRequest(req);
  const { importedOrders } = await getTables(companyCode);
  const externalDocumentNo = requireString(req.params.externalDocumentNo, 'externalDocumentNo');

  const result = await pool.request()
    .input('externalDocumentNo', sql.NVarChar, externalDocumentNo)
    .query(`
      SELECT
        ${bracket('Sell-to Customer No_')} AS sellToCustomerNo,
        ${bracket('Shipment Date')} AS shipmentDate,
        ${bracket('Salesperson Code')} AS salespersonCode,
        ${bracket('Ship-to Code')} AS shipToCode,
        ${bracket('External Document No_')} AS externalDocumentNo,
        ${bracket('Item No_')} AS itemNo,
        ${bracket('Quantity')} AS quantity,
        ${bracket('Unit of Measure')} AS unitOfMeasure,
        ${bracket('Ship-to Name')} AS shipToName,
        ${bracket('Line No_')} AS lineNo,
        ${bracket('Status')} AS status,
        ${bracket('Expected Line Count')} AS expectedLineCount,
        ${bracket('Error Message')} AS errorMessage,
        ${bracket('Customer Specification')} AS customerSpecification,
        ${bracket('Company')} AS company,
        ${bracket('External Order URL')} AS externalOrderUrl,
        ${bracket('PDA Order')} AS pdaOrder,
        ${bracket('Product Specification')} AS productSpecification
      FROM ${importedOrders}
      WHERE ${bracket('External Document No_')} = @externalDocumentNo
      ORDER BY ${bracket('Line No_')}
    `);

  if (!result.recordset.length) {
    return res.status(404).json({ error: 'Imported order not found.' });
  }

  return res.json({
    company: getCompanyConfig(companyCode).code,
    externalDocumentNo,
    lines: result.recordset
  });
}));

router.get('/imported-orders/:externalDocumentNo/status', asyncHandler(async (req, res) => {
  const pool = await getPool();
  const companyCode = companyFromRequest(req);
  const tables = await getTables(companyCode);
  const externalDocumentNo = requireString(req.params.externalDocumentNo, 'externalDocumentNo');
  const [lines, importedSalesLines, importedReturnLines, importedCreditNoteLines, status] = await Promise.all([
    getImportedOrderLinesByExternalDocumentNo(pool, tables, externalDocumentNo),
    getImportedSalesLinesByExternalDocumentNo(pool, tables, externalDocumentNo),
    getImportedReturnLinesByExternalDocumentNo(pool, tables, externalDocumentNo),
    getImportedCreditNoteLinesByExternalDocumentNo(pool, tables, externalDocumentNo),
    getExternalDocumentStatus(pool, tables, externalDocumentNo)
  ]);

  if (!status) {
    return res.status(404).json({ error: 'Document not found in imported staging, Sales Header, Sales Invoice Header, or Sales Cr.Memo Header.' });
  }

  const stagedLines = lines.length ? lines : importedSalesLines.length ? importedSalesLines : importedReturnLines.length ? importedReturnLines : importedCreditNoteLines;

  return res.json({
    company: getCompanyConfig(companyCode).code,
    ...status,
    externalDocumentNo,
    state: status.bcStage === 'Posted Sales Invoice'
      ? 'invoiced'
      : status.bcStage === 'Posted Sales Credit Memo'
        ? 'postedCreditMemo'
        : status.bcStage === 'Sales Header'
          ? 'salesHeader'
        : status.importedOrderState || status.orderStatus,
    lineCount: stagedLines.length,
    lines: stagedLines
  });
}));

router.get('/imported-orders/:externalDocumentNo/errors', asyncHandler(async (req, res) => {
  const pool = await getPool();
  const companyCode = companyFromRequest(req);
  const tables = await getTables(companyCode);
  const externalDocumentNo = requireString(req.params.externalDocumentNo, 'externalDocumentNo');
  const [importedLines, importedSalesLines, importedReturnLines, importedCreditNoteLines] = await Promise.all([
    getImportedOrderLinesByExternalDocumentNo(pool, tables, externalDocumentNo),
    getImportedSalesLinesByExternalDocumentNo(pool, tables, externalDocumentNo),
    getImportedReturnLinesByExternalDocumentNo(pool, tables, externalDocumentNo),
    getImportedCreditNoteLinesByExternalDocumentNo(pool, tables, externalDocumentNo)
  ]);
  const errors = [
    ...collectLineErrors(importedLines).map((line) => ({ ...line, sourceTable: 'Imported Orders' })),
    ...collectLineErrors(importedSalesLines).map((line) => ({ ...line, sourceTable: 'Imported SalesAL' })),
    ...collectLineErrors(importedReturnLines).map((line) => ({ ...line, sourceTable: 'Imported Return Orders' })),
    ...collectLineErrors(importedCreditNoteLines).map((line) => ({ ...line, sourceTable: 'Imported Credit Notes AL' }))
  ];

  if (!importedLines.length && !importedSalesLines.length && !importedReturnLines.length && !importedCreditNoteLines.length) {
    return res.status(404).json({ error: 'Imported document not found.' });
  }

  return res.json({
    company: getCompanyConfig(companyCode).code,
    externalDocumentNo,
    lineCount: importedLines.length || importedSalesLines.length || importedReturnLines.length || importedCreditNoteLines.length,
    expectedLineCount: importedLines[0]?.expectedLineCount || importedSalesLines[0]?.expectedLineCount || importedCreditNoteLines[0]?.expectedLineCount || 0,
    errorCount: errors.length,
    errors
  });
}));

router.post('/imported-orders', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const companyCode = companyFromRequest(req);
  const company = getCompanyConfig(companyCode);
  const documentType = documentTypeFromValue(body.documentType);
  const externalDocumentNo = requireString(body.externalDocumentNo, 'externalDocumentNo');
  const sellToCustomerNo = requireString(body.sellToCustomerNo, 'sellToCustomerNo');
  const shipmentDate = toBcDate(body.shipmentDate, 'shipmentDate');
  const salespersonCode = requireString(body.salespersonCode, 'salespersonCode');
  const shipToCode = optionalString(body.shipToCode);
  const shipToName = optionalString(body.shipToName);
  const customerSpecification = optionalString(body.customerSpecification);
  const externalOrderUrl = optionalString(body.externalOrderUrl);
  const pdaOrder = optionalBoolean(body.pdaOrder);
  const location = optionalString(body.location);
  const billTo = optionalString(body.billTo);
  const cuInvoiceNo = optionalString(body.cuInvoiceNo);
  const cuNo = optionalString(body.cuNo);
  const signingTime = optionalString(body.signingTime);
  const returnReasonCode = optionalString(body.returnReasonCode);
  const originalOrderNo = optionalString(body.originalOrderNo);
  const taxAppliedDocumentNo = optionalString(body.taxAppliedDocumentNo || body.appliedInvoiceNo || body.originalInvoiceNo);

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return res.status(400).json({ error: 'lines must contain at least one order line.' });
  }

  const lines = body.lines.map((line, index) => ({
    lineNo: Number.isFinite(Number(line.lineNo)) ? Number(line.lineNo) : (index + 1) * 10000,
    itemNo: requireString(line.itemNo, `lines[${index}].itemNo`),
    quantity: requiredNumber(line.quantity, `lines[${index}].quantity`),
    unitOfMeasure: requireString(line.unitOfMeasure, `lines[${index}].unitOfMeasure`),
    productSpecification: optionalString(line.productSpecification ?? body.productSpecification),
    location: optionalString(line.location || location),
    unitPrice: ['invoice', 'creditNote'].includes(documentType) ? requiredNumber(line.unitPrice, `lines[${index}].unitPrice`) : optionalNumber(line.unitPrice),
    lineAmount: optionalNumber(line.lineAmount, optionalNumber(line.quantity) * optionalNumber(line.unitPrice)),
    returnReasonCode: optionalString(line.returnReasonCode || returnReasonCode),
    originalOrderNo: optionalString(line.originalOrderNo || originalOrderNo)
  }));
  const expectedLineCount = lines.length;
  const totalHeaderQty = optionalNumber(body.totalHeaderQty, lines.reduce((total, line) => total + line.quantity, 0));
  const totalHeaderAmount = optionalNumber(body.totalHeaderAmount, lines.reduce((total, line) => total + line.lineAmount, 0));

  const pool = await getPool();
  const tables = await getTables(company.code);
  await assertExternalDocumentCanBeImported(pool, tables, company.code, externalDocumentNo);
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    for (const line of lines) {
      if (documentType === 'creditNote') {
        if (!tables.importedCreditNotesAL) {
          const error = new Error('Imported Credit Notes AL table is not available for this company. Publish/sync the BC extension or set SQL_TABLE_IMPORTED_CREDIT_NOTES_AL.');
          error.statusCode = 503;
          throw error;
        }

        const request = new sql.Request(transaction)
          .input('sellToCustomerNo', sql.NVarChar, sellToCustomerNo)
          .input('shipmentDate', sql.Date, shipmentDate)
          .input('salespersonCode', sql.NVarChar, salespersonCode)
          .input('shipToCode', sql.NVarChar, shipToCode)
          .input('externalDocumentNo', sql.NVarChar, externalDocumentNo)
          .input('itemNo', sql.NVarChar, line.itemNo)
          .input('quantity', sql.Decimal(38, 20), line.quantity)
          .input('location', sql.NVarChar, line.location)
          .input('unitOfMeasure', sql.NVarChar, line.unitOfMeasure)
          .input('unitPrice', sql.Decimal(38, 20), line.unitPrice)
          .input('shipToName', sql.NVarChar, shipToName)
          .input('totalHeaderAmount', sql.Decimal(38, 20), totalHeaderAmount)
          .input('lineAmount', sql.Decimal(38, 20), line.lineAmount)
          .input('totalHeaderQty', sql.Decimal(38, 20), totalHeaderQty)
          .input('lineNo', sql.Int, line.lineNo)
          .input('type', sql.Int, 2)
          .input('billTo', sql.NVarChar, billTo)
          .input('taxAppliedDocumentNo', sql.NVarChar, taxAppliedDocumentNo)
          .input('returnReasonCode', sql.NVarChar, line.returnReasonCode)
          .input('expectedLineCount', sql.Int, expectedLineCount);

        await request.query(`
          INSERT INTO ${tables.importedCreditNotesAL} (
            ${bracket('CustNO')},
            ${bracket('Date')},
            ${bracket('SPCode')},
            ${bracket('ShiptoCOde')},
            ${bracket('ExtDocNo')},
            ${bracket('ItemNo')},
            ${bracket('Qty')},
            ${bracket('Location')},
            ${bracket('SUOM')},
            ${bracket('UnitPrice')},
            ${bracket('ShiptoName')},
            ${bracket('TotalHeaderAmount')},
            ${bracket('LineAmount')},
            ${bracket('TotalHeaderQty')},
            ${bracket('LineNo')},
            ${bracket('Type')},
            ${bracket('Executed')},
            ${bracket('Posted')},
            ${bracket('BillTo')},
            ${bracket('Tax Applied Document No_')},
            ${bracket('Return Reason Code')},
            ${bracket('Expected Line Count')},
            ${bracket('Error')},
            ${bracket('Error Message')}
          )
          VALUES (
            @sellToCustomerNo,
            @shipmentDate,
            @salespersonCode,
            @shipToCode,
            @externalDocumentNo,
            @itemNo,
            @quantity,
            @location,
            @unitOfMeasure,
            @unitPrice,
            @shipToName,
            @totalHeaderAmount,
            @lineAmount,
            @totalHeaderQty,
            @lineNo,
            @type,
            0,
            0,
            @billTo,
            @taxAppliedDocumentNo,
            @returnReasonCode,
            @expectedLineCount,
            0,
            ''
          )
        `);
      } else if (documentType === 'invoice') {
        const request = new sql.Request(transaction)
          .input('sellToCustomerNo', sql.NVarChar, sellToCustomerNo)
          .input('shipmentDate', sql.Date, shipmentDate)
          .input('salespersonCode', sql.NVarChar, salespersonCode)
          .input('shipToCode', sql.NVarChar, shipToCode)
          .input('externalDocumentNo', sql.NVarChar, externalDocumentNo)
          .input('itemNo', sql.NVarChar, line.itemNo)
          .input('quantity', sql.Decimal(38, 20), line.quantity)
          .input('location', sql.NVarChar, line.location)
          .input('unitOfMeasure', sql.NVarChar, line.unitOfMeasure)
          .input('unitPrice', sql.Decimal(38, 20), line.unitPrice)
          .input('shipToName', sql.NVarChar, shipToName)
          .input('totalHeaderAmount', sql.Decimal(38, 20), totalHeaderAmount)
          .input('lineAmount', sql.Decimal(38, 20), line.lineAmount)
          .input('totalHeaderQty', sql.Decimal(38, 20), totalHeaderQty)
          .input('lineNo', sql.Int, line.lineNo)
          .input('type', sql.Int, 2)
          .input('billTo', sql.NVarChar, billTo)
          .input('cuInvoiceNo', sql.NVarChar, cuInvoiceNo)
          .input('cuNo', sql.NVarChar, cuNo)
          .input('signingTime', sql.NVarChar, signingTime)
          .input('expectedLineCount', sql.Int, expectedLineCount);

        await request.query(`
          INSERT INTO ${tables.importedSalesAL} (
            ${bracket('CustNO')},
            ${bracket('Date')},
            ${bracket('SPCode')},
            ${bracket('ShiptoCOde')},
            ${bracket('ExtDocNo')},
            ${bracket('ItemNo')},
            ${bracket('Qty')},
            ${bracket('Location')},
            ${bracket('SUOM')},
            ${bracket('UnitPrice')},
            ${bracket('ShiptoName')},
            ${bracket('TotalHeaderAmount')},
            ${bracket('LineAmount')},
            ${bracket('TotalHeaderQty')},
            ${bracket('LineNo')},
            ${bracket('Type')},
            ${bracket('Executed')},
            ${bracket('Posted')},
            ${bracket('BillTo')},
            ${bracket('CUInvoiceNo')},
            ${bracket('CUNo')},
            ${bracket('SigningTime')},
            ${bracket('Expected Line Count')},
            ${bracket('Error')},
            ${bracket('Error Message')}
          )
          VALUES (
            @sellToCustomerNo,
            @shipmentDate,
            @salespersonCode,
            @shipToCode,
            @externalDocumentNo,
            @itemNo,
            @quantity,
            @location,
            @unitOfMeasure,
            @unitPrice,
            @shipToName,
            @totalHeaderAmount,
            @lineAmount,
            @totalHeaderQty,
            @lineNo,
            @type,
            0,
            0,
            @billTo,
            @cuInvoiceNo,
            @cuNo,
            @signingTime,
            @expectedLineCount,
            0,
            ''
          )
        `);
      } else if (documentType === 'returnOrder') {
        if (!tables.importedReturnOrders) {
          const error = new Error('Imported Return Orders table is not available for this company. Publish/sync the BC extension or set SQL_TABLE_IMPORTED_RETURN_ORDERS.');
          error.statusCode = 503;
          throw error;
        }

        const request = new sql.Request(transaction)
          .input('sellToCustomerNo', sql.NVarChar, sellToCustomerNo)
          .input('shipmentDate', sql.Date, shipmentDate)
          .input('salespersonCode', sql.NVarChar, salespersonCode)
          .input('shipToCode', sql.NVarChar, shipToCode)
          .input('externalDocumentNo', sql.NVarChar, externalDocumentNo)
          .input('itemNo', sql.NVarChar, line.itemNo)
          .input('quantity', sql.Decimal(38, 20), line.quantity)
          .input('unitOfMeasure', sql.NVarChar, line.unitOfMeasure)
          .input('shipToName', sql.NVarChar, shipToName)
          .input('lineNo', sql.Int, line.lineNo)
          .input('status', sql.Int, 0)
          .input('customerSpecification', sql.NVarChar, customerSpecification)
          .input('company', sql.NVarChar, company.code)
          .input('returnReasonCode', sql.NVarChar, line.returnReasonCode)
          .input('originalOrderNo', sql.NVarChar, line.originalOrderNo);

        await request.query(`
          INSERT INTO ${tables.importedReturnOrders} (
            ${bracket('Sell-to Customer No_')},
            ${bracket('Shipment Date')},
            ${bracket('Salesperson Code')},
            ${bracket('Ship-to Code')},
            ${bracket('External Document No_')},
            ${bracket('Item No_')},
            ${bracket('Quantity')},
            ${bracket('Unit of Measure')},
            ${bracket('Ship-to Name')},
            ${bracket('Line No_')},
            ${bracket('Status')},
            ${bracket('Customer Specification')},
            ${bracket('Company')},
            ${bracket('Return Reason Code')},
            ${bracket('Original Order No_')},
            ${bracket('Error Text')}
          )
          VALUES (
            @sellToCustomerNo,
            @shipmentDate,
            @salespersonCode,
            @shipToCode,
            @externalDocumentNo,
            @itemNo,
            @quantity,
            @unitOfMeasure,
            @shipToName,
            @lineNo,
            @status,
            @customerSpecification,
            @company,
            @returnReasonCode,
            @originalOrderNo,
            ''
          )
        `);
      } else {
        const request = new sql.Request(transaction)
          .input('sellToCustomerNo', sql.NVarChar, sellToCustomerNo)
          .input('shipmentDate', sql.Date, shipmentDate)
          .input('salespersonCode', sql.NVarChar, salespersonCode)
          .input('shipToCode', sql.NVarChar, shipToCode)
          .input('externalDocumentNo', sql.NVarChar, externalDocumentNo)
          .input('itemNo', sql.NVarChar, line.itemNo)
          .input('quantity', sql.Decimal(38, 20), line.quantity)
          .input('unitOfMeasure', sql.NVarChar, line.unitOfMeasure)
          .input('shipToName', sql.NVarChar, shipToName)
          .input('lineNo', sql.Int, line.lineNo)
          .input('status', sql.Int, config.defaults.importedOrderStatus)
          .input('customerSpecification', sql.NVarChar, customerSpecification)
          .input('productSpecification', sql.NVarChar, line.productSpecification)
          .input('company', sql.NVarChar, company.code)
          .input('externalOrderUrl', sql.NVarChar, externalOrderUrl)
          .input('pdaOrder', sql.Bit, pdaOrder ? 1 : 0)
          .input('expectedLineCount', sql.Int, expectedLineCount);

        await request.query(`
          INSERT INTO ${tables.importedOrders} (
            ${bracket('Sell-to Customer No_')},
            ${bracket('Shipment Date')},
            ${bracket('Salesperson Code')},
            ${bracket('Ship-to Code')},
            ${bracket('External Document No_')},
            ${bracket('Item No_')},
            ${bracket('Quantity')},
            ${bracket('Unit of Measure')},
            ${bracket('Ship-to Name')},
            ${bracket('Line No_')},
            ${bracket('Status')},
            ${bracket('Customer Specification')},
            ${bracket('Company')},
            ${bracket('External Order URL')},
            ${bracket('Product Specification')},
            ${bracket('PDA Order')},
            ${bracket('Expected Line Count')},
            ${bracket('Error Message')}
          )
          VALUES (
            @sellToCustomerNo,
            @shipmentDate,
            @salespersonCode,
            @shipToCode,
            @externalDocumentNo,
            @itemNo,
            @quantity,
            @unitOfMeasure,
            @shipToName,
            @lineNo,
            @status,
            @customerSpecification,
            @company,
            @externalOrderUrl,
            @productSpecification,
            @pdaOrder,
            @expectedLineCount,
            ''
          )
        `);
      }
    }

    await transaction.commit();
    return res.status(201).json({
      company: company.code,
      documentType,
      externalDocumentNo,
      lineCount: lines.length,
      pdaOrder: documentType === 'order' ? pdaOrder : undefined,
      status: 'imported'
    });
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}));

module.exports = router;
