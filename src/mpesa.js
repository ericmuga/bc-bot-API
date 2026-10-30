const fs = require('fs');
const http = require('http');
const https = require('https');
const tls = require('tls');
const config = require('./config');

function httpError(message, statusCode, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details !== undefined) {
    error.details = details;
  }

  return error;
}

// Safaricom expects 2547XXXXXXXX / 2541XXXXXXXX; accept the local and +254 forms too.
function normalizePhone(value) {
  const digits = String(value || '').replace(/[\s-]/g, '').replace(/^\+/, '');
  const phone = /^0[17]\d{8}$/.test(digits) ? `254${digits.slice(1)}`
    : /^[17]\d{8}$/.test(digits) ? `254${digits}`
      : digits;

  if (!/^254[17]\d{8}$/.test(phone)) {
    throw httpError('phone must be a valid Safaricom number, e.g. 0712345678 or 254712345678.', 400);
  }

  return phone;
}

// Payment lookups default to the current day in Kenya time, matching the portal's today().
function todayInNairobi() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// The portal serves only its leaf certificate, so Node cannot build the chain on its own.
// Trust Node's bundled roots plus the configured intermediate(s), e.g. certs/RapidSSLTLSRSACAG1.pem.
let httpsAgent;
function portalHttpsAgent() {
  if (!httpsAgent) {
    const extraCas = config.fclOrders.caFiles.map((file) => {
      try {
        return fs.readFileSync(file, 'utf8');
      } catch (err) {
        throw httpError(`FCL_ORDERS_CA_FILE could not be read: ${file}`, 500);
      }
    });
    httpsAgent = new https.Agent({ keepAlive: true, ca: [...tls.rootCertificates, ...extraCas] });
  }

  return httpsAgent;
}

function postJson(url, body) {
  const target = new URL(url);
  const isHttps = target.protocol === 'https:';
  const payload = JSON.stringify(body || {});

  return new Promise((resolve, reject) => {
    const req = (isHttps ? https : http).request(target, {
      method: 'POST',
      agent: isHttps ? portalHttpsAgent() : undefined,
      timeout: config.fclOrders.timeoutMs,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, statusText: res.statusMessage, text }));
      res.on('error', reject);
    });

    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end(payload);
  });
}

async function requestFclOrders(path, body) {
  if (!config.fclOrders.baseUrl) {
    throw httpError('FCL_ORDERS_BASE_URL is not configured.', 503);
  }

  let response;
  try {
    response = await postJson(`${config.fclOrders.baseUrl}${path}`, body);
  } catch (err) {
    // Messages avoid "FCL" because the error handler redacts the SQL database name.
    const code = err.code || '';
    if (err.statusCode) {
      throw err;
    }
    if (code === 'ETIMEDOUT') {
      throw httpError('Orders portal did not respond in time.', 504);
    }
    if (/CERT|SIGNATURE|ISSUER/.test(code)) {
      throw httpError(`Orders portal TLS certificate could not be verified (${code}). Add the missing intermediate certificate via FCL_ORDERS_CA_FILE, or serve the full chain on the portal.`, 502);
    }
    throw httpError(`Orders portal is unreachable: ${code || err.message}`, 504);
  }

  let payload = null;
  try {
    payload = response.text ? JSON.parse(response.text) : null;
  } catch (err) {
    payload = { error: response.text };
  }

  if (response.status < 200 || response.status >= 300) {
    throw httpError(payload?.message || payload?.error || response.statusText || 'Orders portal request failed.',
      response.status === 422 ? 400 : 502, payload);
  }

  return payload;
}

async function initiateStkPush({ phone, amount, tillNumber, storeName, storeNumber, transactionType, orderId }) {
  const payload = await requestFclOrders('/api/v1/mpesa/stk-push', {
    phone,
    amount,
    till_number: tillNumber,
    store_name: storeName,
    store_number: storeNumber || undefined,
    transaction_type: transactionType || config.fclOrders.stkTransactionType,
    orderId: orderId || undefined
  });

  // The portal relays the M-Pesa service body with HTTP 200 even when Safaricom rejects the request.
  if (!payload || String(payload.ResponseCode) !== '0') {
    throw httpError(payload?.errorMessage || payload?.ResponseDescription || payload?.message || 'STK push was not accepted.', 502, payload);
  }

  return payload;
}

// Maps the Safaricom STK query result to pending / paid / failed for polling clients.
async function queryStkPush(checkoutRequestId) {
  const payload = await requestFclOrders(`/api/v1/mpesa/stk-query/${encodeURIComponent(checkoutRequestId)}`) || {};
  let status;

  if (payload.ResultCode !== undefined && payload.ResultCode !== null && payload.ResultCode !== '') {
    status = String(payload.ResultCode) === '0' ? 'paid' : 'failed';
  } else if (payload.errorCode === '500.001.1001') {
    // Safaricom reports "The transaction is being processed" until the customer responds.
    status = 'pending';
  } else {
    throw httpError(payload.errorMessage || payload.message || 'STK push status query failed.', 502, payload);
  }

  return {
    checkoutRequestId,
    status,
    resultCode: payload.ResultCode ?? null,
    resultDesc: payload.ResultDesc || payload.errorMessage || null,
    merchantRequestId: payload.MerchantRequestID || null,
    raw: payload
  };
}

async function fetchPayments({ businessShortCode, amount, date }) {
  const payload = await requestFclOrders('/api/fetch/mpesa-transactions', {
    BusinessShortCode: businessShortCode,
    TransAmount: amount,
    date
  });

  // Re-apply the filters here too: older portal builds return every transaction for the day.
  return (Array.isArray(payload) ? payload : []).filter((row) =>
    String(row.BusinessShortCode).trim() === String(businessShortCode).trim()
    && Number(row.TransAmount) === Number(amount));
}

module.exports = {
  normalizePhone,
  todayInNairobi,
  initiateStkPush,
  queryStkPush,
  fetchPayments
};
