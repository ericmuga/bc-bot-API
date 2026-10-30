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

  // Relative server URLs keep Swagger on the browser's public HTTPS origin
  // even when a reverse proxy forwards an internal host and HTTP scheme.
  const prefix = (req.get('x-forwarded-prefix') || '').split(',')[0].trim();
  return prefix.startsWith('/') && !prefix.startsWith('//')
    ? prefix.replace(/\/+$/, '') || '/'
    : '/';
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
      persistAuthorization: true,
      filter: true,
      // These functions are serialized and run in the browser, so they cannot use closures.
      plugins: [
        function DownloadUrl(system) {
          return SwaggerUIBundle.plugins.DownloadUrl(system);
        },
        function SearchOperations() {
          return {
            fn: {
              // The default filter only matches tag names; match paths, summaries and operationIds too.
              opsFilter(taggedOps, phrase) {
                const query = String(phrase || '').trim().toLowerCase();
                if (!query) {
                  return taggedOps;
                }

                return taggedOps
                  .map((tag, tagName) => (tagName.toLowerCase().includes(query)
                    ? tag
                    : tag.set('operations', tag.get('operations').filter((op) => [
                      op.get('path'),
                      op.get('method'),
                      op.getIn(['operation', 'summary']),
                      op.getIn(['operation', 'operationId'])
                    ].some((value) => String(value || '').toLowerCase().includes(query))))))
                  .filter((tag) => tag.get('operations').size > 0);
              }
            }
          };
        }
      ]
    }
  })(req, res, next);
});

app.use('/test', requireApiKey, (req, res, next) => {
  req.testWritesOnly = true;
  routes(req, res, next);
});
app.use('/api', requireApiKey, routes);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`FCL BOT Integration API listening on http://localhost:${config.port}`);
  console.log(`Swagger UI: http://localhost:${config.port}/docs`);
});
