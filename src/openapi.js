const YAML = require('yaml');

function createSpec(baseUrl = 'http://localhost:3500') {
  const document = {
  openapi: '3.0.3',
  info: {
    title: 'FCL BOT Integration API',
    version: '1.0.0',
    description: 'Staging API for BOT integrations. Orders are written to Business Central Imported Orders; invoices are written to Imported SalesAL; return orders are written to Imported Return Orders; credit notes are written to Imported Credit Notes AL; master data endpoints are read-only.'
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
            enum: ['order', 'invoice', 'returnOrder', 'creditNote'],
            default: 'order',
            description: 'order stages into Imported Orders; invoice stages into Imported SalesAL; returnOrder stages into Imported Return Orders; creditNote stages into Imported Credit Notes AL.',
            example: 'order'
          },
          externalDocumentNo: { type: 'string', example: 'BOT-100045' },
          sellToCustomerNo: { type: 'string', example: '101' },
          shipmentDate: { type: 'string', format: 'date', example: '2026-06-22' },
          salespersonCode: { type: 'string', example: '019' },
          shipToCode: { type: 'string', nullable: true, example: '101' },
          shipToName: { type: 'string', nullable: true, example: 'BRAEBURN SCHOOL' },
          customerSpecification: { type: 'string', nullable: true, example: 'No onions' },
          pdaOrder: {
            type: 'boolean',
            nullable: true,
            default: false,
            example: false,
            description: 'Order-only flag. When documentType=order, this is staged on Imported Orders and mapped to Sales Header PDA Order by the BC import job.'
          },
          location: { type: 'string', nullable: true, example: '3535', description: 'Invoice default location; line.location can override it.' },
          totalHeaderAmount: { type: 'number', nullable: true, example: 1972, description: 'Invoice header total amount used by Import SalesAL posting validation.' },
          totalHeaderQty: { type: 'number', nullable: true, example: 17, description: 'Invoice header total quantity; defaults to the sum of line quantities.' },
          billTo: { type: 'string', nullable: true, example: '101' },
          cuInvoiceNo: { type: 'string', nullable: true, example: 'CU-100045' },
          cuNo: { type: 'string', nullable: true, example: 'ETR-01' },
          signingTime: { type: 'string', nullable: true, example: '2026-06-22T10:15:00' },
          returnReasonCode: { type: 'string', nullable: true, example: 'DAMAGED', description: 'Default return reason for returnOrder or creditNote lines.' },
          originalOrderNo: { type: 'string', nullable: true, example: 'BOT-100001', description: 'Original order reference for returnOrder payloads.' },
          taxAppliedDocumentNo: { type: 'string', nullable: true, example: 'CU-INV-100045', description: 'Credit note reference to the original fiscal invoice/CU number.' },
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
                itemNo: { type: 'string', example: 'J31010101' },
                quantity: { type: 'number', example: 12 },
                unitOfMeasure: { type: 'string', example: 'PC' },
                location: { type: 'string', nullable: true, example: '3535' },
                unitPrice: { type: 'number', nullable: true, example: 116, description: 'Required for invoice and creditNote payloads.' },
                lineAmount: { type: 'number', nullable: true, example: 1392, description: 'Invoice/credit-note line amount; defaults to quantity * unitPrice.' },
                productSpecification: { type: 'string', nullable: true, example: 'Vacuum packed' },
                returnReasonCode: { type: 'string', nullable: true, example: 'DAMAGED' },
                originalOrderNo: { type: 'string', nullable: true, example: 'BOT-100001' }
              }
            }
          }
        }
      },
      Customer: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '101' },
          customerNo: { type: 'string', example: '101' },
          name: { type: 'string', example: 'Braeburn School' },
          sector: { type: 'string', example: 'HORECA' },
          customerPriceGroup: { type: 'string', example: 'WHOLESALE' },
          shipTo: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string', example: '101' },
                name: { type: 'string', example: 'BRAEBURN SCHOOL' },
                route: {
                  type: 'object',
                  properties: {
                    code: { type: 'string', example: 'R075' },
                    districtGroupCode: { type: 'string', example: 'R075', description: 'Same value as route code; Business Central stores route as District Group Code.' },
                    name: { type: 'string', example: 'Direct Sales' },
                    paymentType: { type: 'string', example: 'Till' },
                    payBill: { type: 'string', example: '123456' },
                    mpesaTill: { type: 'string', example: '123456' },
                    mpesaPaybill: { type: 'string', example: '' }
                  }
                }
              }
            }
          }
        }
      },
      SalesPrice: {"type": "object", "properties": {"itemNo": {"type": "string"}, "salesType": {"type": "integer"}, "salesCode": {"type": "string"}, "customerPriceGroup": {"type": "string", "description": "Sales Code for group prices (sales type 1), the customer's group for customer prices (type 0), otherwise BLANK."}, "currencyCode": {"type": "string"}, "startingDate": {"type": "string"}, "endingDate": {"type": "string"}, "unitPrice": {"type": "number"}, "minimumQuantity": {"type": "number"}, "unitOfMeasureCode": {"type": "string"}, "variantCode": {"type": "string"}, "priceIncludesVAT": {"type": "boolean"}, "allowInvoiceDiscount": {"type": "boolean"}, "allowLineDiscount": {"type": "boolean"}, "vatBusinessPostingGroup": {"type": "string"}}},
      Item: {
        type: 'object',
        properties: {
          unitsOfMeasure: {
            type: 'array',
            description: 'Company-specific Item Unit of Measure rows. Base unit is first with factor 1. Multiply a quantity by its factor to obtain base-unit quantity.',
            items: {
              type: 'object',
              required: ['code', 'StandardUnitConversionFactor'],
              properties: {
                code: { type: 'string', example: 'BOX' },
                StandardUnitConversionFactor: { type: 'number', example: 12, description: 'Qty. per Unit of Measure from Item Unit of Measure; the base unit is always 1.' }
              }
            }
          },
          productionCategory: { type: 'string', description: 'Item extension Production Category code, matched to global Item Attributes.Code.' },
          category: { type: 'string', description: 'Matching global Item Attributes.Attribute; empty if unmatched.' },
          parentCategoryCode: { type: 'string', description: 'Matching attribute Parent_Code.' },
          parentCategory: { type: 'string', description: 'Immediate parent Attribute; empty when absent.' },
          inventoryPostingGroup: { type: 'string', description: 'Inventory Posting Group code from the company Item table.' },
          id: { type: 'string', example: 'J31010101' },
          itemNo: { type: 'string', example: 'J31010101' },
          description: { type: 'string', example: 'Pork Chipolatas 200gms' },
          baseUnitOfMeasure: { type: 'string', example: 'KG' },
          salesUnitOfMeasure: { type: 'string', example: 'PC' },
          barcodeNo: { type: 'string', example: '' },
          unitPrice: { type: 'number', example: 116 },
        }
      },
      Salesperson: {
        type: 'object',
        properties: {
          salespersonCode: { type: 'string', example: '019' },
          name: { type: 'string', example: 'Direct Sales' },
          currentRoute: { type: 'string', example: 'R075' },
          route: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'R075' },
              districtGroupCode: { type: 'string', example: 'R075', description: 'Same value as route code; Business Central stores route as District Group Code.' },
              name: { type: 'string', example: 'Direct Sales' },
              paymentType: { type: 'string', example: 'Till' },
              payBill: { type: 'string', example: '123456' },
              mpesaTill: { type: 'string', example: '123456' },
              mpesaPaybill: { type: 'string', example: '' }
            }
          },
          mpesaTill: { type: 'string', example: '123456' },
          mpesaPaybill: { type: 'string', example: '' },
          contacts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'CT000123' },
                name: { type: 'string', example: 'Direct Sales' },
                phone: { type: 'string', example: '+254700000000' }
              }
            }
          },
          shipTo: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                customerNo: { type: 'string', example: '101' },
                code: { type: 'string', example: '101' },
                name: { type: 'string', example: 'BRAEBURN SCHOOL' },
                route: {
                  type: 'object',
                  properties: {
                    code: { type: 'string', example: 'R075' },
                    districtGroupCode: { type: 'string', example: 'R075', description: 'Same value as route code; Business Central stores route as District Group Code.' },
                    name: { type: 'string', example: 'Direct Sales' },
                    paymentType: { type: 'string', example: 'Till' },
                    payBill: { type: 'string', example: '123456' },
                    mpesaTill: { type: 'string', example: '123456' },
                    mpesaPaybill: { type: 'string', example: '' }
                  }
                },
                route: {
                  type: 'object',
                  properties: {
                    code: { type: 'string', example: 'R075' },
                    districtGroupCode: { type: 'string', example: 'R075', description: 'Same value as route code; Business Central stores route as District Group Code.' },
                    name: { type: 'string', example: 'Direct Sales' },
                    paymentType: { type: 'string', example: 'Till' },
                    payBill: { type: 'string', example: '123456' },
                    mpesaTill: { type: 'string', example: '123456' },
                    mpesaPaybill: { type: 'string', example: '' }
                  }
                },
                mpesaTill: { type: 'string', example: '123456' },
                mpesaPaybill: { type: 'string', example: '' }
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
          },
          access: {
            type: 'object',
            properties: {
              mode: { type: 'string', enum: ['sql', 'api', 'both'], example: 'both' },
              sqlEnabled: { type: 'boolean', example: true },
              apiPagesEnabled: { type: 'boolean', example: true }
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
          sellToCustomerNo: { type: 'string', nullable: true, example: '101' },
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
                itemNo: { type: 'string', example: 'J31010101' },
                errorMessage: { type: 'string', example: 'Item J31010101 was not found or is blocked.' }
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
                    sellToCustomerNo: { type: 'string', example: '101' },
                    externalDocumentNo: { type: 'string', example: 'BOT-100045' },
                    pdaOrder: { type: 'boolean', example: false }
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
                    sellToCustomerNo: { type: 'string', example: '101' },
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
                itemNo: { type: 'string', example: 'J31010101' },
                quantity: { type: 'number', example: 12 },
                status: { type: 'integer', example: 0 },
                statusName: { type: 'string', example: 'Order' },
                expectedLineCount: { type: 'integer', example: 2 },
                error: { type: 'boolean', nullable: true, example: false },
                errorMessage: { type: 'string', nullable: true, example: '' },
                pdaOrder: { type: 'boolean', nullable: true, example: false },
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
    '/api/postman-collection': {
      get: {
        summary: 'Download Postman collection',
        description: 'Downloads the current Postman collection JSON for this API.',
        responses: {
          200: {
            description: 'Postman collection JSON file',
            headers: {
              'Content-Disposition': {
                description: 'Attachment filename for the Postman collection.',
                schema: { type: 'string' }
              }
            },
            content: {
              'application/json': {
                schema: { type: 'object' },
                example: {
                  info: {
                    name: 'FCL BOT Integration API',
                    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
                  },
                  item: []
                }
              }
            }
          }
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
        summary: 'Get BC document status by external document number',
        description: 'Accepts the BOT external document number and company query parameter, then returns the current BC status. Lookup priority is posted invoices, posted credit memos, live Sales Header, then imported staging tables.',
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
          404: { description: 'Document not found' }
        }
      }
    },
    '/api/status/batch': {
      post: {
        summary: 'Get BC statuses for multiple external document numbers',
        description: 'Accepts an array of external document numbers and returns one status object per value. Missing documents are returned with found=false instead of failing the whole request.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['externalDocumentNos'],
                properties: {
                  company: { type: 'string', enum: ['CM', 'FCL', 'FLM', 'RMK'], default: 'FCL' },
                  externalDocumentNos: {
                    type: 'array',
                    minItems: 1,
                    items: { type: 'string' },
                    example: ['BOT-100045', 'BOT-100046', 'BOT-CN-100047']
                  }
                }
              }
            }
          }
        },
        responses: {
          200: { description: 'Batch status response' },
          400: { description: 'Invalid request' }
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
          404: { description: 'Document not found' }
        }
      }
    },
    '/api/customers': {
      get: {
        summary: 'List web customers',
        parameters: [
          { name: 'customerPriceGroup', in: 'query', schema: { type: 'string' }, description: 'Exact customer price group; an empty value matches unassigned customers.' },
          { name: 'company', in: 'query', schema: { type: 'string', enum: ['CM', 'FCL', 'FLM', 'RMK'], default: 'FCL' } },
          { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Broad text search against customer number or customer name.' },
          { name: 'customerNo', in: 'query', schema: { type: 'array', items: { type: 'string' } }, style: 'form', explode: true, description: 'Exact customer number filter. Can be repeated: customerNo=A&customerNo=B.' },
          { name: 'customerNos', in: 'query', schema: { type: 'string' }, description: 'Multiple exact customer numbers as comma-separated text or JSON array text, e.g. A,B or ["A","B"].' },
          { name: 'name', in: 'query', schema: { type: 'string' }, description: 'Partial customer name match.' },
          { name: 'customerName', in: 'query', schema: { type: 'string' }, description: 'Alias for name.' },
          { name: 'shipToCode', in: 'query', schema: { type: 'string' }, description: 'Exact nested ship-to code filter.' },
          { name: 'shipTo', in: 'query', schema: { type: 'string' }, description: 'Alias for shipToCode.' },
          { name: 'shipToName', in: 'query', schema: { type: 'string' }, description: 'Partial nested ship-to name match.' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 }, description: '1-based page number. Ignored when offset is supplied.' },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 }, description: 'Zero-based row offset. Overrides page when supplied.' }
        ],
        responses: {
          200: {
            description: 'Filtered customer list with nested ship-to addresses',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    company: { type: 'string', example: 'FCL' },
                    count: { type: 'integer', example: 25 },
                    totalCount: { type: 'integer', example: 250 },
                    page: { type: 'integer', example: 1 },
                    limit: { type: 'integer', example: 25 },
                    offset: { type: 'integer', example: 0 },
                    totalPages: { type: 'integer', example: 10 },
                    nextPage: { type: 'integer', nullable: true, example: 2, description: 'Next page number, or null when there are no more results. Pass as page and omit offset.' },
                    nextOffset: { type: 'integer', nullable: true, example: 100, description: 'Next offset, or null when there are no more results. Use for offset-based navigation.' },
                    hasNext: { type: 'boolean', example: true },
                    hasPrevious: { type: 'boolean', example: false },
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
          { name: 'productionCategory', in: 'query', schema: { type: 'string' }, description: 'Exact Production Category code.' },
          { name: 'inventoryPostingGroup', in: 'query', schema: { type: 'string' }, description: 'Exact inventory posting group code; empty matches blank codes.' },
          {"name": "minUnitPrice", "in": "query", "schema": {"type": "number", "minimum": 0}},
          {"name": "maxUnitPrice", "in": "query", "schema": {"type": "number", "minimum": 0}},
          {"name": "itemNo", "in": "query", "schema": {"type": "string"}},
          {"name": "itemNos", "in": "query", "schema": {"type": "string"}},
          {"name": "description", "in": "query", "schema": {"type": "string"}},
          {"name": "barcode", "in": "query", "schema": {"type": "string"}},
          {"name": "barcodeNo", "in": "query", "schema": {"type": "string"}},
          {"name": "uom", "in": "query", "schema": {"type": "string"}},
          {"name": "baseUnitOfMeasure", "in": "query", "schema": {"type": "string"}},
          {"name": "salesUnitOfMeasure", "in": "query", "schema": {"type": "string"}},
          { name: 'company', in: 'query', schema: { type: 'string', enum: ['CM', 'FCL', 'FLM', 'RMK'], default: 'FCL' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 }, description: '1-based page number. Ignored when offset is supplied.' },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 }, description: 'Zero-based row offset. Overrides page when supplied.' }
        ],
        responses: {
          200: {
            description: 'Filtered PDA item list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    company: { type: 'string', example: 'FCL' },
                    count: { type: 'integer', example: 25 },
                    totalCount: { type: 'integer', example: 250 },
                    page: { type: 'integer', example: 1 },
                    limit: { type: 'integer', example: 25 },
                    offset: { type: 'integer', example: 0 },
                    totalPages: { type: 'integer', example: 10 },
                    nextPage: { type: 'integer', nullable: true, example: 2, description: 'Next page number, or null when there are no more results. Pass as page and omit offset.' },
                    nextOffset: { type: 'integer', nullable: true, example: 100, description: 'Next offset, or null when there are no more results. Use for offset-based navigation.' },
                    hasNext: { type: 'boolean', example: true },
                    hasPrevious: { type: 'boolean', example: false },
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Item' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/sales-prices': {
      get: {
        summary: 'List sales price master data',
        parameters: [
          {"name": "minUnitPrice", "in": "query", "schema": {"type": "number", "minimum": 0}},
          {"name": "maxUnitPrice", "in": "query", "schema": {"type": "number", "minimum": 0}},
          {"name": "itemNos", "in": "query", "schema": {"type": "string"}, "description": "Exact item numbers as repeated values, comma-separated values, or JSON array."},
          {"name": "customerNo", "in": "query", "schema": {"type": "string"}, "description": "Prices applicable to the customer: customer-specific (sales type 0), the customer's price group (type 1) and All Customers (type 2). Add salesType to narrow. 404 when the customer does not exist. Mutually exclusive with customerPriceGroup."},
          {"name": "customerPriceGroup", "in": "query", "schema": {"type": "string"}, "description": "Group-specific prices (sales type 1). Mutually exclusive with customerNo."},
          {"name": "validOn", "in": "query", "schema": {"type": "string"}, "description": "Prices valid on YYYY-MM-DD, including open-ended BC dates."},
          {"name": "date", "in": "query", "schema": {"type": "string"}, "example": "today", "description": "Alias of validOn: today or YYYY-MM-DD. Excludes expired and not-yet-started prices. Combine with customerNo to get the customer's current prices."},
          {"name": "changedSince", "in": "query", "schema": {"type": "string"}, "description": "syncToken from an earlier response; returns only prices added or updated since then. Deletions are not reported."},
          {"name": "quantity", "in": "query", "schema": {"type": "number", "minimum": 0}, "description": "Return price tiers with minimumQuantity <= quantity; does not select the best price."},
          { name: 'company', in: 'query', schema: { type: 'string', enum: ['CM', 'FCL', 'FLM', 'RMK'], default: 'FCL' } },
          {"name": "itemNo", "in": "query", "schema": {"type": "string"}},
          {"name": "salesCode", "in": "query", "schema": {"type": "string"}},
          {"name": "currencyCode", "in": "query", "schema": {"type": "string"}},
          {"name": "unitOfMeasureCode", "in": "query", "schema": {"type": "string"}},
          {"name": "variantCode", "in": "query", "schema": {"type": "string"}},
          { name: 'salesType', in: 'query', schema: { type: 'integer', minimum: 0, maximum: 3 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 }, description: '1-based page number. Ignored when offset is supplied.' },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 }, description: 'Zero-based row offset. Overrides page when supplied.' }
        ],
        responses: {
          200: {
            description: 'Sales Price table rows; includes expired and future prices unless date/validOn is supplied. No best-price calculation.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    company: { type: 'string', example: 'FCL' },
                    count: { type: 'integer', example: 25 },
                    totalCount: { type: 'integer', example: 250 },
                    page: { type: 'integer', example: 1 },
                    limit: { type: 'integer', example: 25 },
                    offset: { type: 'integer', example: 0 },
                    totalPages: { type: 'integer', example: 10 },
                    nextPage: { type: 'integer', nullable: true, example: 2, description: 'Next page number, or null when there are no more results. Pass as page and omit offset.' },
                    nextOffset: { type: 'integer', nullable: true, example: 100, description: 'Next offset, or null when there are no more results. Use for offset-based navigation.' },
                    hasNext: { type: 'boolean', example: true },
                    hasPrevious: { type: 'boolean', example: false },
                    syncToken: { type: 'string', example: '184467', description: 'Pass as changedSince on the next sync to fetch only added or updated prices. Store it after the last page.' },
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/SalesPrice' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/salespeople': {
      get: {
        summary: 'List salespeople',
        description: 'Lists salespeople with nested contact codes, names, and phone numbers for the selected company.',
        parameters: [
          { name: 'company', in: 'query', schema: { type: 'string', enum: ['CM', 'FCL', 'FLM', 'RMK'], default: 'FCL' } },
          { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Partial match against salesperson code or name.' },
          {
            name: 'salespersonCode',
            in: 'query',
            schema: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
            style: 'form',
            explode: true,
            description: 'One or more salesperson codes. Repeat the parameter, pass a comma-separated list, or pass a JSON array.'
          },
          {
            name: 'salespersonCodes',
            in: 'query',
            schema: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
            description: 'Alias for salespersonCode; supports comma-separated or JSON-array values.'
          },
          {
            name: 'salespeople',
            in: 'query',
            schema: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
            description: 'Alias for salespersonCode; supports comma-separated or JSON-array values.'
          },
          { name: 'id', in: 'query', schema: { type: 'string' }, description: 'Alias for salespersonCode.' },
          { name: 'name', in: 'query', schema: { type: 'string' }, description: 'Partial match against salesperson name.' },
          { name: 'salespersonName', in: 'query', schema: { type: 'string' }, description: 'Alias for name.' },
          { name: 'contactCode', in: 'query', schema: { type: 'string' }, description: 'Only salespeople linked to this contact code.' },
          { name: 'contact', in: 'query', schema: { type: 'string' }, description: 'Alias for contactCode.' },
          { name: 'contactName', in: 'query', schema: { type: 'string' }, description: 'Only salespeople with a linked contact name containing this value.' },
          { name: 'contactPhone', in: 'query', schema: { type: 'string' }, description: 'Only salespeople with a linked contact phone containing this value.' },
          { name: 'phone', in: 'query', schema: { type: 'string' }, description: 'Alias for contactPhone.' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 }, description: '1-based page number. Ignored when offset is supplied.' },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 }, description: 'Zero-based row offset. Overrides page when supplied.' }
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
                    count: { type: 'integer', example: 25 },
                    totalCount: { type: 'integer', example: 250 },
                    page: { type: 'integer', example: 1 },
                    limit: { type: 'integer', example: 25 },
                    offset: { type: 'integer', example: 0 },
                    totalPages: { type: 'integer', example: 10 },
                    nextPage: { type: 'integer', nullable: true, example: 2, description: 'Next page number, or null when there are no more results. Pass as page and omit offset.' },
                    nextOffset: { type: 'integer', nullable: true, example: 100, description: 'Next offset, or null when there are no more results. Use for offset-based navigation.' },
                    hasNext: { type: 'boolean', example: true },
                    hasPrevious: { type: 'boolean', example: false },
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
    '/api/historical-sales-invoice-lines': {
      get: {
        summary: 'List historical posted sales invoice lines',
        description: 'Reads posted Sales Invoice Line history joined to Sales Invoice Header. Use this for posted invoice history after a BOT invoice/order has left staging or Sales Header. At least one filter other than company, limit, page, or offset is required because the posted invoice line table is large.',
        parameters: [
          { name: 'company', in: 'query', schema: { type: 'string', enum: ['CM', 'FCL', 'FLM', 'RMK'], default: 'FCL' } },
          { name: 'externalDocumentNo', in: 'query', schema: { type: 'string' }, description: 'BOT external document number from Sales Invoice Header.' },
          { name: 'invoiceNo', in: 'query', schema: { type: 'string' }, description: 'Posted sales invoice number.' },
          { name: 'documentNo', in: 'query', schema: { type: 'string' }, description: 'Alias for invoiceNo.' },
          { name: 'customerNo', in: 'query', schema: { type: 'string' }, description: 'Alias for sellToCustomerNo.' },
          { name: 'sellToCustomerNo', in: 'query', schema: { type: 'string' } },
          { name: 'postingDate', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Exact posting date, YYYY-MM-DD.' },
          { name: 'postingDateFrom', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Posting date lower bound, YYYY-MM-DD.' },
          { name: 'postingDateTo', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Posting date upper bound, YYYY-MM-DD.' },
          { name: 'salespersonCode', in: 'query', schema: { type: 'string' } },
          { name: 'shipToCode', in: 'query', schema: { type: 'string' } },
          { name: 'itemNo', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 }, description: '1-based page number. Ignored when offset is supplied.' },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 }, description: 'Zero-based row offset. Overrides page when supplied.' }
        ],
        responses: {
          200: {
            description: 'Posted sales invoice line history',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    company: { type: 'string', example: 'FCL' },
                    count: { type: 'integer', example: 25 },
                    totalCount: { type: 'integer', example: 250 },
                    page: { type: 'integer', example: 1 },
                    limit: { type: 'integer', example: 100 },
                    offset: { type: 'integer', example: 0 },
                    totalPages: { type: 'integer', example: 3 },
                    nextPage: { type: 'integer', nullable: true, example: 2, description: 'Next page number, or null when there are no more results. Pass as page and omit offset.' },
                    nextOffset: { type: 'integer', nullable: true, example: 100, description: 'Next offset, or null when there are no more results. Use for offset-based navigation.' },
                    hasNext: { type: 'boolean', example: true },
                    hasPrevious: { type: 'boolean', example: false },
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          invoiceNo: { type: 'string', example: 'PSI-100045' },
                          postingDate: { type: 'string', format: 'date' },
                          externalDocumentNo: { type: 'string', example: 'BOT-100045' },
                          sellToCustomerNo: { type: 'string', example: '101' },
                          billToCustomerNo: { type: 'string', example: '101' },
                          salespersonCode: { type: 'string', example: '019' },
                          shipToCode: { type: 'string', example: '101' },
                          shipToName: { type: 'string', example: 'BRAEBURN SCHOOL' },
                          lineNo: { type: 'integer', example: 10000 },
                          lineType: { type: 'integer', example: 2 },
                          itemNo: { type: 'string', example: 'J31010101' },
                          description: { type: 'string', example: 'Pork Chipolatas 200gms' },
                          quantity: { type: 'number', example: 12 },
                          unitOfMeasure: { type: 'string', example: 'PC' },
                          unitPrice: { type: 'number', example: 116 },
                          lineAmount: { type: 'number', example: 1392 },
                          amountIncludingVat: { type: 'number', example: 1614.72 },
                          vatPercent: { type: 'number', example: 16 }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          400: { description: 'Invalid filter, or no historical invoice filter was provided.' }
        }
      }
    },
    '/api/imported-orders': {
      get: {
        summary: 'List imported orders',
        description: 'Lists staged Imported Orders as order documents with header fields and nested lines. Filters are exact matches except shipment date ranges. Pagination is line-based, and metadata.totalLineCount reports the matching line count.',
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
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 }, description: '1-based page number. Ignored when offset is supplied.' },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 }, description: 'Zero-based row offset. Overrides page when supplied.' }
        ],
        responses: {
          200: {
            description: 'Filtered imported orders with nested lines',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    metadata: {
                      type: 'object',
                      properties: {
                        company: { type: 'string', example: 'FCL' },
                        count: { type: 'integer', example: 1 },
                        documentCount: { type: 'integer', example: 1 },
                        totalLineCount: { type: 'integer', example: 2 },
                        page: { type: 'integer', example: 1 },
                        limit: { type: 'integer', example: 100 },
                        offset: { type: 'integer', example: 0 },
                        totalPages: { type: 'integer', example: 1 },
                        nextPage: { type: 'integer', nullable: true, example: 2, description: 'Next page number, or null when there are no more results. Pass as page and omit offset.' },
                        nextOffset: { type: 'integer', nullable: true, example: 100, description: 'Next offset, or null when there are no more results. Use for offset-based navigation.' },
                        hasNext: { type: 'boolean', example: false },
                        hasPrevious: { type: 'boolean', example: false },
                        paginationMode: { type: 'string', example: 'lines' }
                      }
                    },
                    orders: {
                      type: 'array',
                      items: { type: 'object' }
                    }
                  },
                  example: {
                    metadata: {
                      company: 'FCL',
                      count: 1,
                      documentCount: 1,
                      totalLineCount: 2,
                      page: 1,
                      limit: 100,
                      offset: 0,
                      totalPages: 1,
                      nextPage: null,
                      nextOffset: null,
                      hasNext: false,
                      hasPrevious: false,
                      paginationMode: 'lines'
                    },
                    orders: [
                      {
                        documentType: 'order',
                        externalDocumentNo: 'BOT-100045',
                        sellToCustomerNo: '101',
                        shipmentDate: '2026-06-22T00:00:00.000Z',
                        salespersonCode: '019',
                        shipToCode: '101',
                        shipToName: 'BRAEBURN SCHOOL',
                        customerSpecification: 'No onions',
                        externalOrderUrl: 'https://bot.example.com/orders/BOT-100045',
                        pdaOrder: false,
                        expectedLineCount: 2,
                        lineCount: 2,
                        orderStatus: 'imported',
                        statusName: 'Order',
                        statusCounts: { Order: 2 },
                        lines: [
                          {
                            lineNo: 10000,
                            itemNo: 'J31010101',
                            quantity: 12,
                            unitOfMeasure: 'PC',
                            productSpecification: 'Vacuum packed',
                            status: 0,
                            statusName: 'Order',
                            errorMessage: ''
                          }
                        ]
                      }
                    ]
                  }
                }
              }
            }
          },
          400: { description: 'Invalid filter' }
        }
      },
      post: {
        summary: 'Create an imported sales document',
        description: 'Writes line-based sales data into Business Central staging. Accepts either a single document object, an array of document objects, or { orders: [...] }. documentType=order writes to Imported Orders; invoice writes to Imported SalesAL; returnOrder writes to Imported Return Orders; creditNote writes to Imported Credit Notes AL. Before writing each document, the API checks staging, Sales Header, posted invoices, and posted credit memos for the same External Document No.; if not found, it waits for the configured safety delay and checks again to avoid duplicates during BC posting handover. When SQL_WRITE_TEST_* is configured, the same document is also staged to the test write target and the response includes a targets array.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                oneOf: [
                  { $ref: '#/components/schemas/ImportedOrderRequest' },
                  {
                    type: 'array',
                    minItems: 1,
                    items: { $ref: '#/components/schemas/ImportedOrderRequest' }
                  },
                  {
                    type: 'object',
                    required: ['orders'],
                    properties: {
                      orders: {
                        type: 'array',
                        minItems: 1,
                        items: { $ref: '#/components/schemas/ImportedOrderRequest' }
                      }
                    }
                  }
                ]
              },
              examples: {
                singleOrder: {
                  summary: 'Single order',
                  value: {
                    documentType: 'order',
                    company: 'FCL',
                    externalDocumentNo: 'BOT-100045',
                    sellToCustomerNo: '101',
                    shipmentDate: '2026-06-22',
                    salespersonCode: '019',
                    shipToCode: '101',
                    shipToName: 'BRAEBURN SCHOOL',
                    customerSpecification: 'No onions',
                    pdaOrder: false,
                    externalOrderUrl: 'https://bot.example.com/orders/BOT-100045',
                    lines: [
                      {
                        lineNo: 10000,
                        itemNo: 'J31010101',
                        quantity: 12,
                        unitOfMeasure: 'PC',
                        productSpecification: 'Vacuum packed'
                      }
                    ]
                  }
                },
                batchArray: {
                  summary: 'Batch as array',
                  value: [
                    {
                      documentType: 'order',
                      company: 'FCL',
                      externalDocumentNo: 'BOT-100045',
                      sellToCustomerNo: '101',
                      shipmentDate: '2026-06-22',
                      salespersonCode: '019',
                      shipToCode: '101',
                      shipToName: 'BRAEBURN SCHOOL',
                      customerSpecification: 'No onions',
                      pdaOrder: false,
                      lines: [
                        { lineNo: 10000, itemNo: 'J31010101', quantity: 12, unitOfMeasure: 'PC', productSpecification: 'Vacuum packed' }
                      ]
                    },
                    {
                      documentType: 'order',
                      company: 'FCL',
                      externalDocumentNo: 'BOT-100046',
                      sellToCustomerNo: '101',
                      shipmentDate: '2026-06-22',
                      salespersonCode: '019',
                      shipToCode: '101',
                      shipToName: 'BRAEBURN SCHOOL',
                      customerSpecification: 'No onions',
                      pdaOrder: false,
                      lines: [
                        { lineNo: 10000, itemNo: 'J31010101', quantity: 5, unitOfMeasure: 'PC', productSpecification: 'Tray packed' }
                      ]
                    }
                  ]
                },
                batchWrapper: {
                  summary: 'Batch as object wrapper',
                  value: {
                    orders: [
                      {
                        documentType: 'order',
                        company: 'FCL',
                        externalDocumentNo: 'BOT-100045',
                        sellToCustomerNo: '101',
                        shipmentDate: '2026-06-22',
                        salespersonCode: '019',
                        shipToCode: '101',
                        shipToName: 'BRAEBURN SCHOOL',
                        customerSpecification: 'No onions',
                        pdaOrder: false,
                        lines: [
                          { lineNo: 10000, itemNo: 'J31010101', quantity: 12, unitOfMeasure: 'PC', productSpecification: 'Vacuum packed' }
                        ]
                      }
                    ]
                  }
                }
              }
            }
          }
        },
        responses: {
          201: { description: 'Imported document staged successfully' },
          400: { description: 'Invalid request' },
          409: { description: 'External document number already exists in imported staging, Sales Header, Sales Invoice Header, or Sales Cr.Memo Header' }
        }
      }
    },
    '/api/bc-api/imported-orders': {
      post: {
        summary: 'Create an imported sales document through BC API pages',
        description: 'Alternative import path that posts one line at a time to the custom Business Central API pages under /api/fcl/bot/v1.0. Supports the same documentType values as /api/imported-orders: order, invoice, returnOrder, and creditNote. Enable with BC_ACCESS_MODE=api or BC_ACCESS_MODE=both. When BC_API_TEST_* is configured, the same document is also posted to the test BC API target and the response includes a targets array.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ImportedOrderRequest' }
            }
          }
        },
        responses: {
          201: { description: 'Imported document staged successfully through BC API pages' },
          400: { description: 'Invalid request' },
          409: { description: 'External document number already exists in BC staging or, when SQL duplicate checking is enabled, in live/posted sales tables' },
          503: { description: 'BC API page access is disabled or not configured' }
        }
      }
    },
    '/api/bc-api/imported-orders/{externalDocumentNo}': {
      get: {
        summary: 'Get imported document lines through BC API pages',
        description: 'Reads the custom Business Central API pages for Imported Orders, Imported SalesAL, Imported Return Orders, and Imported Credit Notes AL using the external document number.',
        parameters: [
          {
            name: 'externalDocumentNo',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          },
          { name: 'company', in: 'query', schema: { type: 'string', enum: ['CM', 'FCL', 'FLM', 'RMK'], default: 'FCL' } },
          { name: 'target', in: 'query', schema: { type: 'string', enum: ['primary', 'live', 'test'], default: 'primary' }, description: 'BC API target to inspect. Use test when BC_API_TEST_* is configured.' }
        ],
        responses: {
          200: { description: 'Imported document lines from BC API pages' },
          404: { description: 'Imported document not found through BC API pages' },
          503: { description: 'BC API page access is disabled or not configured' }
        }
      }
    },
    '/api/imported-orders/missing-on-test': {
      get: {
        summary: 'List live imported staging lines missing on test',
        description: 'Compares the primary SQL write target with the configured SQL test mirror and returns imported staging lines that exist on live/primary but not on test. Defaults shipmentDateFrom to the 12th day of the current month.',
        parameters: [
          { name: 'company', in: 'query', schema: { type: 'string', enum: ['CM', 'FCL', 'FLM', 'RMK'], default: 'FCL' } },
          { name: 'shipmentDateFrom', in: 'query', schema: { type: 'string', format: 'date', default: '2026-08-12' }, description: 'Lower bound for staging shipment/date. Defaults to the 12th of the current month.' },
          { name: 'shipmentDateTo', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Optional upper bound for staging shipment/date.' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 }, description: '1-based page number. Ignored when offset is supplied.' },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 }, description: 'Zero-based row offset. Overrides page when supplied.' }
        ],
        responses: {
          200: { description: 'Live imported staging lines that are missing on test' },
          400: { description: 'Invalid company or date filter' },
          503: { description: 'SQL test mirror is not configured' }
        }
      }
    },
    '/api/imported-orders/push-missing-to-test': {
      post: {
        summary: 'Push live imported staging lines missing on test',
        description: 'Copies imported staging rows from the primary SQL write target into the configured SQL test mirror for rows that are missing on test. Defaults shipmentDateFrom to the 12th day of the current month. Existing test rows are not duplicated.',
        parameters: [
          { name: 'company', in: 'query', schema: { type: 'string', enum: ['CM', 'FCL', 'FLM', 'RMK'], default: 'FCL' } },
          { name: 'shipmentDateFrom', in: 'query', schema: { type: 'string', format: 'date', default: '2026-08-12' }, description: 'Lower bound for staging shipment/date. Defaults to the 12th of the current month.' },
          { name: 'shipmentDateTo', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Optional upper bound for staging shipment/date.' }
        ],
        responses: {
          201: { description: 'Missing live rows copied to test' },
          400: { description: 'Invalid company or date filter' },
          503: { description: 'SQL test mirror is not configured' }
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
        description: 'Returns staged line counts, live Sales Header matches, posted Sales Invoice Header matches, and posted Sales Cr.Memo Header matches for one external document in the selected company.',
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
        description: 'Returns hard BC processing errors stamped on Imported Orders, Imported SalesAL, Imported Return Orders, or Imported Credit Notes AL lines for the selected company. Incomplete payload wait messages remain visible on the status endpoint lines but are not counted as hard errors.',
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
  for (const [path, summary, fields, filters, description] of [
    ['/api/inventory-posting-groups', 'List inventory posting groups', ['code', 'description'], ['code', 'search'], 'Reads Inventory Posting Group for the selected company.'],
    ['/api/production-categories', 'List production categories', ['code', 'category', 'parentCode', 'parentCategory'], ['code', 'parentCode', 'search'], 'Reads the shared global Item Attributes table for all companies. parentCode filters immediate children; an empty parentCode selects blank-parent rows. company is validated and echoed but does not restrict the shared table.']
  ]) {
    const response = JSON.parse(JSON.stringify(document.paths['/api/items'].get.responses));
    const properties = response[200].content['application/json'].schema.properties;
    properties.data.items = { type: 'object', properties: Object.fromEntries(fields.map(field => [field, { type: 'string' }])) };
    if (path.endsWith('production-categories')) properties.scope = { type: 'string', enum: ['global'] };
    response[200].description = summary;
    document.paths[path] = { get: {
      summary, description,
      parameters: [
        { name: 'company', in: 'query', schema: { type: 'string', enum: ['CM', 'FCL', 'FLM', 'RMK'], default: 'FCL' } },
        ...filters.map(name => ({ name, in: 'query', schema: { type: 'string' }, description: name === 'search' ? 'Partial code or name search.' : 'Exact code filter.' })),
        ...document.paths['/api/items'].get.parameters.filter(parameter => ['limit', 'page', 'offset'].includes(parameter.name))
      ], responses: response
    } };
  }
  const importOperation = document.paths['/api/imported-orders'].post;
  const exampleHeader = { company: 'FCL', externalDocumentNo: 'BOT-100045', sellToCustomerNo: '101', shipmentDate: '2026-06-22', salespersonCode: '019', shipToCode: '101' };
  const exampleLine = { lineNo: 10000, itemNo: 'J31010101', quantity: 12, unitOfMeasure: 'PC' };
  for (const [path, documentType, summary, example] of [
    ['/api/sales-orders', 'order', 'Create sales orders', { ...exampleHeader, pdaOrder: false, lines: [exampleLine] }],
    ['/api/sales-invoices', 'invoice', 'Create sales invoices', { ...exampleHeader, location: '3535', cuInvoiceNo: 'CU-100045', cuNo: 'ETR-01', signingTime: '2026-06-22T10:15:00', totalHeaderAmount: 1392, lines: [{ ...exampleLine, unitPrice: 116 }] }],
    ['/api/sales-returns', 'returnOrder', 'Create sales return orders', { ...exampleHeader, externalDocumentNo: 'BOT-RET-100045', originalOrderNo: 'BOT-100045', returnReasonCode: 'DAMAGED', lines: [exampleLine] }],
    ['/api/sales-credit-notes', 'creditNote', 'Create sales credit notes', { ...exampleHeader, externalDocumentNo: 'BOT-CN-100045', taxAppliedDocumentNo: 'CU-INV-100045', returnReasonCode: 'DAMAGED', lines: [{ ...exampleLine, unitPrice: 116 }] }]
  ]) {
    const operation = JSON.parse(JSON.stringify(importOperation));
    operation.summary = summary;
    operation.description = `Dedicated ${documentType} endpoint: same payload and behaviour as POST /api/imported-orders with documentType fixed to ${documentType}. documentType may be omitted; any other value is rejected with 400. Accepts a single document, an array, or { orders: [...] }.`;
    operation.requestBody.content['application/json'].examples = { single: { summary, value: example }, batch: { summary: 'Batch as array', value: [example] } };
    document.paths[path] = { post: operation };
  }
  const missingResponse = JSON.parse(JSON.stringify(document.paths['/api/items'].get.responses[200]));
  missingResponse.description = 'Live imported staging lines that are missing on test';
  const missingProperties = missingResponse.content['application/json'].schema.properties;
  missingProperties.data.items = { type: 'object' };
  Object.assign(missingProperties, {
    liveTarget: { type: 'string', example: 'primary' },
    testTarget: { type: 'string', example: 'test' },
    shipmentDateFrom: { type: 'string', format: 'date' },
    shipmentDateTo: { type: 'string', format: 'date', nullable: true },
    liveLineCount: { type: 'integer' },
    testLineCount: { type: 'integer' }
  });
  document.paths['/api/imported-orders/missing-on-test'].get.responses[200] = missingResponse;
  for (const [path, operations] of Object.entries({ ...document.paths })) {
    if (!path.startsWith('/api/')) continue;
    const testOperations = JSON.parse(JSON.stringify(operations));
    for (const [method, operation] of Object.entries(testOperations)) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) continue;
      operation.summary = `[Test writes] ${operation.summary || ''}`;
      operation.description = `${operation.description || ''} On this path, writes go only to the configured test destination, with no primary write or mirroring. Reads keep their usual source. Company flags apply as usual. Missing or primary-equivalent test configuration rejects writes with 503.`.trim();
      if (operation.operationId) operation.operationId += 'Test';
    }
    document.paths[path.replace('/api/', '/api/test/')] = testOperations;
  }
  return document;
}

const spec = createSpec();

function asYaml(baseUrl) {
  return YAML.stringify(createSpec(baseUrl));
}

module.exports = { spec, asYaml, createSpec };
