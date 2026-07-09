# FCL BOT Integration API

Node.js gateway for BOT integrations. It exposes Swagger documentation and writes BOT orders into Business Central `Imported Orders`. Customer and item endpoints are read-only.

## Run

```powershell
cd bot-integration-api
npm install
copy .env.example .env
npm start
```

Swagger UI:

```text
http://localhost:3500/docs
```

When the API is published through the Farmers Choice reverse proxy, set the public HTTPS base URL so Swagger calls the same origin:

```env
PUBLIC_BASE_URL=https://nav.farmerschoice.co.ke:8092
```

Swagger UI through the proxy:

```text
https://nav.farmerschoice.co.ke:8092/docs
```

OpenAPI JSON:

```text
http://localhost:3500/openapi.json
```

## Security

All `/api/*` endpoints require:

```http
x-api-key: <BOT_API_KEY>
```

Change `BOT_API_KEY` in `.env` before production use.

## Company Routing

Requests use a company flag to select the Business Central SQL company tables:

```env
DEFAULT_COMPANY_CODE=FCL
BC_COMPANY_PREFIXES=CM=CM3,FCL=FCL1,FLM=FLM1,RMK=RMK
```

Company flags:

```text
CM  -> CM3$
FCL -> FCL1$
FLM -> FLM1$
RMK -> RMK$
```

For transaction `GET` endpoints, pass the flag as a query parameter:

```http
GET /api/customers?company=FCL
GET /api/items?company=RMK
GET /api/salespeople?company=FCL
GET /api/imported-orders?company=CM&externalDocumentNo=BOT-100045
GET /api/status/BOT-100045?company=FLM
POST /api/status/batch
GET /api/imported-orders/BOT-100045/status?company=FLM
```

For `POST /api/imported-orders`, pass `company` in the JSON body. The same flag is also written to the Imported Orders `Company` field.

## Pagination

List endpoints support `limit`, `page`, and `offset`:

```http
GET /api/customers?company=FCL&limit=25&page=2
GET /api/items?company=FCL&limit=50&offset=100
GET /api/salespeople?company=FCL&limit=25&page=1
GET /api/imported-orders?company=FCL&limit=100&page=3
```

`page` is 1-based. `offset` is 0-based and overrides `page` when supplied. List responses keep `data` unchanged and add:

```json
{
  "count": 25,
  "totalCount": 250,
  "page": 2,
  "limit": 25,
  "offset": 25,
  "totalPages": 10,
  "hasNext": true,
  "hasPrevious": true
}
```

The items endpoint prefers the Business Central Item extension field `PDA Item = 1`. For backward compatibility, if the extension SQL table cannot be resolved it falls back to a base-table `PDA Item` column when present, and otherwise behaves like the earlier read endpoint. If the Item extension SQL table cannot be resolved automatically, set:

```env
SQL_TABLE_ITEM_EXT=CM3$Item$437dbf0e-84ff-417a-965d-ed2bb9650972$ext
```

The customers endpoint prefers the Business Central Customer extension field `Web Portal = 1`. For backward compatibility, if the extension SQL table cannot be resolved it falls back to a base-table `Web Portal` column when present, and otherwise behaves like the earlier read endpoint. If the Customer extension SQL table cannot be resolved automatically, set:

```env
SQL_TABLE_CUSTOMER_EXT=CM3$Customer$437dbf0e-84ff-417a-965d-ed2bb9650972$ext
```

The status endpoints read live order `pdaOrder` from the Business Central Sales Header extension table. Leave this blank for automatic company-aware resolution, or set it only for a single-company diagnostic run:

```env
SQL_TABLE_SALES_HEADER_EXT=CM3$Sales Header$437dbf0e-84ff-417a-965d-ed2bb9650972$ext
```

Salespeople route enrichment uses `Salesperson/Purchaser`, optional `Salesperson/Purchaser` `$ext`, `Ship-to Address`, optional `Ship-to Address` `$ext`, and `District Group Code`. Leave these blank for automatic company-aware resolution, or set them only for a single-company diagnostic run:

```env
SQL_TABLE_SALESPERSON_PURCHASER_EXT=CM3$Salesperson_Purchaser$437dbf0e-84ff-417a-965d-ed2bb9650972$ext
SQL_TABLE_SHIP_TO_ADDRESS_EXT=CM3$Ship-to Address$437dbf0e-84ff-417a-965d-ed2bb9650972$ext
SQL_TABLE_DISTRICT_GROUP_CODE=CM3$District Group Code$23dc970e-11e8-4d9b-8613-b7582aec86ba
```

## Data Access Mode

The gateway can use direct SQL staging, Business Central API pages, or both during transition:

```env
BC_ACCESS_MODE=both
```

Allowed values:

```text
sql  -> current direct SQL route only
api  -> Business Central API page route only
both -> both paths are enabled
```

Business Central API page settings:

```env
BC_API_BASE_URL=https://nav.farmerschoice.co.ke:8092/BC240
BC_API_PUBLISHER=fcl
BC_API_GROUP=bot
BC_API_VERSION=v1.0
BC_API_COMPANY_IDS=CM=<company-guid>,FCL=<company-guid>,FLM=<company-guid>,RMK=<company-guid>
BC_API_USERNAME=<bc-user>
BC_API_WEB_SERVICE_ACCESS_KEY=<web-service-access-key>
```

If OAuth is used instead of basic auth/web service key:

```env
BC_API_BEARER_TOKEN=<access-token>
```

## Endpoints

```text
GET  /api/health
GET  /api/status
GET  /api/status/:externalDocumentNo
POST /api/status/batch
GET  /api/customers
GET  /api/items
GET  /api/salespeople
GET  /api/imported-orders
POST /api/imported-orders
POST /api/bc-api/imported-orders
GET  /api/bc-api/imported-orders/:externalDocumentNo
GET  /api/imported-orders/:externalDocumentNo
GET  /api/imported-orders/:externalDocumentNo/status
GET  /api/imported-orders/:externalDocumentNo/errors
```

## Status Checks

`GET /api/health` is the lightweight uptime check. It confirms the API can connect to SQL:

```json
{
  "ok": true,
  "database": {
    "server": "1********8",
    "database": "F*L",
    "schema": "dbo",
    "defaultCompany": "FCL",
    "selectedCompany": "FCL",
    "selectedPrefix": "FCL1$"
  }
}
```

`GET /api/status` is the readiness check for integrations. It confirms SQL connectivity, resolved BC tables for every configured company, and configured defaults. Server and database values are masked in the response:

```json
{
  "ok": true,
  "checkedAt": "2026-07-06T09:00:00.000Z",
  "elapsedMs": 12,
  "database": {
    "server": "1********8",
    "database": "F*L",
    "schema": "dbo",
    "defaultCompany": "FCL",
    "selectedCompany": "FCL",
    "selectedPrefix": "FCL1$"
  },
  "companies": [
    { "code": "CM", "prefix": "CM3$" },
    { "code": "FCL", "prefix": "FCL1$" },
    { "code": "FLM", "prefix": "FLM1$" },
    { "code": "RMK", "prefix": "RMK$" }
  ],
  "tables": {
    "CM": {
      "prefix": "CM3$",
      "tables": {
        "importedOrders": "[dbo].[CM3$Imported Orders$23dc970e-11e8-4d9b-8613-b7582aec86ba]"
      }
    }
  },
  "defaults": {
    "importedOrderStatus": 0,
    "importedOrderStatusName": "Order",
    "limit": 100,
    "maxLimit": 1000
  }
}
```

`GET /api/status/:externalDocumentNo?company=FCL` is the primary BOT document status check. It accepts the company flag as a query parameter and BOT external document number as the path value, then returns the current BC status:

```http
GET /api/status/BOT-100045?company=FCL
GET /api/status/BOT-100045?company=CM
GET /api/status/BOT-100045?company=FLM
GET /api/status/BOT-100045?company=RMK
```

```json
{
  "company": "FCL",
  "externalDocumentNo": "BOT-100045",
  "orderStatus": "Released",
  "bcStage": "Sales Header",
  "sourceTable": "Sales Header",
  "documentNo": "SO-100045",
  "documentType": "Order",
  "sellToCustomerNo": "101",
  "importedOrderState": "salesOrder",
  "statusCounts": {
    "Post": 2
  }
}
```

The older company-prefixed route is still supported for compatibility:

```http
GET /api/FCL/status/BOT-100045
```

Lookup priority:

```text
1. Sales Invoice Header      -> orderStatus = Invoiced
2. Sales Cr.Memo Header      -> orderStatus = Posted Credit Memo
3. Sales Header              -> orderStatus = Open/Released/Pending Approval/Pending Prepayment/Execute/Post
4. Imported Orders           -> orderStatus = imported/processing/salesOrder/cancelled/error
5. Imported SalesAL          -> orderStatus = imported/processing/posted/error
6. Imported Return Orders    -> orderStatus = imported/salesReturnOrder/cancelled/error
7. Imported Credit Notes AL  -> orderStatus = imported/processing/posted/error
```

For batch checks, call `POST /api/status/batch`:

```http
POST /api/status/batch
Content-Type: application/json
x-api-key: <BOT_API_KEY>

{
  "company": "FCL",
  "externalDocumentNos": ["BOT-100045", "BOT-100046", "BOT-CN-100047"]
}
```

Missing documents are returned with `found=false`, so one unknown external document number does not fail the whole status request.

`GET /api/imported-orders/:externalDocumentNo/status?company=FCL` checks a specific staged document in the selected company:

```http
GET /api/imported-orders/BOT-100045/status?company=FCL
```

```json
{
  "company": "FCL",
  "externalDocumentNo": "BOT-100045",
  "state": "imported",
  "lineCount": 2,
  "expectedLineCount": 2,
  "statusCounts": {
    "Order": 2
  },
  "errors": [],
  "salesDocuments": {
    "salesHeaders": [],
    "postedInvoices": []
  },
  "lines": [
    {
      "lineNo": 10000,
      "itemNo": "J31010101",
      "quantity": 12,
      "status": 0,
      "statusName": "Order",
      "expectedLineCount": 2,
      "errorMessage": "",
      "productSpecification": "Vacuum packed"
    }
  ]
}
```

Imported order status mapping:

```text
0 = Order
1 = Execute
2 = Post
3 = Cancelled
4 = Error
```

Important BC lifecycle note:

- `Imported Orders.Status = Post` means the imported line has been moved into a live Sales Order.
- The API writes `Expected Line Count` to each staged line. BC processing waits until the number of staged lines for the external document matches that expected count.
- Incomplete payloads remain in staging with a waiting message. Hard failures such as missing or blocked customer/item/salesperson are marked as errors on the staged lines with an error message.
- Once the Sales Order is posted, it leaves `Sales Header`.
- The API only returns `state = posted` when it finds a matching record in `Sales Invoice Header` by `External Document No.`.
- If a matching live Sales Order exists but no posted invoice exists yet, the API returns `state = salesOrder`.

`GET /api/imported-orders/:externalDocumentNo/errors?company=FCL` returns hard processing errors stamped by BC on the staged lines. This covers both order staging (`Imported Orders`) and invoice staging (`Imported SalesAL`):

```http
GET /api/imported-orders/BOT-INV-100045/errors?company=FCL
```

```json
{
  "company": "FCL",
  "externalDocumentNo": "BOT-INV-100045",
  "lineCount": 2,
  "expectedLineCount": 2,
  "errorCount": 1,
  "errors": [
    {
      "sourceTable": "Imported SalesAL",
      "externalDocumentNo": "BOT-INV-100045",
      "lineNo": 10000,
      "itemNo": "J31010101",
      "errorMessage": "Item J31010101 was not found or is blocked."
    }
  ]
}
```

## Customer Payload

`GET /api/customers` returns web customers with nested ship-to addresses:

Supported filters:

```http
GET /api/customers?company=FCL&search=101
GET /api/customers?company=FCL&customerNo=101&customerNo=102
GET /api/customers?company=FCL&customerNos=101,102
GET /api/customers?company=FCL&customerNos=["101","102"]
GET /api/customers?company=FCL&name=Web
GET /api/customers?company=FCL&customerName=Web
GET /api/customers?company=FCL&shipToCode=101
GET /api/customers?company=FCL&shipTo=101
GET /api/customers?company=FCL&shipToName=BRAEBURN
```

```json
{
  "data": [
    {
      "id": "101",
      "customerNo": "101",
      "name": "Braeburn School",
      "sector": "HORECA",
      "shipTo": [
        {
          "code": "101",
          "name": "BRAEBURN SCHOOL"
        }
      ]
    }
  ]
}
```

## Item Payload

`GET /api/items` returns PDA items only and includes barcode values from the Business Central Item extension table:

Supported filters:

```http
GET /api/items?company=FCL&search=beef
GET /api/items?company=FCL&itemNo=J31010101&itemNo=J31010201
GET /api/items?company=FCL&itemNos=J31010101,J31010201
GET /api/items?company=FCL&itemNos=["J31010101","J31010201"]
GET /api/items?company=FCL&barcode=616000
GET /api/items?company=FCL&barcodeNo=6160001234567
GET /api/items?company=FCL&barcodeText=6160001234567
GET /api/items?company=FCL&uom=PC
GET /api/items?company=FCL&baseUnitOfMeasure=KG
GET /api/items?company=FCL&salesUnitOfMeasure=BAG
GET /api/items?company=FCL&description=beef
GET /api/items?company=FCL&barcodeType=0
```

```json
{
  "company": "FCL",
  "data": [
    {
      "id": "J31010101",
      "itemNo": "J31010101",
      "description": "Pork Chipolatas 200gms",
      "baseUnitOfMeasure": "KG",
      "salesUnitOfMeasure": "PC",
      "barcodeNo": "",
      "barcodeText": "",
      "barcodeType": 0
    }
  ]
}
```

## Salespeople Payload

`GET /api/salespeople` returns salespeople with the current route, route M-Pesa till/paybill details, nested contacts, and assigned ship-to addresses:

Supported query params:

```text
company
search
salespersonCode
salespersonCodes
salespeople
id
name
salespersonName
contactCode
contact
contactName
contactPhone
phone
limit
```

`salespersonCode`, `salespersonCodes`, `salespeople`, and `id` accept a single value, repeated query params, comma-separated values, or a JSON array.

```json
{
  "company": "FCL",
  "data": [
    {
      "salespersonCode": "019",
      "name": "Direct Sales",
      "currentRoute": "R075",
      "route": {
        "code": "R075",
        "districtGroupCode": "R075",
        "name": "Direct Sales",
        "paymentType": "Till",
        "payBill": "123456",
        "mpesaTill": "123456",
        "mpesaPaybill": ""
      },
      "mpesaTill": "123456",
      "mpesaPaybill": "",
      "contacts": [
        {
          "code": "CT000123",
          "name": "Direct Sales",
          "phone": "+254700000000"
        }
      ],
      "shipTo": [
        {
          "customerNo": "101",
          "code": "101",
          "name": "BRAEBURN SCHOOL",
          "route": {
            "code": "R075",
            "districtGroupCode": "R075",
            "name": "Direct Sales",
            "paymentType": "Till",
            "payBill": "123456",
            "mpesaTill": "123456",
            "mpesaPaybill": ""
          },
          "mpesaTill": "123456",
          "mpesaPaybill": ""
        }
      ]
    }
  ]
}
```

## Imported Sales Document Payload

`GET /api/imported-orders` lists staged imported order lines. Supported query params:

```text
externalDocumentNo
customerNo
sellToCustomerNo
shipmentDate
shipmentDateFrom
shipmentDateTo
shipToCode
shipToName
salespersonCode
itemNo
company
status
limit
```

Examples:

```http
GET /api/imported-orders?externalDocumentNo=BOT-100045
GET /api/imported-orders?customerNo=101&shipmentDate=2026-06-22
GET /api/imported-orders?salespersonCode=019&shipToCode=101&status=Order
GET /api/imported-orders?shipmentDateFrom=2026-06-01&shipmentDateTo=2026-06-30&limit=500
GET /api/imported-orders?company=RMK&externalDocumentNo=BOT-100045
```

`status` accepts either names or values:

```text
Order = 0
Execute = 1
Post = 2
Cancelled = 3
Error = 4
```

```json
{
  "documentType": "order",
  "externalDocumentNo": "BOT-100045",
  "sellToCustomerNo": "101",
  "shipmentDate": "2026-06-22",
  "salespersonCode": "019",
  "shipToCode": "101",
  "shipToName": "BRAEBURN SCHOOL",
  "customerSpecification": "No onions",
  "company": "FCL",
  "pdaOrder": false,
  "externalOrderUrl": "https://bot.example.com/orders/BOT-100045",
  "lines": [
    {
      "lineNo": 10000,
      "itemNo": "J31010101",
      "quantity": 12,
      "unitOfMeasure": "PC",
      "productSpecification": "Vacuum packed"
    },
    {
      "lineNo": 20000,
      "itemNo": "J31010201",
      "quantity": 5,
      "unitOfMeasure": "PC",
      "productSpecification": "Tray packed"
    }
  ]
}
```

For order staging into `Imported Orders`, `pdaOrder` is optional and defaults to `false`. When set to `true`, the BC import job maps it to `Sales Header`.`PDA Order`.

Supported `documentType` values are:

```text
order       -> Imported Orders
invoice     -> Imported SalesAL
returnOrder -> Imported Return Orders
creditNote  -> Imported Credit Notes AL
```

For invoice staging into `Imported SalesAL`, use `documentType = invoice`. Invoice lines require `unitPrice`; `lineAmount` defaults to `quantity * unitPrice`; header totals default from the lines when omitted. The `pdaOrder` flag is ignored for invoices because they are staged through `Imported SalesAL`.
The API automatically stamps `Expected Line Count` on every staged line from `lines.length`; the BOT does not need to send this value separately.

```json
{
  "documentType": "invoice",
  "company": "FCL",
  "externalDocumentNo": "BOT-INV-100045",
  "sellToCustomerNo": "101",
  "shipmentDate": "2026-06-22",
  "salespersonCode": "019",
  "shipToCode": "101",
  "shipToName": "BRAEBURN SCHOOL",
  "location": "3535",
  "totalHeaderAmount": 1972,
  "totalHeaderQty": 17,
  "billTo": "101",
  "cuInvoiceNo": "CU-100045",
  "cuNo": "ETR-01",
  "signingTime": "2026-06-22T10:15:00",
  "lines": [
    {
      "lineNo": 10000,
      "itemNo": "J31010101",
      "quantity": 12,
      "unitOfMeasure": "PC",
      "unitPrice": 116,
      "lineAmount": 1392,
      "location": "3535"
    }
  ]
}
```

For return orders, use `documentType = returnOrder`. You can pass `returnReasonCode` and `originalOrderNo` at header level or per line:

```json
{
  "company": "FCL",
  "documentType": "returnOrder",
  "externalDocumentNo": "BOT-RET-100045",
  "sellToCustomerNo": "101",
  "shipmentDate": "2026-06-22",
  "salespersonCode": "019",
  "shipToCode": "101",
  "returnReasonCode": "DAMAGED",
  "originalOrderNo": "BOT-100045",
  "lines": [
    {
      "lineNo": 10000,
      "itemNo": "J31010101",
      "quantity": 2,
      "unitOfMeasure": "PC"
    }
  ]
}
```

For credit notes, use `documentType = creditNote`. Credit-note lines require `unitPrice`, and the header should include `taxAppliedDocumentNo` so Business Central can create the Sales Credit Memo with the original fiscal invoice reference:

```json
{
  "company": "FCL",
  "documentType": "creditNote",
  "externalDocumentNo": "BOT-CN-100045",
  "sellToCustomerNo": "101",
  "shipmentDate": "2026-06-22",
  "salespersonCode": "019",
  "shipToCode": "101",
  "taxAppliedDocumentNo": "CU-INV-100045",
  "returnReasonCode": "DAMAGED",
  "lines": [
    {
      "lineNo": 10000,
      "itemNo": "J31010101",
      "quantity": 2,
      "unitOfMeasure": "PC",
      "unitPrice": 116
    }
  ]
}
```

Before `POST /api/imported-orders` writes anything, the API checks the selected company for the same `externalDocumentNo` in:

```text
Imported Orders
Imported SalesAL
Imported Return Orders
Imported Credit Notes AL
Sales Header
Sales Invoice Header
Sales Cr.Memo Header
```

If the external document number already exists, the API returns `409 Conflict` and does not import. If it is not found, the API waits for `IMPORT_DUPLICATE_RECHECK_DELAY_MS` and checks again before inserting. This protects the BC posting handover window where a document may briefly leave `Sales Header` before appearing in a posted table.

Configure the wait in `.env`:

```env
IMPORT_DUPLICATE_RECHECK_DELAY_MS=5000
```

Example conflict response:

```json
{
  "error": "External document number already exists in Business Central.",
  "details": {
    "company": "FCL",
    "externalDocumentNo": "BOT-100045",
    "matches": [
      {
        "sourceTable": "Sales Header",
        "count": 1,
        "documents": ["SO-100045"]
      }
    ]
  }
}
```

## Data Provider

The API contract is intentionally kept separate from the Business Central access method. The current deployment can read/write through direct SQL or Business Central API pages.

Use `POST /api/imported-orders` for the existing SQL-backed staging path.

Use `POST /api/bc-api/imported-orders` for the BC API-page staging path. It accepts the same payload as the SQL route and writes to these API pages:

```text
order       -> /api/fcl/bot/v1.0/companies({id})/importedOrders
invoice     -> /api/fcl/bot/v1.0/companies({id})/importedSalesAL
returnOrder -> /api/fcl/bot/v1.0/companies({id})/importedReturnOrders
creditNote  -> /api/fcl/bot/v1.0/companies({id})/importedCreditNotesAL
```

When `BC_ACCESS_MODE=both`, the API-page import still uses the SQL duplicate scan before posting so it can check staging, live Sales Header, posted Sales Invoice Header, and posted Sales Cr.Memo Header. When `BC_ACCESS_MODE=api`, the API-page import checks only the staging API pages unless additional BC API pages are exposed for live/posted sales documents.

Public integrations should rely only on the documented HTTP endpoints, request payloads, response payloads, company flags, status values, and error codes in this guide.
