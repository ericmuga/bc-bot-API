const YAML = require('yaml');

function createSpec(baseUrl = 'http://localhost:3500') {
  return {
  openapi: '3.0.3',
  info: {
    title: 'FCL BOT Integration API',
    version: '1.0.0',
    description: 'Staging API for BOT integrations. Orders are written to Business Central Imported Orders; invoices are written to Imported SalesAL; master data endpoints are read-only.'
  },
  servers: [
    { url: baseUrl, description: 'Current server' }
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key'
      }
    },
    schemas: {
      ImportedOrderRequest: {
        type: 'object',
        required: ['externalDocumentNo', 'sellToCustomerNo', 'shipmentDate', 'salespersonCode', 'lines'],
        properties: {
          documentType: {
            type: 'string',
            enum: ['order', 'invoice'],
            default: 'order',
            description: 'order stages into Imported Orders; invoice stages into Imported SalesAL for the Import SalesAL posting process.',
            example: 'order'
          },
          externalDocumentNo: { type: 'string', example: 'BOT-100045' },
          sellToCustomerNo: { type: 'string', example: '90000' },
          shipmentDate: { type: 'string', format: 'date', example: '2026-06-22' },
          salespersonCode: { type: 'string', example: '019' },
          shipToCode: { type: 'string', nullable: true, example: 'NAIROBI' },
          shipToName: { type: 'string', nullable: true, example: 'Nairobi Outlet' },
          customerSpecification: { type: 'string', nullable: true, example: 'No onions' },
          pdaOrder: {
            type: 'boolean',
            nullable: true,
            default: false,
            example: true,
            description: 'Order-only flag. When documentType=order, this is staged on Imported Orders and mapped to Sales Header PDA Order by the BC import job.'
          },
          location: { type: 'string', nullable: true, example: '3535', description: 'Invoice default location; line.location can override it.' },
          totalHeaderAmount: { type: 'number', nullable: true, example: 1972, description: 'Invoice header total amount used by Import SalesAL posting validation.' },
          totalHeaderQty: { type: 'number', nullable: true, example: 17, description: 'Invoice header total quantity; defaults to the sum of line quantities.' },
          billTo: { type: 'string', nullable: true, example: '90000' },
          cuInvoiceNo: { type: 'string', nullable: true, example: 'CU-100045' },
          cuNo: { type: 'string', nullable: true, example: 'ETR-01' },
          signingTime: { type: 'string', nullable: true, example: '2026-06-22T10:15:00' },
          company: {
            type: 'string',
            nullable: true,
            enum: ['CM', 'FCL', 'FLM', 'RMK'],
            default: 'FCL',
            description: 'Company flag used to route to the matching BC SQL company tables.'
          },
          externalOrderUrl: {
            type: 'string',
            nullable: true,
            format: 'uri',
            example: 'https://bot.example.com/orders/BOT-100045'
          },
          lines: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['itemNo', 'quantity', 'unitOfMeasure'],
              properties: {
                lineNo: { type: 'integer', nullable: true, example: 10000 },
                itemNo: { type: 'string', example: 'PDA001' },
                quantity: { type: 'number', example: 12 },
                unitOfMeasure: { type: 'string', example: 'KG' },
                location: { type: 'string', nullable: true, example: '3535' },
                unitPrice: { type: 'number', nullable: true, example: 116, description: 'Required for invoice payloads.' },
                lineAmount: { type: 'number', nullable: true, example: 1392, description: 'Invoice line amount; defaults to quantity * unitPrice.' },
                productSpecification: { type: 'string', nullable: true, example: 'Vacuum packed' }
              }
            }
          }
        }
      },
      Customer: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '90000' },
          customerNo: { type: 'string', example: '90000' },
          name: { type: 'string', example: 'Web Customer Ltd' },
          shipTo: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'NAIROBI' },
                name: { type: 'string', example: 'Nairobi Outlet' }
              }
            }
          }
        }
      },
      Salesperson: {
        type: 'object',
        properties: {
          salespersonCode: { type: 'string', example: '019' },
          name: { type: 'string', example: 'Jane Sales' },
          contacts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'CT000123' },
                name: { type: 'string', example: 'Jane Sales' },
                phone: { type: 'string', example: '+254700000000' }
              }
            }
          }
        }
      },
      ApiStatus: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: true },
          checkedAt: { type: 'string', format: 'date-time' },
          elapsedMs: { type: 'integer', example: 12 },
          database: {
            type: 'object',
            properties: {
              server: { type: 'string', example: '1********8' },
              database: { type: 'string', example: 'F*L' },
              schema: { type: 'string', example: 'dbo' },
              defaultCompany: { type: 'string', example: 'FCL' },
              selectedCompany: { type: 'string', example: 'FCL' },
              selectedPrefix: { type: 'string', example: 'FCL1$' }
            }
          },
          defaults: {
            type: 'object',
            properties: {
              importedOrderStatus: { type: 'integer', example: 0 },
              importedOrderStatusName: { type: 'string', example: 'Order' },
              importDuplicateRecheckDelayMs: { type: 'integer', example: 5000 },
              limit: { type: 'integer', example: 100 },
              maxLimit: { type: 'integer', example: 1000 }
            }
          }
        }
      },
      BcOrderStatus: {
        type: 'object',
        properties: {
          company: {
            type: 'string',
            enum: ['CM', 'FCL', 'FLM', 'RMK'],
            example: 'FCL'
          },
          externalDocumentNo: { type: 'string', example: 'BOT-100045' },
          orderStatus: {
            type: 'string',
            description: 'BC-facing order status. Posted means found in Sales Invoice Header; otherwise this is the live Sales Header status or staged Imported Orders state.',
            example: 'Released'
          },
          bcStage: {
            type: 'string',
            enum: ['Imported Orders', 'Imported SalesAL', 'Sales Header', 'Posted Sales Invoice'],
            example: 'Sales Header'
          },
          sourceTable: { type: 'string', example: 'Sales Header' },
          documentNo: { type: 'string', example: 'SO-100045' },
          documentType: { type: 'string', nullable: true, example: 'Order' },
          sellToCustomerNo: { type: 'string', nullable: true, example: '90000' },
          postingDate: { type: 'string', nullable: true, format: 'date' },
          importedOrderState: { type: 'string', nullable: true, example: 'salesOrder' },
          statusCounts: {
            type: 'object',
            additionalProperties: { type: 'integer' },
            example: { Post: 2 }
          }
        }
      },
      ImportedOrderStatus: {
        type: 'object',
        properties: {
          company: {
            type: 'string',
            enum: ['CM', 'FCL', 'FLM', 'RMK'],
            example: 'FCL'
          },
          externalDocumentNo: { type: 'string', example: 'BOT-100045' },
          state: {
            type: 'string',
            enum: ['imported', 'processing', 'salesOrder', 'posted', 'cancelled', 'error'],
            example: 'salesOrder'
          },
          lineCount: { type: 'integer', example: 2 },
          expectedLineCount: { type: 'integer', example: 2 },
          errorCount: { type: 'integer', example: 0 },
          errors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sourceTable: { type: 'string', example: 'Imported SalesAL' },
                externalDocumentNo: { type: 'string', example: 'BOT-INV-100045' },
                lineNo: { type: 'integer', example: 10000 },
                itemNo: { type: 'string', example: 'PDA001' },
                errorMessage: { type: 'string', example: 'Item PDA001 was not found or is blocked.' }
              }
            }
          },
          statusCounts: {
            type: 'object',
            additionalProperties: { type: 'integer' },
            example: { Post: 2 }
          },
          salesDocuments: {
            type: 'object',
            properties: {
              salesHeaders: {
                type: 'array',
                description: 'Live sales documents still in Sales Header.',
                items: {
                  type: 'object',
                  properties: {
                    documentNo: { type: 'string', example: 'SO-100045' },
                    documentType: { type: 'integer', example: 1 },
                    status: { type: 'integer', example: 0 },
                    sellToCustomerNo: { type: 'string', example: '90000' },
                    externalDocumentNo: { type: 'string', example: 'BOT-100045' }
                  }
                }
              },
              postedInvoices: {
                type: 'array',
                description: 'Posted invoices. Once posted, the document is no longer in Sales Header.',
                items: {
                  type: 'object',
                  properties: {
                    invoiceNo: { type: 'string', example: 'INV-100045' },
                    postingDate: { type: 'string', format: 'date' },
                    sellToCustomerNo: { type: 'string', example: '90000' },
                    externalDocumentNo: { type: 'string', example: 'BOT-100045' }
                  }
                }
              }
            }
          },
          lines: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                lineNo: { type: 'integer', example: 10000 },
                itemNo: { type: 'string', example: 'PDA001' },
                quantity: { type: 'number', example: 12 },
                status: { type: 'integer', example: 0 },
                statusName: { type: 'string', example: 'Order' },
                expectedLineCount: { type: 'integer', example: 2 },
                error: { type: 'boolean', nullable: true, example: false },
                errorMessage: { type: 'string', nullable: true, example: '' },
                pdaOrder: { type: 'boolean', nullable: true, example: true },
                productSpecification: { type: 'string', nullable: true, example: 'Vacuum packed' }
              }
            }
          }
        }
      }
    }
  },
  security: [{ ApiKeyAuth: [] }],
  paths: {
    '/api/health': {
      get: {
        summary: 'Health check',
        responses: {
          200: { description: 'API and database are reachable' }
        }
      }
    },
    '/api/status': {
      get: {
        summary: 'API readiness status',
        description: 'Checks API, SQL connectivity, resolved Business Central SQL tables, and configured defaults. Without a company query value, returns table mappings for every configured company.',
        parameters: [
          { name: 'company', in: 'query', schema: { type: 'string', enum: ['CM', 'FCL', 'FLM', 'RMK'] }, description: 'Optional company flag. If supplied, only this company table set is returned.' }
        ],
        responses: {
          200: {
            description: 'API readiness details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiStatus' }
              }
            }
          }
        }
      }
    },
    '/api/status/{externalDocumentNo}': {
      get: {
        summary: 'Get BC order status by external document number',
        description: 'Accepts the BOT external document number and company query parameter, then returns the current BC order status. Lookup priority is Sales Invoice Header, then Sales Header, then Imported Orders or Imported SalesAL.',
        parameters: [
          {
            name: 'externalDocumentNo',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          },
          { name: 'company', in: 'query', schema: { type: 'string', enum: ['CM', 'FCL', 'FLM', 'RMK'], default: 'FCL' } }
        ],
        responses: {
          200: {
            description: 'BC order status for the external document number',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/BcOrderStatus' }
              }
            }
          },
          404: { description: 'Order not found' }
        }
      }
    },
    '/api/{company}/status/{externalDocumentNo}': {
      get: {
        summary: 'Get company-prefixed BC order status',
        deprecated: true,
        description: 'Compatibility route. Prefer /api/status/{externalDocumentNo}?company=FCL. Accepts the company flag and BOT external document number, then returns the current BC order status from that company.',
        parameters: [
          {
            name: 'company',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['CM', 'FCL', 'FLM', 'RMK'] },
            description: 'Company flag used to select the BC SQL company table prefix.'
          },
          {
            name: 'externalDocumentNo',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          }
        ],
        responses: {
          200: {
            description: 'BC order status for the company and external document number',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/BcOrderStatus' }
              }
            }
          },
          404: { description: 'Order not found' }
        }
      }
    },
    '/api/customers': {
      get: {
        summary: 'List web customers',
        parameters: [
          { name: 'company', in: 'query', schema: { type: 'string', enum: ['CM', 'FCL', 'FLM', 'RMK'], default: 'FCL' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } }
        ],
        responses: {
          200: {
            description: 'Filtered customer list with nested ship-to addresses',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Customer' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/items': {
      get: {
        summary: 'List PDA items',
        parameters: [
          { name: 'company', in: 'query', schema: { type: 'string', enum: ['CM', 'FCL', 'FLM', 'RMK'], default: 'FCL' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } }
        ],
        responses: {
          200: { description: 'Filtered item list' }
        }
      }
    },
    '/api/salespeople': {
      get: {
        summary: 'List salespeople',
        description: 'Lists salespeople with nested contact codes, names, and phone numbers for the selected company.',
        parameters: [
          { name: 'company', in: 'query', schema: { type: 'string', enum: ['CM', 'FCL', 'FLM', 'RMK'], default: 'FCL' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } }
        ],
        responses: {
          200: {
            description: 'Salespeople with nested contacts',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    company: { type: 'string', example: 'FCL' },
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Salesperson' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/imported-orders': {
      get: {
        summary: 'List imported order lines',
        description: 'Lists staged Imported Orders lines with optional filters. Filters are exact matches except shipment date ranges.',
        parameters: [
          { name: 'externalDocumentNo', in: 'query', schema: { type: 'string' }, description: 'BOT external document number.' },
          { name: 'customerNo', in: 'query', schema: { type: 'string' }, description: 'Alias for sellToCustomerNo.' },
          { name: 'sellToCustomerNo', in: 'query', schema: { type: 'string' } },
          { name: 'shipmentDate', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Exact shipment date, YYYY-MM-DD.' },
          { name: 'shipmentDateFrom', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Shipment date lower bound, YYYY-MM-DD.' },
          { name: 'shipmentDateTo', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Shipment date upper bound, YYYY-MM-DD.' },
          { name: 'shipToCode', in: 'query', schema: { type: 'string' } },
          { name: 'shipToName', in: 'query', schema: { type: 'string' } },
          { name: 'salespersonCode', in: 'query', schema: { type: 'string' } },
          { name: 'itemNo', in: 'query', schema: { type: 'string' } },
          { name: 'company', in: 'query', schema: { type: 'string', enum: ['CM', 'FCL', 'FLM', 'RMK'], default: 'FCL' }, description: 'Company flag used to select the BC SQL company table prefix.' },
          {
            name: 'status',
            in: 'query',
            schema: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
            description: 'Imported Orders status: Order/Execute/Post/Cancelled/Error or 0-4.'
          },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } }
        ],
        responses: {
          200: { description: 'Filtered imported order lines' },
          400: { description: 'Invalid filter' }
        }
      },
      post: {
        summary: 'Create an imported sales document',
        description: 'Writes line-based sales data into Business Central staging. documentType=order writes to Imported Orders. documentType=invoice writes to Imported SalesAL for the Import SalesAL posting process. Before writing, the API checks staging, Sales Header, and Sales Invoice Header for the same External Document No.; if not found, it waits for the configured safety delay and checks again to avoid duplicates during BC posting handover.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ImportedOrderRequest' }
            }
          }
        },
        responses: {
          201: { description: 'Imported order staged successfully' },
          400: { description: 'Invalid request' },
          409: { description: 'External document number already exists in Imported Orders, Sales Header, or Sales Invoice Header' }
        }
      }
    },
    '/api/imported-orders/{externalDocumentNo}': {
      get: {
        summary: 'Get imported order lines',
        parameters: [
          {
            name: 'externalDocumentNo',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          },
          { name: 'company', in: 'query', schema: { type: 'string', enum: ['CM', 'FCL', 'FLM', 'RMK'], default: 'FCL' } }
        ],
        responses: {
          200: { description: 'Imported order lines' },
          404: { description: 'Imported order not found' }
        }
      }
    },
    '/api/imported-orders/{externalDocumentNo}/status': {
      get: {
        summary: 'Get imported order processing status',
        description: 'Returns staged line counts, live Sales Header matches, and posted Sales Invoice Header matches for one external document in the selected company. Imported Orders status Post means the order has been created as a Sales Order; the final posted state is confirmed from Sales Invoice Header.',
        parameters: [
          {
            name: 'externalDocumentNo',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          },
          { name: 'company', in: 'query', schema: { type: 'string', enum: ['CM', 'FCL', 'FLM', 'RMK'], default: 'FCL' } }
        ],
        responses: {
          200: {
            description: 'Imported order processing status',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ImportedOrderStatus' }
              }
            }
          },
          404: { description: 'Imported order not found' }
        }
      }
    },
    '/api/imported-orders/{externalDocumentNo}/errors': {
      get: {
        summary: 'Get imported document processing errors',
        description: 'Returns hard BC processing errors stamped on Imported Orders or Imported SalesAL lines for the selected company. Incomplete payload wait messages remain visible on the status endpoint lines but are not counted as hard errors.',
        parameters: [
          {
            name: 'externalDocumentNo',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          },
          { name: 'company', in: 'query', schema: { type: 'string', enum: ['CM', 'FCL', 'FLM', 'RMK'], default: 'FCL' } }
        ],
        responses: {
          200: { description: 'Imported document line errors' },
          404: { description: 'Imported document not found' }
        }
      }
    }
  }
};
}

const spec = createSpec();

function asYaml(baseUrl) {
  return YAML.stringify(createSpec(baseUrl));
}

module.exports = { spec, asYaml, createSpec };
