const config = require('./config');

function redactConfiguredSecrets(message) {
  let redacted = String(message || 'Unexpected server error.');
  const values = [
    config.sql.server,
    config.sql.database,
    config.sql.user
  ].filter(Boolean);

  for (const value of values) {
    redacted = redacted.split(value).join('[redacted]');
  }

  return redacted;
}

function requireApiKey(req, res, next) {
  if (!config.apiKey) {
    return res.status(500).json({
      error: 'BOT_API_KEY is not configured on the API server.'
    });
  }

  const suppliedKey = req.get('x-api-key');
  if (suppliedKey !== config.apiKey) {
    return res.status(401).json({
      error: 'Invalid or missing API key.'
    });
  }

  return next();
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const status = err.statusCode || err.status || 500;
  const response = {
    error: redactConfiguredSecrets(err.message)
  };

  if (err.details) {
    response.details = err.details;
  }

  return res.status(status).json(response);
}

module.exports = {
  requireApiKey,
  errorHandler
};
