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

For `GET` endpoints, pass the flag as a query parameter:

```http
GET /api/customers?company=FCL
GET /api/items?company=RMK
GET /api/imported-orders?company=CM&externalDocumentNo=BOT-100045
GET /api/status/BOT-100045?company=FLM
```

For `POST /api/imported-orders`, pass `company` in the JSON body. The same flag is also written to the Imported Orders `Company` field.

## Endpoints

```text
GET  /api/health
GET  /api/status
GET  /api/status/:externalDocumentNo
GET  /api/customers
GET  /api/items
GET  /api/imported-orders
POST /api/imported-orders
GET  /api/imported-orders/:externalDocumentNo
GET  /api/imported-orders/:externalDocumentNo/status
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

`GET /api/status/:externalDocumentNo` is the primary BOT document status check. It accepts the BOT external document number and returns the current BC status:

```json
{
  "externalDocumentNo": "BOT-100045",
  "orderStatus": "Released",
  "bcStage": "Sales Header",
  "sourceTable": "Sales Header",
  "documentNo": "SO-100045",
  "documentType": "Order",
  "sellToCustomerNo": "90000",
  "importedOrderState": "salesOrder",
  "statusCounts": {
    "Post": 2
  }
}
```

Lookup priority:

```text
1. Sales Invoice Header      -> orderStatus = Posted
2. Sales Header              -> orderStatus = Open/Released/Pending Approval/Pending Prepayment
3. Imported Orders           -> orderStatus = imported/processing/salesOrder/cancelled/error
```

`GET /api/imported-orders/:externalDocumentNo/status` checks a specific staged document:

```json
{
  "externalDocumentNo": "BOT-100045",
  "state": "imported",
  "lineCount": 2,
  "statusCounts": {
    "Order": 2
  },
  "salesDocuments": {
    "salesHeaders": [],
    "postedInvoices": []
  },
  "lines": [
    {
      "lineNo": 10000,
      "itemNo": "PDA001",
      "quantity": 12,
      "status": 0,
      "statusName": "Order",
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
- Once the Sales Order is posted, it leaves `Sales Header`.
- The API only returns `state = posted` when it finds a matching record in `Sales Invoice Header` by `External Document No.`.
- If a matching live Sales Order exists but no posted invoice exists yet, the API returns `state = salesOrder`.

## Customer Payload

`GET /api/customers` returns web customers with nested ship-to addresses:

```json
{
  "data": [
    {
      "customerNo": "90000",
      "name": "Web Customer Ltd",
      "customerPriceGroup": "WEB",
      "customerDiscGroup": "WEB",
      "paymentTermsCode": "COD",
      "salespersonCode": "019",
      "shipTo": [
        {
          "code": "NAIROBI",
          "name": "Nairobi Outlet"
        }
      ]
    }
  ]
}
```

## Imported Order Payload

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
GET /api/imported-orders?customerNo=90000&shipmentDate=2026-06-22
GET /api/imported-orders?salespersonCode=019&shipToCode=NAIROBI&status=Order
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
  "externalDocumentNo": "BOT-100045",
  "sellToCustomerNo": "90000",
  "shipmentDate": "2026-06-22",
  "salespersonCode": "019",
  "shipToCode": "NAIROBI",
  "shipToName": "Nairobi Outlet",
  "customerSpecification": "No onions",
  "company": "FCL",
  "externalOrderUrl": "https://bot.example.com/orders/BOT-100045",
  "lines": [
    {
      "lineNo": 10000,
      "itemNo": "PDA001",
      "quantity": 12,
      "unitOfMeasure": "KG",
      "productSpecification": "Vacuum packed"
    }
  ]
}
```

## SQL Table Resolution

The service auto-discovers Business Central SQL tables by company/name patterns such as:

```text
<Company>$Imported Orders
<Company>$Imported Orders$<app-id>
```

If auto-discovery finds the wrong table, set explicit overrides:

```env
SQL_TABLE_IMPORTED_ORDERS=FCL$Imported Orders$23dc970e-11e8-4d9b-8613-b7582aec86ba
SQL_TABLE_CUSTOMER=FCL$Customer
SQL_TABLE_ITEM=FCL$Item
SQL_TABLE_SHIP_TO_ADDRESS=FCL$Ship-to Address
SQL_TABLE_SALES_HEADER=FCL$Sales Header
SQL_TABLE_SALES_INVOICE_HEADER=FCL$Sales Invoice Header
```

Customer and item filters are configurable:

```env
CUSTOMERS_WHERE=[Web Customer] = 1 AND [Blocked] = 0
ITEMS_WHERE=[PDA Item] = 1 AND [Blocked] = 0
```
