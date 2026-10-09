const config = require('./config');
const { getCompanyConfig } = require('./db');

function ensureFetch() {
  if (typeof fetch !== 'function') {
    const error = new Error('This Node.js runtime does not provide fetch. Use Node.js 18+ for BC API page access.');
    error.statusCode = 500;
    throw error;
  }
}

function ensureBcApiConfigured(target) {
  if (!config.access.apiPagesEnabled) {
    const error = new Error('BC API page access is disabled. Set BC_ACCESS_MODE=api or BC_ACCESS_MODE=both.');
    error.statusCode = 503;
    throw error;
  }

  if (!bcApiTarget(target).baseUrl) {
    const error = new Error('BC_API_BASE_URL is not configured.');
    error.statusCode = 503;
    throw error;
  }
}

function bcApiTarget(target) {
  return target || config.bcApi;
}

function getCompanyId(companyCode, target) {
  const company = getCompanyConfig(companyCode);
  const apiTarget = bcApiTarget(target);
  return apiTarget.companyIds[company.code] || company.code;
}

function authHeaders(target) {
  const apiTarget = bcApiTarget(target);

  if (apiTarget.bearerToken) {
    return {
      Authorization: `Bearer ${apiTarget.bearerToken}`
    };
  }

  if (apiTarget.username && apiTarget.password) {
    return {
      Authorization: `Basic ${Buffer.from(`${apiTarget.username}:${apiTarget.password}`).toString('base64')}`
    };
  }

  return {};
}

function odataString(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function buildUrl(entitySetName, companyCode, query = {}, target) {
  const apiTarget = bcApiTarget(target);
  const companyId = encodeURIComponent(getCompanyId(companyCode, apiTarget));
  const path = [
    apiTarget.baseUrl,
    'api',
    apiTarget.publisher,
    apiTarget.group,
    apiTarget.version,
    `companies(${companyId})`,
    entitySetName
  ].join('/');
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, value);
    }
  }

  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
}

async function requestJson(method, entitySetName, companyCode, body, query, target) {
  ensureFetch();
  ensureBcApiConfigured(target);
  const apiTarget = bcApiTarget(target);

  if (!apiTarget.baseUrl) {
    const error = new Error(`BC API target '${apiTarget.name || 'primary'}' is missing a base URL.`);
    error.statusCode = 503;
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), apiTarget.timeoutMs);

  try {
    const response = await fetch(buildUrl(entitySetName, companyCode, query, apiTarget), {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...authHeaders(apiTarget)
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (err) {
      payload = { error: text };
    }

    if (!response.ok) {
      const error = new Error(payload.error?.message || payload.error || response.statusText || 'Business Central API request failed.');
      error.statusCode = response.status;
      error.details = payload;
      throw error;
    }

    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeCollection(payload) {
  if (Array.isArray(payload?.value)) {
    return payload.value;
  }

  return [];
}

function sortByLineNo(lines) {
  return [...lines].sort((left, right) => {
    const leftLineNo = Number(left.lineNo ?? left.LineNo ?? left['Line No_']);
    const rightLineNo = Number(right.lineNo ?? right.LineNo ?? right['Line No_']);

    if (Number.isFinite(leftLineNo) && Number.isFinite(rightLineNo)) {
      return leftLineNo - rightLineNo;
    }

    if (Number.isFinite(leftLineNo)) {
      return -1;
    }

    if (Number.isFinite(rightLineNo)) {
      return 1;
    }

    return 0;
  });
}

async function postLine(entitySetName, companyCode, line, target) {
  return requestJson('POST', entitySetName, companyCode, line, null, target);
}

async function getLinesByExternalDocumentNo(entitySetName, companyCode, fieldName, externalDocumentNo, target) {
  return sortByLineNo(normalizeCollection(await requestJson('GET', entitySetName, companyCode, null, {
    '$filter': `${fieldName} eq ${odataString(externalDocumentNo)}`
  }, target)));
}

module.exports = {
  postLine,
  getLinesByExternalDocumentNo
};
