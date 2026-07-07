const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const routes = require('./routes');
const config = require('./config');
const { requireApiKey, errorHandler } = require('./middleware');
const { createSpec, asYaml } = require('./openapi');

const app = express();

app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

function getBaseUrl(req) {
  if (config.publicBaseUrl) {
    return config.publicBaseUrl.replace(/\/$/, '');
  }

  const forwardedProto = req.get('x-forwarded-proto');
  const forwardedHost = req.get('x-forwarded-host');
  const forwardedPrefix = req.get('x-forwarded-prefix') || '';
  const proto = forwardedProto ? forwardedProto.split(',')[0].trim() : req.protocol;
  const host = forwardedHost ? forwardedHost.split(',')[0].trim() : req.get('host');

  return `${proto}://${host}${forwardedPrefix}`;
}

app.get('/', (req, res) => {
  res.redirect('/docs');
});

app.get('/openapi.json', (req, res) => {
  res.json(createSpec(getBaseUrl(req)));
});

app.get('/openapi.yaml', (req, res) => {
  res.type('text/yaml').send(asYaml(getBaseUrl(req)));
});

app.use('/docs', swaggerUi.serve, (req, res, next) => {
  swaggerUi.setup(createSpec(getBaseUrl(req)), {
    explorer: true,
    swaggerOptions: {
      persistAuthorization: true
    }
  })(req, res, next);
});

app.use('/api', requireApiKey, routes);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`FCL BOT Integration API listening on http://localhost:${config.port}`);
  console.log(`Swagger UI: http://localhost:${config.port}/docs`);
});
