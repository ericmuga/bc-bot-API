const express = require('express');
const path = require('path');
const { sql, getPool, getTables, getAllCompanyTables, getCompanyConfig, bracket } = require('./db');
const config = require('./config');
const bcApi = require('./bcApi');

const router = express.Router();
const POSTMAN_COLLECTION_FILENAME = 'FCL BOT Integration API.postman_collection.json';
const postmanCollectionPath = path.join(__dirname, '..', POSTMAN_COLLECTION_FILENAME);

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

function paginationFromQuery(query) {
  const limit = limitFromQuery(query.limit);
  const parsedPage = Number.parseInt(query.page, 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const parsedOffset = Number.parseInt(query.offset, 10);
  const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : (page - 1) * limit;

  return { limit, page: Math.floor(offset / limit) + 1, offset };
}

function paginatedResponse(companyCode, data, pagination, totalCount) {
  const normalizedTotalCount = Number(totalCount) || 0;
  const totalPages = normalizedTotalCount > 0 ? Math.ceil(normalizedTotalCount / pagination.limit) : 0;

  return {
    company: getCompanyConfig(companyCode).code,
    count: data.length,
    totalCount: normalizedTotalCount,
    page: pagination.page,
    limit: pagination.limit,
    offset: pagination.offset,
    totalPages,
    hasNext: pagination.offset + data.length < normalizedTotalCount,
    hasPrevious: pagination.offset > 0,
    data
  };
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

function optionalStringList(...values) {
  const result = [];

  for (const value of values) {
    if (value === undefined || value === null || value === '') {
      continue;
    }

    const rawValues = Array.isArray(value) ? value : [value];
    for (const rawValue of rawValues) {
      const text = String(rawValue || '').trim();
      if (!text) {
        continue;
      }

      if (text.startsWith('[')) {
        try {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed)) {
            for (const parsedValue of parsed) {
              const parsedText = optionalString(parsedValue);
              if (parsedText) {
                result.push(parsedText);
              }
            }
            continue;
          }
        } catch (err) {
          // Treat malformed JSON as a plain string below.
        }
      }

      for (const part of text.split(',')) {
        const partText = optionalString(part);
        if (partText) {
          result.push(partText);
        }
      }
    }
  }

  return [...new Set(result)];
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

function maskedSqlInfo(sqlConfig) {
  return {
    server: maskedValue(sqlConfig.server),
    database: maskedValue(sqlConfig.database),
    schema: sqlConfig.schema
  };
}

function maskedDatabaseInfo(companyCode) {
  const company = getCompanyConfig(companyCode);
  return {
    ...maskedSqlInfo(config.sql),
    read: maskedSqlInfo(config.sql),
    write: maskedSqlInfo(config.sqlWrite),
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

function bcDecimalType() {
  return sql.NVarChar;
}

function bcDecimalValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return '0';
  }

  return parsed.toFixed(20).replace(/\.?0+$/, '') || '0';
}

function bcDecimalParameter(name) {
  return `CAST(@${name} AS decimal(38, 20))`;
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

async function getExistingColumnName(pool, qualifiedTableName, logicalColumnName) {
  const tableInfo = splitQualifiedTableName(qualifiedTableName);
  const result = await pool.request()
    .input('schema', sql.NVarChar, tableInfo.schema)
    .input('table', sql.NVarChar, tableInfo.table)
    .input('logicalColumnName', sql.NVarChar, logicalColumnName)
    .input('extensionColumnLike', sql.NVarChar, `${logicalColumnName}$%`)
    .query(`
      SELECT TOP 1 COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = @schema
        AND TABLE_NAME = @table
        AND (COLUMN_NAME = @logicalColumnName OR COLUMN_NAME LIKE @extensionColumnLike)
      ORDER BY
        CASE WHEN COLUMN_NAME = @logicalColumnName THEN 0 ELSE 1 END,
        COLUMN_NAME
    `);

  return result.recordset[0]?.COLUMN_NAME || '';
}

async function requireExistingColumnName(pool, qualifiedTableName, logicalColumnName) {
  const columnName = await getExistingColumnName(pool, qualifiedTableName, logicalColumnName);
  if (columnName) {
    return columnName;
  }

  const error = new Error(`Could not resolve SQL column '${logicalColumnName}' in ${qualifiedTableName}.`);
  error.statusCode = 503;
  throw error;
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

function groupImportedOrderDocuments(lines) {
  const documents = new Map();

  for (const line of lines) {
    const statusName = line.statusName || importedOrderStatusName(line.status);
    let document = documents.get(line.externalDocumentNo);

    if (!document) {
      document = {
        documentType: 'order',
        externalDocumentNo: line.externalDocumentNo,
        sellToCustomerNo: line.sellToCustomerNo,
        shipmentDate: line.shipmentDate,
        salespersonCode: line.salespersonCode,
        shipToCode: line.shipToCode,
        shipToName: line.shipToName,
        customerSpecification: line.customerSpecification,
        externalOrderUrl: line.externalOrderUrl,
        pdaOrder: Boolean(line.pdaOrder),
        expectedLineCount: line.expectedLineCount,
        lineCount: 0,
        statusCounts: {},
        lines: []
      };
      documents.set(line.externalDocumentNo, document);
    }

    document.lineCount += 1;
    document.statusCounts[statusName] = (document.statusCounts[statusName] || 0) + 1;
    document.lines.push({
      lineNo: line.lineNo,
      itemNo: line.itemNo,
      quantity: line.quantity,
      unitOfMeasure: line.unitOfMeasure,
      productSpecification: line.productSpecification,
      status: line.status,
      statusName,
      errorMessage: line.errorMessage
    });
  }

  return [...documents.values()].map((document) => {
    const summary = summarizeImportedOrderStatus(document.lines);
    const statusNames = Object.keys(summary.counts);
    const statusName = statusNames.length === 1 ? statusNames[0] : 'Mixed';

    return {
      ...document,
      orderStatus: summary.state,
      statusName,
      statusCounts: summary.counts
    };
  });
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
  const pdaOrderColumn = tables.salesHeaderExt
    ? await getExistingColumnName(pool, tables.salesHeaderExt, 'PDA Order')
    : '';
  const salesHeaderExtJoin = tables.salesHeaderExt && pdaOrderColumn
    ? `LEFT JOIN ${tables.salesHeaderExt} she ON she.${bracket('Document Type')} = sh.${bracket('Document Type')} AND she.${bracket('No_')} = sh.${bracket('No_')}`
    : '';
  const pdaOrderSelect = tables.salesHeaderExt && pdaOrderColumn
    ? `CAST(ISNULL(she.${bracket(pdaOrderColumn)}, 0) AS bit)`
    : `CAST(0 AS bit)`;

  const salesHeaderResult = await pool.request()
    .input('externalDocumentNo', sql.NVarChar, externalDocumentNo)
    .query(`
      SELECT
        sh.${bracket('No_')} AS documentNo,
        sh.${bracket('Document Type')} AS documentType,
        sh.${bracket('Status')} AS status,
        sh.${bracket('Sell-to Customer No_')} AS sellToCustomerNo,
        sh.${bracket('External Document No_')} AS externalDocumentNo,
        ${pdaOrderSelect} AS pdaOrder
      FROM ${tables.salesHeader} sh
      ${salesHeaderExtJoin}
      WHERE sh.${bracket('External Document No_')} = @externalDocumentNo
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
        ${bracket('Line No_')} AS ${bracket('lineNo')},
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
        ${bracket('LineNo')} AS ${bracket('lineNo')},
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
        ${bracket('Line No_')} AS ${bracket('lineNo')},
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
        ${bracket('LineNo')} AS ${bracket('lineNo')},
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

function buildImportedDocumentFromBody(body, company) {
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
    const error = new Error('lines must contain at least one order line.');
    error.statusCode = 400;
    throw error;
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

  return {
    company,
    documentType,
    externalDocumentNo,
    sellToCustomerNo,
    shipmentDate,
    salespersonCode,
    shipToCode,
    shipToName,
    customerSpecification,
    externalOrderUrl,
    pdaOrder,
    location,
    billTo,
    cuInvoiceNo,
    cuNo,
    signingTime,
    returnReasonCode,
    originalOrderNo,
    taxAppliedDocumentNo,
    lines,
    expectedLineCount: lines.length,
    totalHeaderQty: optionalNumber(body.totalHeaderQty, lines.reduce((total, line) => total + line.quantity, 0)),
    totalHeaderAmount: optionalNumber(body.totalHeaderAmount, lines.reduce((total, line) => total + line.lineAmount, 0))
  };
}

function toBcApiLinePayload(document, line) {
  if (document.documentType === 'creditNote') {
    return {
      custNo: document.sellToCustomerNo,
      documentDate: document.shipmentDate,
      spCode: document.salespersonCode,
      shipToCode: document.shipToCode,
      extDocNo: document.externalDocumentNo,
      itemNo: line.itemNo,
      qty: line.quantity,
      location: line.location,
      suom: line.unitOfMeasure,
      unitPrice: line.unitPrice,
      shipToName: document.shipToName,
      totalHeaderAmount: document.totalHeaderAmount,
      lineAmount: line.lineAmount,
      totalHeaderQty: document.totalHeaderQty,
      lineNo: line.lineNo,
      billTo: document.billTo,
      expectedLineCount: document.expectedLineCount,
      taxAppliedDocumentNo: document.taxAppliedDocumentNo,
      returnReasonCode: line.returnReasonCode
    };
  }

  if (document.documentType === 'invoice') {
    return {
      custNo: document.sellToCustomerNo,
      documentDate: document.shipmentDate,
      spCode: document.salespersonCode,
      shipToCode: document.shipToCode,
      extDocNo: document.externalDocumentNo,
      itemNo: line.itemNo,
      qty: line.quantity,
      location: line.location,
      suom: line.unitOfMeasure,
      unitPrice: line.unitPrice,
      shipToName: document.shipToName,
      totalHeaderAmount: document.totalHeaderAmount,
      lineAmount: line.lineAmount,
      totalHeaderQty: document.totalHeaderQty,
      lineNo: line.lineNo,
      billTo: document.billTo,
      cuInvoiceNo: document.cuInvoiceNo,
      cuNo: document.cuNo,
      signingTime: document.signingTime,
      expectedLineCount: document.expectedLineCount
    };
  }

  if (document.documentType === 'returnOrder') {
    return {
      sellToCustomerNo: document.sellToCustomerNo,
      shipmentDate: document.shipmentDate,
      salespersonCode: document.salespersonCode,
      shipToCode: document.shipToCode,
      externalDocumentNo: document.externalDocumentNo,
      itemNo: line.itemNo,
      quantity: line.quantity,
      unitOfMeasure: line.unitOfMeasure,
      shipToName: document.shipToName,
      lineNo: line.lineNo,
      customerSpecification: document.customerSpecification,
      company: document.company.code,
      returnReasonCode: line.returnReasonCode,
      originalOrderNo: line.originalOrderNo
    };
  }

  return {
    sellToCustomerNo: document.sellToCustomerNo,
    shipmentDate: document.shipmentDate,
    salespersonCode: document.salespersonCode,
    shipToCode: document.shipToCode,
    externalDocumentNo: document.externalDocumentNo,
    itemNo: line.itemNo,
    quantity: line.quantity,
    unitOfMeasure: line.unitOfMeasure,
    shipToName: document.shipToName,
    lineNo: line.lineNo,
    customerSpecification: document.customerSpecification,
    company: document.company.code,
    externalOrderUrl: document.externalOrderUrl,
    productSpecification: line.productSpecification,
    expectedLineCount: document.expectedLineCount,
    pdaOrder: document.pdaOrder
  };
}

function bcApiEntitySetForDocumentType(documentType) {
  if (documentType === 'invoice') {
    return 'importedSalesAL';
  }

  if (documentType === 'returnOrder') {
    return 'importedReturnOrders';
  }

  if (documentType === 'creditNote') {
    return 'importedCreditNotesAL';
  }

  return 'importedOrders';
}

async function getBcApiImportedDocumentLines(companyCode, externalDocumentNo) {
  const [importedOrders, importedSalesAL, importedReturnOrders, importedCreditNotesAL] = await Promise.all([
    bcApi.getLinesByExternalDocumentNo('importedOrders', companyCode, 'externalDocumentNo', externalDocumentNo),
    bcApi.getLinesByExternalDocumentNo('importedSalesAL', companyCode, 'extDocNo', externalDocumentNo),
    bcApi.getLinesByExternalDocumentNo('importedReturnOrders', companyCode, 'externalDocumentNo', externalDocumentNo),
    bcApi.getLinesByExternalDocumentNo('importedCreditNotesAL', companyCode, 'extDocNo', externalDocumentNo)
  ]);

  return {
    importedOrders,
    importedSalesAL,
    importedReturnOrders,
    importedCreditNotesAL
  };
}

async function assertBcApiExternalDocumentNotInStaging(companyCode, externalDocumentNo) {
  const matches = await getBcApiImportedDocumentLines(companyCode, externalDocumentNo);
  const totalMatches = Object.values(matches).reduce((total, lines) => total + lines.length, 0);
  if (!totalMatches) {
    return;
  }

  const error = new Error('External document number already exists in Business Central staging API pages.');
  error.statusCode = 409;
  error.details = {
    company: companyCode,
    externalDocumentNo,
    matches: Object.entries(matches)
      .filter(([, lines]) => lines.length)
      .map(([sourceTable, lines]) => ({
        sourceTable,
        count: lines.length
      }))
  };
  throw error;
}

function addImportedOrderFilter(filters, request, query, queryName, sqlType, columnName, parameterName = queryName) {
  const value = optionalString(query[queryName]);
  if (!value) {
    return;
  }

  request.input(parameterName, sqlType, value);
  filters.push(`${bracket(columnName)} = @${parameterName}`);
}

function addAliasedFilter(filters, request, query, queryName, sqlType, qualifiedColumn, parameterName = queryName) {
  const value = optionalString(query[queryName]);
  if (!value) {
    return;
  }

  request.input(parameterName, sqlType, value);
  filters.push(`${qualifiedColumn} = @${parameterName}`);
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

router.get('/postman-collection', (req, res, next) => {
  res.download(postmanCollectionPath, POSTMAN_COLLECTION_FILENAME, (err) => {
    if (err) {
      next(err);
    }
  });
});

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
    access: {
      mode: config.access.mode,
      sqlEnabled: config.access.sqlEnabled,
      apiPagesEnabled: config.access.apiPagesEnabled
    },
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
  const { customer, customerExt, shipToAddress, shipToAddressExt, districtGroupCode } = await getTables(companyCode);
  const pagination = paginationFromQuery(req.query);
  const search = optionalString(req.query.search);

  const customerExtWebPortalColumn = customerExt
    ? await getExistingColumnName(pool, customerExt, 'Web Portal')
    : '';
  const customerBaseWebPortalColumn = customerExtWebPortalColumn
    ? ''
    : await getExistingColumnName(pool, customer, 'Web Portal');
  const customerExtSectorColumn = customerExt
    ? await getExistingColumnName(pool, customerExt, 'Sector')
    : '';
  const customerBaseSectorColumn = customerExtSectorColumn
    ? ''
    : await getExistingColumnName(pool, customer, 'Sector');
  const customerExtJoin = customerExtWebPortalColumn || customerExtSectorColumn
    ? `LEFT JOIN ${customerExt} ce ON ce.${bracket('No_')} = c.${bracket('No_')}`
    : '';
  const sectorExpression = customerExtSectorColumn
    ? `ce.${bracket(customerExtSectorColumn)}`
    : customerBaseSectorColumn
      ? `c.${bracket(customerBaseSectorColumn)}`
      : `CAST('' AS nvarchar(20))`;
  const webPortalClause = customerExtWebPortalColumn
    ? `AND ce.${bracket(customerExtWebPortalColumn)} = 1`
    : customerBaseWebPortalColumn
      ? `AND c.${bracket(customerBaseWebPortalColumn)} = 1`
      : '';
  const shipToColumns = await getExistingColumns(pool, shipToAddress, ['Customer No_', 'Code', 'Name', 'Route Code']);
  const routeCodeExtColumn = shipToAddressExt
    ? await getExistingColumnName(pool, shipToAddressExt, 'Route Code')
    : '';
  const routeCodeBaseColumn = routeCodeExtColumn
    ? ''
    : shipToColumns.has('Route Code') ? 'Route Code' : '';
  const routeCodeAlias = routeCodeExtColumn ? 'ste' : 'sta';
  const routeCodeColumn = routeCodeExtColumn || routeCodeBaseColumn;
  const routeCodeExpression = routeCodeColumn
    ? `${routeCodeAlias}.${bracket(routeCodeColumn)}`
    : `CAST('' AS nvarchar(100))`;
  const shipToExtJoin = routeCodeExtColumn
    ? `LEFT JOIN ${shipToAddressExt} ste
      ON ste.${bracket('Customer No_')} = sta.${bracket('Customer No_')}
      AND ste.${bracket('Code')} = sta.${bracket('Code')}`
    : '';
  const routeColumns = districtGroupCode
    ? await getExistingColumns(pool, districtGroupCode, ['Code', 'Description', 'Pay Bill', 'Type'])
    : new Set();
  const canJoinRoute = districtGroupCode && routeCodeColumn && routeColumns.has('Code');
  const routeJoin = canJoinRoute
    ? `LEFT JOIN ${districtGroupCode} rt ON rt.${bracket('Code')} = ${routeCodeExpression}`
    : '';
  const routeNameSelect = canJoinRoute && routeColumns.has('Description')
    ? `rt.${bracket('Description')} AS routeName`
    : `CAST('' AS nvarchar(100)) AS routeName`;
  const routePayBillSelect = canJoinRoute && routeColumns.has('Pay Bill')
    ? `rt.${bracket('Pay Bill')} AS routePayBill`
    : `CAST('' AS nvarchar(100)) AS routePayBill`;
  const routeTypeSelect = canJoinRoute && routeColumns.has('Type')
    ? `rt.${bracket('Type')} AS routeType`
    : `CAST(NULL AS int) AS routeType`;
  const blockedColumn = await getExistingColumnName(pool, customer, 'Blocked');
  const blockedClause = blockedColumn ? `AND c.${bracket(blockedColumn)} = 0` : '';
  const request = pool.request()
    .input('limit', sql.Int, pagination.limit)
    .input('offset', sql.Int, pagination.offset)
    .input('search', sql.NVarChar, `%${search}%`);
  const filters = [];
  const customerNos = optionalStringList(req.query.customerNo, req.query.customerNos, req.query.customers, req.query.id);
  const name = optionalString(req.query.name || req.query.customerName);
  const shipToCode = optionalString(req.query.shipToCode || req.query.shipTo);
  const shipToName = optionalString(req.query.shipToName);

  if (customerNos.length) {
    const customerNoParams = customerNos.map((customerNo, index) => {
      const parameterName = `customerNo${index}`;
      request.input(parameterName, sql.NVarChar, customerNo);
      return `@${parameterName}`;
    });
    filters.push(`c.${bracket('No_')} IN (${customerNoParams.join(', ')})`);
  }

  if (name) {
    request.input('customerName', sql.NVarChar, `%${name}%`);
    filters.push(`c.${bracket('Name')} LIKE @customerName`);
  }

  if (shipToCode) {
    request.input('shipToCode', sql.NVarChar, shipToCode);
    filters.push(`EXISTS (SELECT 1 FROM ${shipToAddress} staFilter WHERE staFilter.${bracket('Customer No_')} = c.${bracket('No_')} AND staFilter.${bracket('Code')} = @shipToCode)`);
  }

  if (shipToName) {
    request.input('shipToName', sql.NVarChar, `%${shipToName}%`);
    filters.push(`EXISTS (SELECT 1 FROM ${shipToAddress} staNameFilter WHERE staNameFilter.${bracket('Customer No_')} = c.${bracket('No_')} AND staNameFilter.${bracket('Name')} LIKE @shipToName)`);
  }

  const searchClause = search
    ? `AND (c.${bracket('No_')} LIKE @search OR c.${bracket('Name')} LIKE @search)`
    : '';
  const filterClause = filters.length ? `AND ${filters.join(' AND ')}` : '';

  const result = await request.query(`
    WITH MatchingCustomers AS (
      SELECT
        c.${bracket('No_')} AS customerNo,
        c.${bracket('Name')} AS name,
        ${sectorExpression} AS sector
      FROM ${customer} c
      ${customerExtJoin}
      WHERE 1 = 1
        ${webPortalClause}
        ${blockedClause}
        ${searchClause}
        ${filterClause}
    ),
    FilteredCustomers AS (
      SELECT
        customerNo,
        name,
        sector,
        COUNT(*) OVER() AS totalCount
      FROM MatchingCustomers
      ORDER BY customerNo
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    )
    SELECT
      fc.customerNo AS id,
      fc.customerNo,
      fc.name,
      fc.sector,
      fc.totalCount,
      sta.${bracket('Code')} AS shipToCode,
      sta.${bracket('Name')} AS shipToName,
      ${routeCodeExpression} AS routeCode,
      ${routeNameSelect},
      ${routePayBillSelect},
      ${routeTypeSelect}
    FROM FilteredCustomers fc
    LEFT JOIN ${shipToAddress} sta
      ON sta.${bracket('Customer No_')} = fc.customerNo
    ${shipToExtJoin}
    ${routeJoin}
    ORDER BY fc.customerNo, sta.${bracket('Code')}
  `);

  const customers = [];
  const byCustomerNo = new Map();
  let totalCount = 0;
  for (const row of result.recordset) {
    totalCount = Math.max(totalCount, Number(row.totalCount) || 0);
    let customerRow = byCustomerNo.get(row.customerNo);
    if (!customerRow) {
      customerRow = {
        id: row.customerNo,
        customerNo: row.customerNo,
        name: row.name,
        sector: row.sector || '',
        shipTo: []
      };
      byCustomerNo.set(row.customerNo, customerRow);
      customers.push(customerRow);
    }

    if (row.shipToCode) {
      const paymentType = routePaymentTypeName(row.routeType);
      const mpesaTill = paymentType === 'Till' ? row.routePayBill || '' : '';
      const mpesaPaybill = paymentType === 'Paybill' ? row.routePayBill || '' : '';
      customerRow.shipTo.push({
        code: row.shipToCode,
        name: row.shipToName || '',
        route: {
          code: row.routeCode || '',
          districtGroupCode: row.routeCode || '',
          name: row.routeName || '',
          paymentType,
          payBill: row.routePayBill || '',
          mpesaTill,
          mpesaPaybill
        }
      });
    }
  }

  res.json(paginatedResponse(companyCode, customers, pagination, totalCount));
}));

router.get('/items', asyncHandler(async (req, res) => {
  const pool = await getPool();
  const companyCode = companyFromRequest(req);
  const { item, itemExt } = await getTables(companyCode);
  const pagination = paginationFromQuery(req.query);
  const search = optionalString(req.query.search);

  const itemExtPdaItemColumn = itemExt
    ? await getExistingColumnName(pool, itemExt, 'PDA Item')
    : '';
  const itemBasePdaItemColumn = itemExtPdaItemColumn
    ? ''
    : await getExistingColumnName(pool, item, 'PDA Item');
  const itemExtJoin = itemExtPdaItemColumn
    ? `INNER JOIN ${itemExt} ie ON ie.${bracket('No_')} = i.${bracket('No_')}`
    : '';
  const pdaItemClause = itemExtPdaItemColumn
    ? `AND ie.${bracket(itemExtPdaItemColumn)} = 1`
    : itemBasePdaItemColumn
      ? `AND i.${bracket(itemBasePdaItemColumn)} = 1`
      : '';
  const barcodeNoExtColumn = itemExt ? await getExistingColumnName(pool, itemExt, 'Bar Code No_') : '';
  const barcodeNoBaseColumn = barcodeNoExtColumn ? '' : await getExistingColumnName(pool, item, 'Bar Code No_');
  const barcodeNoColumn = barcodeNoExtColumn || barcodeNoBaseColumn;
  const barcodeNoAlias = barcodeNoExtColumn ? 'ie' : 'i';
  const blockedColumn = await getExistingColumnName(pool, item, 'Blocked');
  const blockedClause = blockedColumn ? `AND i.${bracket(blockedColumn)} = 0` : '';
  const barcodeNoSelect = barcodeNoColumn ? `${barcodeNoAlias}.${bracket(barcodeNoColumn)}` : `CAST('' AS nvarchar(100))`;
  const request = pool.request()
    .input('limit', sql.Int, pagination.limit)
    .input('offset', sql.Int, pagination.offset)
    .input('search', sql.NVarChar, `%${search}%`);
  const filters = [];
  const itemNos = optionalStringList(req.query.itemNo, req.query.itemNos, req.query.items, req.query.id);
  const description = optionalString(req.query.description);
  const uom = optionalString(req.query.uom || req.query.unitOfMeasure);
  const baseUnitOfMeasure = optionalString(req.query.baseUnitOfMeasure);
  const salesUnitOfMeasure = optionalString(req.query.salesUnitOfMeasure);
  const barcode = optionalString(req.query.barcode);
  const barcodeNo = optionalString(req.query.barcodeNo);

  if (itemNos.length) {
    const itemNoParams = itemNos.map((itemNo, index) => {
      const parameterName = `itemNo${index}`;
      request.input(parameterName, sql.NVarChar, itemNo);
      return `@${parameterName}`;
    });
    filters.push(`i.${bracket('No_')} IN (${itemNoParams.join(', ')})`);
  }

  if (description) {
    request.input('description', sql.NVarChar, `%${description}%`);
    filters.push(`i.${bracket('Description')} LIKE @description`);
  }

  if (uom) {
    request.input('uom', sql.NVarChar, uom);
    filters.push(`(i.${bracket('Base Unit of Measure')} = @uom OR i.${bracket('Sales Unit of Measure')} = @uom)`);
  }

  if (baseUnitOfMeasure) {
    request.input('baseUnitOfMeasure', sql.NVarChar, baseUnitOfMeasure);
    filters.push(`i.${bracket('Base Unit of Measure')} = @baseUnitOfMeasure`);
  }

  if (salesUnitOfMeasure) {
    request.input('salesUnitOfMeasure', sql.NVarChar, salesUnitOfMeasure);
    filters.push(`i.${bracket('Sales Unit of Measure')} = @salesUnitOfMeasure`);
  }

  if (barcode) {
    if (!barcodeNoColumn) {
      const error = new Error('Barcode filtering is not available because Bar Code No. could not be resolved on the Item extension table.');
      error.statusCode = 503;
      throw error;
    }

    request.input('barcode', sql.NVarChar, `%${barcode}%`);
    filters.push(`${barcodeNoAlias}.${bracket(barcodeNoColumn)} LIKE @barcode`);
  }

  if (barcodeNo) {
    if (!barcodeNoColumn) {
      const error = new Error('barcodeNo filtering is not available because Bar Code No. could not be resolved on the Item extension table.');
      error.statusCode = 503;
      throw error;
    }

    request.input('barcodeNo', sql.NVarChar, `%${barcodeNo}%`);
    filters.push(`${barcodeNoAlias}.${bracket(barcodeNoColumn)} LIKE @barcodeNo`);
  }

  const searchClause = search
    ? `AND (i.${bracket('No_')} LIKE @search OR i.${bracket('Description')} LIKE @search)`
    : '';
  const filterClause = filters.length ? `AND ${filters.join(' AND ')}` : '';

  const result = await request.query(`
    WITH MatchingItems AS (
      SELECT
        i.${bracket('No_')} AS id,
        i.${bracket('No_')} AS itemNo,
        i.${bracket('Description')} AS description,
        i.${bracket('Base Unit of Measure')} AS baseUnitOfMeasure,
        i.${bracket('Sales Unit of Measure')} AS salesUnitOfMeasure,
        ${barcodeNoSelect} AS barcodeNo
      FROM ${item} i
      ${itemExtJoin}
      WHERE 1 = 1
        ${pdaItemClause}
        ${blockedClause}
        ${searchClause}
        ${filterClause}
    )
    SELECT
      *,
      COUNT(*) OVER() AS totalCount
    FROM MatchingItems
    ORDER BY itemNo
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `);

  const data = result.recordset.map(({ totalCount, ...line }) => line);
  const totalCount = result.recordset[0]?.totalCount || 0;
  res.json(paginatedResponse(companyCode, data, pagination, totalCount));
}));

function routePaymentTypeName(routeType) {
  if (routeType === null || routeType === undefined || routeType === '') {
    return '';
  }

  const numericRouteType = Number(routeType);
  if (numericRouteType === 0) {
    return 'Till';
  }
  if (numericRouteType === 1) {
    return 'Paybill';
  }

  return String(routeType);
}

async function getSalespersonShipToRows(pool, { salespersonCodes, shipToAddress, shipToAddressExt, districtGroupCode }) {
  if (!salespersonCodes.length) {
    return [];
  }

  const shipToColumns = await getExistingColumns(pool, shipToAddress, [
    'Customer No_',
    'Code',
    'Name',
    'Salesperson Code',
    'Route Code'
  ]);
  if (!shipToColumns.has('Salesperson Code')) {
    return [];
  }

  const routeCodeExtColumn = shipToAddressExt
    ? await getExistingColumnName(pool, shipToAddressExt, 'Route Code')
    : '';
  const routeCodeBaseColumn = routeCodeExtColumn
    ? ''
    : shipToColumns.has('Route Code') ? 'Route Code' : '';
  const routeCodeAlias = routeCodeExtColumn ? 'ste' : 'sta';
  const routeCodeColumn = routeCodeExtColumn || routeCodeBaseColumn;
  const routeCodeExpression = routeCodeColumn
    ? `${routeCodeAlias}.${bracket(routeCodeColumn)}`
    : `CAST('' AS nvarchar(100))`;
  const shipToExtJoin = routeCodeExtColumn
    ? `LEFT JOIN ${shipToAddressExt} ste
      ON ste.${bracket('Customer No_')} = sta.${bracket('Customer No_')}
      AND ste.${bracket('Code')} = sta.${bracket('Code')}`
    : '';
  const routeColumns = districtGroupCode
    ? await getExistingColumns(pool, districtGroupCode, ['Code', 'Description', 'Pay Bill', 'Type'])
    : new Set();
  const canJoinRoute = districtGroupCode && routeCodeColumn && routeColumns.has('Code');
  const routeJoin = canJoinRoute
    ? `LEFT JOIN ${districtGroupCode} rt ON rt.${bracket('Code')} = ${routeCodeExpression}`
    : '';
  const routeNameSelect = canJoinRoute && routeColumns.has('Description')
    ? `rt.${bracket('Description')} AS routeName`
    : `CAST('' AS nvarchar(100)) AS routeName`;
  const routePayBillSelect = canJoinRoute && routeColumns.has('Pay Bill')
    ? `rt.${bracket('Pay Bill')} AS routePayBill`
    : `CAST('' AS nvarchar(100)) AS routePayBill`;
  const routeTypeSelect = canJoinRoute && routeColumns.has('Type')
    ? `rt.${bracket('Type')} AS routeType`
    : `CAST(NULL AS int) AS routeType`;
  const request = pool.request();
  const placeholders = salespersonCodes.map((salespersonCode, index) => {
    const param = `shipToSalespersonCode${index}`;
    request.input(param, sql.NVarChar, salespersonCode);
    return `@${param}`;
  });

  const result = await request.query(`
    SELECT
      sta.${bracket('Salesperson Code')} AS salespersonCode,
      sta.${bracket('Customer No_')} AS customerNo,
      sta.${bracket('Code')} AS shipToCode,
      sta.${bracket('Name')} AS shipToName,
      ${routeCodeExpression} AS routeCode,
      ${routeNameSelect},
      ${routePayBillSelect},
      ${routeTypeSelect}
    FROM ${shipToAddress} sta
    ${shipToExtJoin}
    ${routeJoin}
    WHERE sta.${bracket('Salesperson Code')} IN (${placeholders.join(', ')})
    ORDER BY sta.${bracket('Salesperson Code')}, sta.${bracket('Customer No_')}, sta.${bracket('Code')}
  `);

  return result.recordset;
}

router.get('/salespeople', asyncHandler(async (req, res) => {
  const pool = await getPool();
  const companyCode = companyFromRequest(req);
  const {
    salespersonPurchaser,
    salespersonPurchaserExt,
    contact,
    shipToAddress,
    shipToAddressExt,
    districtGroupCode
  } = await getTables(companyCode);
  const pagination = paginationFromQuery(req.query);
  const search = optionalString(req.query.search);
  const salespersonCodes = optionalStringList(
    req.query.salespersonCode,
    req.query.salespersonCodes,
    req.query.salespeople,
    req.query.id
  );
  const salespersonName = optionalString(req.query.salespersonName || req.query.name);
  const contactCode = optionalString(req.query.contactCode || req.query.contact);
  const contactName = optionalString(req.query.contactName);
  const contactPhone = optionalString(req.query.contactPhone || req.query.phone);

  const request = pool.request()
    .input('limit', sql.Int, pagination.limit)
    .input('offset', sql.Int, pagination.offset)
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
  const currentRouteExtColumn = salespersonPurchaserExt
    ? await getExistingColumnName(pool, salespersonPurchaserExt, 'Current Route')
    : '';
  const currentRouteBaseColumn = currentRouteExtColumn
    ? ''
    : await getExistingColumnName(pool, salespersonPurchaser, 'Current Route');
  const currentRouteAlias = currentRouteExtColumn ? 'spe' : 'spBase';
  const currentRouteColumn = currentRouteExtColumn || currentRouteBaseColumn;
  const currentRouteExpression = currentRouteColumn
    ? `${currentRouteAlias}.${bracket(currentRouteColumn)}`
    : `CAST('' AS nvarchar(100))`;
  const salespersonExtJoin = currentRouteExtColumn
    ? `LEFT JOIN ${salespersonPurchaserExt} spe ON spe.${bracket('Code')} = spBase.${bracket('Code')}`
    : '';
  const routeColumns = districtGroupCode
    ? await getExistingColumns(pool, districtGroupCode, ['Code', 'Description', 'Pay Bill', 'Type'])
    : new Set();
  const canJoinRoute = districtGroupCode && currentRouteColumn && routeColumns.has('Code');
  const routeJoin = canJoinRoute
    ? `LEFT JOIN ${districtGroupCode} rt ON rt.${bracket('Code')} = ${currentRouteExpression}`
    : '';
  const routeNameSelect = canJoinRoute && routeColumns.has('Description')
    ? `rt.${bracket('Description')} AS routeName`
    : `CAST('' AS nvarchar(100)) AS routeName`;
  const routePayBillSelect = canJoinRoute && routeColumns.has('Pay Bill')
    ? `rt.${bracket('Pay Bill')} AS routePayBill`
    : `CAST('' AS nvarchar(100)) AS routePayBill`;
  const routeTypeSelect = canJoinRoute && routeColumns.has('Type')
    ? `rt.${bracket('Type')} AS routeType`
    : `CAST(NULL AS int) AS routeType`;

  const filters = [];
  if (search) {
    filters.push(`(spBase.${bracket('Code')} LIKE @search OR spBase.${bracket('Name')} LIKE @search)`);
  }

  if (salespersonCodes.length > 0) {
    const placeholders = salespersonCodes.map((value, index) => {
      const param = `salespersonCode${index}`;
      request.input(param, sql.NVarChar, value);
      return `@${param}`;
    });
    filters.push(`spBase.${bracket('Code')} IN (${placeholders.join(', ')})`);
  }

  if (salespersonName) {
    request.input('salespersonName', sql.NVarChar, `%${salespersonName}%`);
    filters.push(`spBase.${bracket('Name')} LIKE @salespersonName`);
  }

  const contactFilterRequested = contactCode || contactName || contactPhone;
  if (contactFilterRequested && !canJoinContacts) {
    const err = new Error('Salesperson contact filters are not available because Contact table columns could not be resolved.');
    err.statusCode = 503;
    throw err;
  }

  if (contactCode) {
    if (!contactColumns.has('No_')) {
      const err = new Error('contactCode filter is not available because Contact No_ column could not be resolved.');
      err.statusCode = 503;
      throw err;
    }
    request.input('contactCode', sql.NVarChar, contactCode);
    filters.push(`EXISTS (
      SELECT 1
      FROM ${contact} ctFilter
      WHERE ctFilter.${bracket('Salesperson Code')} = spBase.${bracket('Code')}
        AND ctFilter.${bracket('No_')} = @contactCode
    )`);
  }

  if (contactName) {
    request.input('contactName', sql.NVarChar, `%${contactName}%`);
    filters.push(`EXISTS (
      SELECT 1
      FROM ${contact} ctFilter
      WHERE ctFilter.${bracket('Salesperson Code')} = spBase.${bracket('Code')}
        AND ctFilter.${bracket('Name')} LIKE @contactName
    )`);
  }

  if (contactPhone) {
    if (!contactColumns.has('Phone No_')) {
      const err = new Error('contactPhone filter is not available because Contact Phone No_ column could not be resolved.');
      err.statusCode = 503;
      throw err;
    }
    request.input('contactPhone', sql.NVarChar, `%${contactPhone}%`);
    filters.push(`EXISTS (
      SELECT 1
      FROM ${contact} ctFilter
      WHERE ctFilter.${bracket('Salesperson Code')} = spBase.${bracket('Code')}
        AND ctFilter.${bracket('Phone No_')} LIKE @contactPhone
    )`);
  }

  const filterClause = filters.length > 0
    ? `WHERE ${filters.join('\n        AND ')}`
    : '';

  const result = await request.query(`
    WITH MatchingSalespeople AS (
      SELECT
        spBase.${bracket('Code')} AS salespersonCode,
        spBase.${bracket('Name')} AS name,
        ${currentRouteExpression} AS currentRoute,
        ${routeNameSelect},
        ${routePayBillSelect},
        ${routeTypeSelect}
      FROM ${salespersonPurchaser} spBase
      ${salespersonExtJoin}
      ${routeJoin}
      ${filterClause}
    ),
    FilteredSalespeople AS (
      SELECT
        salespersonCode,
        name,
        currentRoute,
        routeName,
        routePayBill,
        routeType,
        COUNT(*) OVER() AS totalCount
      FROM MatchingSalespeople
      ORDER BY salespersonCode
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    )
    SELECT
      sp.salespersonCode,
      sp.name,
      sp.currentRoute,
      sp.routeName,
      sp.routePayBill,
      sp.routeType,
      sp.totalCount,
      ${contactSelect}
    FROM FilteredSalespeople sp
    ${contactJoin}
    ORDER BY sp.salespersonCode, contactName
  `);

  const salespeople = [];
  const bySalespersonCode = new Map();
  let totalCount = 0;
  for (const row of result.recordset) {
    totalCount = Math.max(totalCount, Number(row.totalCount) || 0);
    let salesperson = bySalespersonCode.get(row.salespersonCode);
    if (!salesperson) {
      const paymentType = routePaymentTypeName(row.routeType);
      const mpesaTill = paymentType === 'Till' ? row.routePayBill || '' : '';
      const mpesaPaybill = paymentType === 'Paybill' ? row.routePayBill || '' : '';
      salesperson = {
        salespersonCode: row.salespersonCode,
        name: row.name,
        currentRoute: row.currentRoute || '',
        route: {
          code: row.currentRoute || '',
          districtGroupCode: row.currentRoute || '',
          name: row.routeName || '',
          paymentType,
          payBill: row.routePayBill || '',
          mpesaTill,
          mpesaPaybill
        },
        mpesaTill,
        mpesaPaybill,
        contacts: [],
        shipTo: []
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

  if (salespeople.length > 0) {
    const shipToRows = await getSalespersonShipToRows(pool, {
      salespersonCodes: salespeople.map((salesperson) => salesperson.salespersonCode),
      shipToAddress,
      shipToAddressExt,
      districtGroupCode
    });

    for (const row of shipToRows) {
      const salesperson = bySalespersonCode.get(row.salespersonCode);
      if (!salesperson) {
        continue;
      }

      const paymentType = routePaymentTypeName(row.routeType);
      const mpesaTill = paymentType === 'Till' ? row.routePayBill || '' : '';
      const mpesaPaybill = paymentType === 'Paybill' ? row.routePayBill || '' : '';
      salesperson.shipTo.push({
        customerNo: row.customerNo || '',
        code: row.shipToCode || '',
        name: row.shipToName || '',
        route: {
          code: row.routeCode || '',
          districtGroupCode: row.routeCode || '',
          name: row.routeName || '',
          paymentType,
          payBill: row.routePayBill || '',
          mpesaTill,
          mpesaPaybill
        },
        mpesaTill,
        mpesaPaybill
      });
    }
  }

  res.json(paginatedResponse(companyCode, salespeople, pagination, totalCount));
}));

async function listHistoricalSalesInvoiceLines(req, res) {
  const pool = await getPool();
  const companyCode = companyFromRequest(req);
  const tables = await getTables(companyCode);
  const pagination = paginationFromQuery(req.query);
  const request = pool.request()
    .input('limit', sql.Int, pagination.limit)
    .input('offset', sql.Int, pagination.offset);
  const filters = [];

  addAliasedFilter(filters, request, req.query, 'externalDocumentNo', sql.NVarChar, `h.${bracket('External Document No_')}`);
  addAliasedFilter(filters, request, req.query, 'invoiceNo', sql.NVarChar, `h.${bracket('No_')}`);
  addAliasedFilter(filters, request, req.query, 'documentNo', sql.NVarChar, `h.${bracket('No_')}`, 'documentNo');
  addAliasedFilter(filters, request, req.query, 'sellToCustomerNo', sql.NVarChar, `h.${bracket('Sell-to Customer No_')}`);
  addAliasedFilter(filters, request, req.query, 'customerNo', sql.NVarChar, `h.${bracket('Sell-to Customer No_')}`, 'customerNo');
  addAliasedFilter(filters, request, req.query, 'salespersonCode', sql.NVarChar, `h.${bracket('Salesperson Code')}`);
  addAliasedFilter(filters, request, req.query, 'shipToCode', sql.NVarChar, `h.${bracket('Ship-to Code')}`);
  addAliasedFilter(filters, request, req.query, 'itemNo', sql.NVarChar, `l.${bracket('No_')}`);

  if (optionalString(req.query.postingDate) && (optionalString(req.query.postingDateFrom) || optionalString(req.query.postingDateTo))) {
    const error = new Error('Use either postingDate or postingDateFrom/postingDateTo, not both.');
    error.statusCode = 400;
    throw error;
  }

  if (optionalString(req.query.postingDate)) {
    request.input('postingDate', sql.Date, toBcDate(req.query.postingDate, 'postingDate'));
    filters.push(`h.${bracket('Posting Date')} = @postingDate`);
  }

  if (optionalString(req.query.postingDateFrom)) {
    request.input('postingDateFrom', sql.Date, toBcDate(req.query.postingDateFrom, 'postingDateFrom'));
    filters.push(`h.${bracket('Posting Date')} >= @postingDateFrom`);
  }

  if (optionalString(req.query.postingDateTo)) {
    request.input('postingDateTo', sql.Date, toBcDate(req.query.postingDateTo, 'postingDateTo'));
    filters.push(`h.${bracket('Posting Date')} <= @postingDateTo`);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const result = await request.query(`
    WITH MatchingPostedInvoiceLines AS (
      SELECT
        h.${bracket('No_')} AS invoiceNo,
        h.${bracket('Posting Date')} AS postingDate,
        h.${bracket('External Document No_')} AS externalDocumentNo,
        h.${bracket('Sell-to Customer No_')} AS sellToCustomerNo,
        h.${bracket('Bill-to Customer No_')} AS billToCustomerNo,
        h.${bracket('Salesperson Code')} AS salespersonCode,
        h.${bracket('Ship-to Code')} AS shipToCode,
        h.${bracket('Ship-to Name')} AS shipToName,
        l.${bracket('Line No_')} AS ${bracket('lineNo')},
        l.${bracket('Type')} AS lineType,
        l.${bracket('No_')} AS itemNo,
        l.${bracket('Description')} AS description,
        l.${bracket('Quantity')} AS quantity,
        l.${bracket('Unit of Measure Code')} AS unitOfMeasure,
        l.${bracket('Unit Price')} AS unitPrice,
        l.${bracket('Line Amount')} AS lineAmount,
        l.${bracket('Amount Including VAT')} AS amountIncludingVat,
        l.${bracket('VAT _')} AS vatPercent
      FROM ${tables.salesInvoiceLine} l
      INNER JOIN ${tables.salesInvoiceHeader} h
        ON h.${bracket('No_')} = l.${bracket('Document No_')}
      ${whereClause}
    ),
    NumberedPostedInvoiceLines AS (
      SELECT
        *,
        COUNT(*) OVER() AS totalCount,
        ROW_NUMBER() OVER (ORDER BY ${bracket('postingDate')} DESC, ${bracket('invoiceNo')} DESC, ${bracket('lineNo')}) AS ${bracket('rowNumber')}
      FROM MatchingPostedInvoiceLines
    )
    SELECT *
    FROM NumberedPostedInvoiceLines
    WHERE ${bracket('rowNumber')} > @offset AND ${bracket('rowNumber')} <= (@offset + @limit)
    ORDER BY ${bracket('rowNumber')}
  `);

  const totalCount = result.recordset[0]?.totalCount || 0;
  const data = result.recordset.map(({ totalCount: _totalCount, rowNumber: _rowNumber, ...line }) => line);

  return res.json(paginatedResponse(companyCode, data, pagination, totalCount));
}

router.get('/historical-sales-invoice-lines', asyncHandler(listHistoricalSalesInvoiceLines));
router.get('/imported-orders', asyncHandler(async (req, res) => {
  const pool = await getPool();
  const companyCode = companyFromRequest(req);
  const { importedOrders } = await getTables(companyCode);
  const pagination = paginationFromQuery(req.query);
  const request = pool.request()
    .input('limit', sql.Int, pagination.limit)
    .input('offset', sql.Int, pagination.offset);
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
    WITH MatchingImportedOrders AS (
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
        ${bracket('Line No_')} AS ${bracket('lineNo')},
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
    ),
    NumberedImportedOrders AS (
      SELECT
        *,
        COUNT(*) OVER() AS totalCount,
        ROW_NUMBER() OVER (ORDER BY ${bracket('externalDocumentNo')}, ${bracket('lineNo')}) AS ${bracket('rowNumber')}
      FROM MatchingImportedOrders
    )
    SELECT *
    FROM NumberedImportedOrders
    WHERE ${bracket('rowNumber')} > @offset
      AND ${bracket('rowNumber')} <= @offset + @limit
    ORDER BY ${bracket('rowNumber')}
  `);

  const lines = result.recordset.map(({ totalCount, rowNumber, ...line }) => ({
    ...line,
    statusName: importedOrderStatusName(line.status)
  }));
  const orders = groupImportedOrderDocuments(lines);
  const totalLineCount = result.recordset[0]?.totalCount || 0;
  const totalPages = totalLineCount > 0 ? Math.ceil(totalLineCount / pagination.limit) : 0;

  res.json({
    metadata: {
      company: getCompanyConfig(companyCode).code,
      count: orders.length,
      documentCount: orders.length,
      totalLineCount,
      page: pagination.page,
      limit: pagination.limit,
      offset: pagination.offset,
      totalPages,
      hasNext: pagination.offset + lines.length < totalLineCount,
      hasPrevious: pagination.offset > 0,
      paginationMode: 'lines'
    },
    orders
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
        ${bracket('Line No_')} AS ${bracket('lineNo')},
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

  const lines = result.recordset.map((line) => ({
    ...line,
    statusName: importedOrderStatusName(line.status)
  }));
  const [document] = groupImportedOrderDocuments(lines);

  return res.json({
    company: getCompanyConfig(companyCode).code,
    ...document
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

router.get('/bc-api/imported-orders/:externalDocumentNo', asyncHandler(async (req, res) => {
  const companyCode = companyFromRequest(req);
  const company = getCompanyConfig(companyCode);
  const externalDocumentNo = requireString(req.params.externalDocumentNo, 'externalDocumentNo');
  const lines = await getBcApiImportedDocumentLines(company.code, externalDocumentNo);
  const lineCount = Object.values(lines).reduce((total, stagedLines) => total + stagedLines.length, 0);

  if (!lineCount) {
    return res.status(404).json({ error: 'Imported document not found through Business Central API pages.' });
  }

  return res.json({
    provider: 'bcApi',
    company: company.code,
    externalDocumentNo,
    lineCount,
    lines
  });
}));

router.post('/bc-api/imported-orders', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const company = getCompanyConfig(companyFromRequest(req));
  const document = buildImportedDocumentFromBody(body, company);

  if (config.access.sqlEnabled) {
    const pool = await getPool('write');
    const tables = await getTables(company.code, 'write');
    await assertExternalDocumentCanBeImported(pool, tables, company.code, document.externalDocumentNo);
  } else {
    await assertBcApiExternalDocumentNotInStaging(company.code, document.externalDocumentNo);
    const delayMs = config.defaults.importDuplicateRecheckDelayMs;
    if (delayMs > 0) {
      await delay(delayMs);
    }
    await assertBcApiExternalDocumentNotInStaging(company.code, document.externalDocumentNo);
  }

  const entitySetName = bcApiEntitySetForDocumentType(document.documentType);
  const stagedLines = [];
  for (const line of document.lines) {
    stagedLines.push(await bcApi.postLine(entitySetName, company.code, toBcApiLinePayload(document, line)));
  }

  return res.status(201).json({
    provider: 'bcApi',
    company: company.code,
    documentType: document.documentType,
    externalDocumentNo: document.externalDocumentNo,
    lineCount: stagedLines.length,
    pdaOrder: document.documentType === 'order' ? document.pdaOrder : undefined,
    entitySetName,
    status: 'imported'
  });
}));

async function stageImportedOrderSql(body) {
  const companyCode = companyFromRequest({ params: {}, query: {}, body });
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
    const error = new Error('lines must contain at least one order line.');
    error.statusCode = 400;
    throw error;
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

  const pool = await getPool('write');
  const tables = await getTables(company.code, 'write');
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
          .input('quantity', bcDecimalType(), bcDecimalValue(line.quantity))
          .input('location', sql.NVarChar, line.location)
          .input('unitOfMeasure', sql.NVarChar, line.unitOfMeasure)
          .input('unitPrice', bcDecimalType(), bcDecimalValue(line.unitPrice))
          .input('shipToName', sql.NVarChar, shipToName)
          .input('totalHeaderAmount', bcDecimalType(), bcDecimalValue(totalHeaderAmount))
          .input('lineAmount', bcDecimalType(), bcDecimalValue(line.lineAmount))
          .input('totalHeaderQty', bcDecimalType(), bcDecimalValue(totalHeaderQty))
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
            ${bracket('ItemBlockedStatus')},
            ${bracket('RevertFlag')},
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
            ${bcDecimalParameter('quantity')},
            @location,
            @unitOfMeasure,
            ${bcDecimalParameter('unitPrice')},
            @shipToName,
            ${bcDecimalParameter('totalHeaderAmount')},
            ${bcDecimalParameter('lineAmount')},
            ${bcDecimalParameter('totalHeaderQty')},
            @lineNo,
            @type,
            0,
            0,
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
          .input('quantity', bcDecimalType(), bcDecimalValue(line.quantity))
          .input('location', sql.NVarChar, line.location)
          .input('unitOfMeasure', sql.NVarChar, line.unitOfMeasure)
          .input('unitPrice', bcDecimalType(), bcDecimalValue(line.unitPrice))
          .input('shipToName', sql.NVarChar, shipToName)
          .input('totalHeaderAmount', bcDecimalType(), bcDecimalValue(totalHeaderAmount))
          .input('lineAmount', bcDecimalType(), bcDecimalValue(line.lineAmount))
          .input('totalHeaderQty', bcDecimalType(), bcDecimalValue(totalHeaderQty))
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
            ${bracket('ItemBlockedStatus')},
            ${bracket('RevertFlag')},
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
            ${bcDecimalParameter('quantity')},
            @location,
            @unitOfMeasure,
            ${bcDecimalParameter('unitPrice')},
            @shipToName,
            ${bcDecimalParameter('totalHeaderAmount')},
            ${bcDecimalParameter('lineAmount')},
            ${bcDecimalParameter('totalHeaderQty')},
            @lineNo,
            @type,
            0,
            0,
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
          .input('quantity', bcDecimalType(), bcDecimalValue(line.quantity))
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
            ${bcDecimalParameter('quantity')},
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
          .input('quantity', bcDecimalType(), bcDecimalValue(line.quantity))
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
            ${bcDecimalParameter('quantity')},
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
    return {
      company: company.code,
      documentType,
      externalDocumentNo,
      lineCount: lines.length,
      pdaOrder: documentType === 'order' ? pdaOrder : undefined,
      status: 'imported'
    };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

router.post('/imported-orders', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const orders = Array.isArray(body) ? body : Array.isArray(body.orders) ? body.orders : null;

  if (!orders) {
    return res.status(201).json(await stageImportedOrderSql(body));
  }

  if (!orders.length) {
    return res.status(400).json({ error: 'Batch payload must contain at least one order.' });
  }

  const results = [];
  for (const [index, order] of orders.entries()) {
    try {
      results.push(await stageImportedOrderSql(order));
    } catch (err) {
      err.details = {
        ...(err.details || {}),
        batchIndex: index,
        externalDocumentNo: optionalString(order?.externalDocumentNo)
      };
      throw err;
    }
  }

  return res.status(201).json({
    batch: true,
    count: results.length,
    status: 'imported',
    orders: results
  });
}));

module.exports = router;
