# Aapoorti B2B — Developer Takeover Guide

This file is the technical handover for the developer who will maintain the already deployed Aapoorti B2B Sales Management System. Read it before changing production. It covers the product flow, codebase, frontend, backend, database, storage, configuration, local startup, deployment, debugging, backup, recovery, testing and known risks.

> Never put production passwords, database URLs, R2 keys, session tokens or customer data in this file or Git. Transfer secrets through the client's password manager.

## 1. Takeover summary

The application is an internal B2B operations system covering:

- users, multiple roles and warehouse scope;
- warehouses/yards, products, suppliers and shops;
- grouped purchase orders and supplier payments;
- inbound pickup/delivery and warehouse receipt checks;
- inventory lots, available/reserved/blocked stock and probationary sales;
- catalogue-based grouped sales orders and customer collections;
- outbound dockets, consignments and delivery tasks;
- purchase/sales returns;
- operational ledgers and notes;
- goods warrants, Excel exports, invoices, PDFs and QR order status;
- payment, receipt, return and delivery proof storage.

The deployed product has three runtime dependencies:

1. Static React frontend.
2. Node/Express API.
3. PostgreSQL database.

Proof files are stored either on the API filesystem/persistent disk or in a private Cloudflare R2 bucket.

## 2. Handover details to complete

Fill this table during takeover. Do not enter passwords.

| Item | Client value |
|---|---|
| Production frontend URL | `____________________________` |
| Production API URL | `____________________________` |
| API health URL | `____________________________/health` |
| Hosting provider/project | `____________________________` |
| PostgreSQL provider/database | `____________________________` |
| Proof storage mode/bucket | `____________________________` |
| DNS/registrar owner | `____________________________` |
| Source repository URL | `____________________________` |
| Production branch | `____________________________` |
| Current release/tag/commit | `____________________________` |
| Monitoring/logging location | `____________________________` |
| Backup owner and schedule | `____________________________` |
| Client technical owner | `____________________________` |
| Emergency contact | `____________________________` |

## 3. Technology stack

| Layer | Stack |
|---|---|
| Frontend | React 19, TypeScript, Vite 7, Axios |
| Documents | jsPDF, QRCode, XLSX |
| Backend | Node.js, Express 4, TypeScript |
| Uploads | Multer |
| Database | PostgreSQL, `pg` connection pool |
| Object storage | Cloudflare R2 through AWS S3-compatible SDK |
| Monorepo | npm workspaces |
| Local database | PostgreSQL 16 Docker image |
| Deployment examples | Render, Vercel, Docker Compose |

## 4. Repository structure

```text
.
├─ apps/
│  ├─ api/
│  │  ├─ src/server.ts             # Express setup, routes, validation, role checks
│  │  ├─ src/db.ts                 # Database init, queries and business transactions
│  │  ├─ src/object-storage.ts     # Cloudflare R2 proof adapter
│  │  ├─ src/product-import.ts     # CSV/XLS/XLSX product parsing
│  │  ├─ src/import-workbook.ts    # Workbook import command
│  │  └─ src/clean-database.ts     # Destructive maintenance utility
│  └─ web/
│     ├─ src/App.tsx               # Application shell, state, API calls and screen routing
│     ├─ src/app/shared.tsx        # Shared configuration, reports, grouping, QR/status helpers
│     ├─ src/app/formOptions.tsx   # Shared select/option helpers
│     ├─ src/features/catalog/     # Catalogue order UI and catalogue calculations
│     ├─ src/features/purchases/   # Purchaser workspace, summary and PO editor
│     ├─ src/features/sales/       # Sales summary and SO editor
│     ├─ src/features/payments/    # Purchaser, Sales and Accounts payment screens
│     ├─ src/features/operations/  # Warehouse, dispatch and delivery screens
│     ├─ src/features/accounts/    # Overview, Accounts dashboard and ledger screens
│     ├─ src/features/admin/       # Returns, analysis, goods warrants, Excel and product admin
│     ├─ src/components/           # Reusable UI/navigation components
│     ├─ src/utils/excel.ts        # Excel generation
│     └─ src/styles.css            # Global/responsive styling
├─ packages/domain/src/index.ts    # Shared roles, statuses, types and weight inference
├─ postgres/init/001-schema.sql    # Base PostgreSQL schema
├─ postgres/init/002-indexes.sql   # Database indexes
├─ scripts/                        # Operational imports and documentation generator
├─ docs/                           # Product, user and client handover documents
├─ docker-compose.postgres.yml     # Local PostgreSQL
├─ render.yaml                     # Render deployment blueprint
├─ vercel.json                     # Vercel frontend configuration
├─ .env.example                    # Local configuration template
├─ package.json                    # Root workspace commands
└─ package-lock.json               # Locked npm dependency graph
```

`App.tsx` was split from a 14,000+ line monolith. Keep new feature logic in the relevant `src/features` module; do not start rebuilding the monolith.

## 5. Workspace packages

### `@aapoorti-b2b/domain`

Shared compile-time contract between web and API. It contains:

- roles;
- product, party, order, payment, receipt, stock, ledger and delivery types;
- allowed statuses and modes;
- application snapshot type;
- product-weight inference.

When a stored record shape changes, update the domain package, database mapping and both API/frontend consumers together.

### `@aapoorti-b2b/api`

Express API that:

- initializes the PostgreSQL schema;
- authenticates users and stores sessions;
- validates input;
- checks roles;
- executes transactional business workflows;
- returns a role/warehouse-filtered snapshot;
- stores and serves proofs.

### `@aapoorti-b2b/web`

React single-page application. It reads the API URL from `VITE_API_BASE_URL`, stores the session/workspace draft in browser `localStorage`, and refreshes the snapshot after successful mutations.

## 6. Prerequisites

Recommended:

- current supported Node.js LTS;
- npm included with Node;
- PostgreSQL 16 or Docker Desktop;
- Git;
- modern Chromium-based browser for full QR/camera behavior.

Check versions:

```powershell
node --version
npm.cmd --version
docker --version
docker compose version
git --version
```

On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

## 7. Environment variables

Copy the example only when a local `.env` does not already exist:

```powershell
Copy-Item .env.example .env
```

Local template:

```dotenv
NODE_ENV=development
PORT=8080

DATABASE_URL=postgresql://<user>:<password>@127.0.0.1:5432/aapoorti_b2b
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_DB=aapoorti_b2b
POSTGRES_USER=<local-user>
POSTGRES_PASSWORD=<local-password>

UPLOADS_DIR=uploads
ALLOWED_ORIGINS=http://localhost:5173
REQUEST_BODY_LIMIT=2mb
MAX_UPLOAD_BYTES=8388608

R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=aapoorti-proofs
R2_OBJECT_PREFIX=proofs

VITE_API_BASE_URL=http://localhost:8080
```

### Variable behavior

| Variable | Default/behavior |
|---|---|
| `NODE_ENV` | `development`; production enables HSTS and hides DB details from root response |
| `PORT` | API port, default `8080` |
| `DATABASE_URL` | Preferred full PostgreSQL connection; overrides individual PostgreSQL values |
| `POSTGRES_*` | Used when `DATABASE_URL` is absent |
| `PGSSLMODE=require` or `PGSSL=true` | Enables DB TLS; Render URL is auto-detected |
| `PGPOOL_MAX` | Default `10` |
| `PG_IDLE_TIMEOUT_MS` | Default `30000` |
| `UPLOADS_DIR` | Default `uploads` |
| `ALLOWED_ORIGINS` | Comma-separated exact CORS origins |
| `REQUEST_BODY_LIMIT` | JSON body limit, default `2mb` |
| `MAX_UPLOAD_BYTES` | Default `8388608` (8 MiB) |
| `R2_*` | All required R2 credentials must exist or storage falls back to local filesystem |
| `VITE_API_BASE_URL` | Frontend build-time API base URL |

`VITE_API_BASE_URL` is embedded during frontend build. Changing it requires a new frontend deployment.

## 8. First local startup

From the repository root:

```powershell
npm.cmd ci
npm.cmd run postgres:up
npm.cmd run dev
```

Default development URLs:

```text
Frontend: http://localhost:5173
API:      http://localhost:8080
Health:   http://localhost:8080/health
```

Verify:

```powershell
docker compose -f docker-compose.postgres.yml ps
Invoke-RestMethod http://localhost:8080/health
Start-Process http://localhost:5173
```

### Run services separately

Terminal 1:

```powershell
npm.cmd run dev -w apps/api
```

Terminal 2:

```powershell
npm.cmd run dev -w apps/web
```

### Stop local services

Stop API/web with `Ctrl+C`, then:

```powershell
npm.cmd run postgres:down
```

The Docker volume remains intact.

## 9. Commands reference

| Command | Purpose |
|---|---|
| `npm.cmd ci` | Install exact locked dependencies |
| `npm.cmd run dev` | Run API and web concurrently |
| `npm.cmd run build` | Build domain, API and web |
| `npm.cmd run build -w packages/domain` | Build shared domain |
| `npm.cmd run build -w apps/api` | Compile API |
| `npm.cmd run build -w apps/web` | Type-check and build frontend |
| `npm.cmd run start -w apps/api` | Start compiled API |
| `npm.cmd run postgres:up` | Start local PostgreSQL |
| `npm.cmd run postgres:down` | Stop local PostgreSQL |
| `npm.cmd run postgres:logs` | Follow PostgreSQL logs |
| `npm.cmd run import:workbook -w apps/api` | Run workbook import utility |
| `npm.cmd run db:clean -w apps/api` | Destructive DB cleanup; inspect and back up first |

Linux/macOS developers can replace `npm.cmd` with `npm`.

## 10. Build and production startup

Full build:

```powershell
npm.cmd run build
```

Build order:

1. `packages/domain`
2. `apps/api`
3. `apps/web`

Outputs:

```text
packages/domain/dist
apps/api/dist
apps/web/dist
```

Start the compiled API:

```powershell
$env:NODE_ENV = "production"
npm.cmd run start -w apps/api
```

The frontend output is static and requires SPA fallback/rewrite to `index.html`.

The current build passes. Vite reports a non-fatal warning because the main JavaScript bundle exceeds 500 kB; route-level lazy loading is a future optimization.

## 11. Database initialization

There is no separate migration command in the current version. API startup performs initialization:

1. Executes `postgres/init/001-schema.sql`.
2. Runs compatibility `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements.
3. Removes duplicate delivery dockets where necessary.
4. Executes `postgres/init/002-indexes.sql`.
5. Seeds default settings and development users.
6. Backfills product weights that can be inferred from product text.

The production DB user therefore currently needs DDL privileges. Long term, move startup DDL into versioned forward-only migrations.

### Connection precedence

1. `DATABASE_URL`
2. `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
3. Source defaults

Ensure Docker's `POSTGRES_*` values and the API connection values match.

## 12. Database tables

| Table | Purpose |
|---|---|
| `users` | Users, roles, warehouse scopes and credentials |
| `sessions` | Bearer session tokens |
| `warehouses` | Warehouses and yards |
| `products` | Product hierarchy, tax, weight, tolerance, slabs and metadata |
| `counterparties` | Suppliers and shops |
| `settings` | Payment-method and delivery-charge settings |
| `purchase_orders` | Purchase order lines grouped by `cart_id` |
| `sales_orders` | Sales order lines grouped by `cart_id` |
| `payments` | Purchase, sales and supplier advance payments |
| `receipt_checks` | GRC records and receipt/weight checks |
| `inventory_lots` | Available, reserved and blocked stock |
| `probationary_sales` | Sold quantity that exceeded current available stock |
| `ledger_entries` | Operational paid/pending summary by order |
| `purchase_returns` | Supplier return lines/groups |
| `sales_returns` | Customer return lines/groups |
| `delivery_tasks` | Inbound and outbound movement assignments |
| `delivery_dockets` | Sales packing/dispatch records |
| `delivery_consignments` | Groups of dockets |
| `goods_warrants` | Accounts voucher/warrant data |
| `note_records` | Operational, restricted and management notes |

Relationships are largely enforced in application transactions instead of comprehensive foreign keys. Be careful when manually editing data.

## 13. Important domain rules

### Purchase lifecycle

```text
Draft
→ Order Placed - Pending Delivery
→ Pickup Assigned / In Pickup
→ Order Delivered - Warehouse Check
→ Partially Received / Received
→ Closed
```

Additional states include Pending Payment, Ready for Dispatch, In Transit and Cancelled.

### Sales lifecycle

```text
Draft → Booked / Self Pickup → Ready for Dispatch
→ Pending Pickup → Out for Delivery → Delivered → Closed
```

### Payment verification

```text
Pending → Submitted → Verified
                    ↘ Rejected / Disputed → Resolved
```

### Delivery task

```text
Planned → Picked → Handed Over → Delivered
```

### Main calculations

- Expected weight = product default weight × quantity.
- Net receipt weight = actual/gross weight − container weight.
- Weight variance is checked against product kilogram and percentage tolerances.
- Tax mode supports NA, Exclusive and Inclusive.
- Sales line calculation includes rate, CD/TOD adjustments and GST.
- Configured delivery charge is applied once to a grouped delivery order.
- Ledger pending = goods value − accepted paid amount.
- Inventory is derived from lots, reservations, blocks, receipts and returns.

## 14. Roles and access

Defined roles:

- Admin
- Warehouse Manager
- Delivery Manager
- Purchaser
- Accounts
- Sales
- Collection Agent
- Data Analyst
- In Delivery
- Out Delivery
- Delivery

A user may have multiple roles. Frontend visibility is the union of assigned role views. Backend mutations still use explicit route-level role checks. Warehouse IDs further scope records in the snapshot.

Do not rely on hidden UI as authorization. Always add/check API authorization for a new action.

## 15. Authentication and browser state

Login returns:

- user;
- opaque session token;
- initial application snapshot.

Protected calls use:

```http
Authorization: Bearer <session-token>
```

Browser `localStorage` holds:

- current user;
- session token;
- active view;
- simple/full mode and sidebar state;
- delivery manager warehouse selection;
- selected in-progress workspace drafts.

Logout deletes the server session and clears local browser session state.

## 16. API map

Public/health:

```text
GET  /
GET  /health
POST /auth/login
POST /auth/logout
GET  /uploads/:category/:fileName
GET  /goods-warrants/logo
```

Authenticated read model:

```text
GET /snapshot
```

Master/configuration routes:

```text
POST   /users
POST   /warehouses
POST   /products
PATCH  /products/:sku
DELETE /products/:sku
POST   /products/bulk
POST   /products/bulk-upload
POST   /counterparties
PATCH  /counterparties/:id
POST   /settings
```

Purchase/sales:

```text
POST  /purchase-orders
POST  /purchase-orders/cart
PATCH /purchase-orders/:id
POST  /sales-orders
POST  /sales-orders/cart
PATCH /sales-orders/:id
POST  /sales-orders/reset-operational
POST  /purchase-returns
POST  /sales-returns
```

Payments/warrants:

```text
POST   /payments
PATCH  /payments/:id
POST   /payments/verify
POST   /payments/purchase-advance
DELETE /payments/purchase-advance
POST   /goods-warrants
POST   /goods-warrants/bulk
PUT    /goods-warrants/:id
DELETE /goods-warrants
```

Warehouse/delivery:

```text
POST  /receipt-checks
PATCH /receipt-checks/:id
POST  /delivery-tasks
PATCH /delivery-tasks/:id
POST  /delivery-tasks/merge
POST  /delivery-dockets
POST  /delivery-consignments
POST  /notes
```

Proof uploads:

```text
POST /payments/upload-proof
POST /delivery-tasks/upload-proof
POST /receipt-checks/upload-proof
POST /returns/upload-proof
```

Read `apps/api/src/server.ts` for the authoritative request fields and allowed roles. Business transactions are implemented in `apps/api/src/db.ts`.

## 17. Snapshot architecture

The frontend does not call separate GET endpoints for every table. `GET /snapshot` returns the role-filtered working dataset:

```text
metrics, settings, users, warehouses, products, counterparties,
purchaseOrders, salesOrders, returns, probationarySales, payments,
receiptChecks, inventoryLots, stockSummary, ledgerEntries,
deliveryTasks, deliveryDockets, deliveryConsignments,
goodsWarrants and notes
```

Most successful frontend mutations refresh this snapshot. When adding a record type:

1. Add/update the domain type.
2. Add schema/migration.
3. Add mapper/query in `db.ts`.
4. Include it in `getSnapshot` with correct role/warehouse filtering.
5. Add route validation/authorization.
6. Add frontend view/state.

## 18. Frontend architecture

### Application shell

`apps/web/src/App.tsx` owns:

- login/session bootstrapping;
- main snapshot state;
- shared POST/PATCH/DELETE/upload helpers;
- top-level draft state;
- role navigation and routing between feature views;
- global QR/status overlays.

### Feature modules

| Module | Responsibility |
|---|---|
| `features/catalog` | Catalogue browsing, cart and checkout, product grouping/weight labels |
| `features/purchases` | Purchaser new/edit flow and purchase summaries |
| `features/sales` | Sales summaries and SO editing |
| `features/payments` | Purchaser/Sales/Accounts payment workspaces and bank exports |
| `features/operations` | Warehouse receiving/dispatch, delivery manager and delivery jobs |
| `features/accounts` | Home/Accounts overview and ledger workspaces |
| `features/admin` | Returns, analyst views, product admin, goods warrants and Excel Maker |

### Shared frontend helpers

`app/shared.tsx` contains the legacy shared surface:

- API base/session keys and role-view configuration;
- formatting/date/currency functions;
- purchase/sales grouping and status helpers;
- invoice/PDF/WhatsApp/CSV exports;
- QR generation/scanning and order status;
- report exports;
- warehouse snapshot scoping and route helpers.

When touching this file, first consider moving a helper into a smaller domain-specific module.

## 19. UI/UX conventions

- Reuse `Panel`, `TwoCol`, `DataTable`, metric cards and badges from `components/ui.tsx`.
- Maintain responsive/mobile layouts in `styles.css`.
- Simple mode intentionally hides secondary views; delivery users are forced into a simpler view set.
- Grouped orders use public `cartId` when present; never show or link the wrong line-level ID.
- Pending badges should represent actionable queues, not total historical counts.
- Preserve status wording because it is used in filters, exports and business training.
- Test desktop and mobile before release.
- GST tax-invoice, QR and Excel output are part of the product—not optional visual extras.

## 20. Proof storage

Accepted proof MIME types:

- JPEG
- PNG
- WebP
- PDF

Categories:

```text
payment-proofs
delivery-proofs
receipt-proofs
return-proofs
```

Local layout:

```text
uploads/csv
uploads/payment-proofs
uploads/delivery-proofs
uploads/receipt-proofs
uploads/return-proofs
```

With complete R2 credentials, new proofs go to R2. The API first checks a same-named local file to support migration, then reads R2. Database rows contain filenames/URLs, not file bytes.

Product import files remain local temporary uploads even when R2 proof storage is enabled.

## 21. Local database inspection

Connect with `psql` without writing the password in shell history:

```powershell
$env:PGPASSWORD = "<local-password>"
psql -h 127.0.0.1 -p 5432 -U <user> -d aapoorti_b2b
Remove-Item Env:PGPASSWORD
```

Useful commands:

```sql
\conninfo
\dt
\d purchase_orders
\d sales_orders
\d payments
\d inventory_lots
```

Useful checks:

```sql
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM products;
SELECT COUNT(*) FROM purchase_orders;
SELECT COUNT(*) FROM sales_orders;
SELECT COUNT(*) FROM payments;
SELECT COUNT(*) FROM inventory_lots;

SELECT side, linked_order_id, party_name, goods_value,
       paid_amount, pending_amount, status
FROM ledger_entries
WHERE pending_amount > 0
ORDER BY created_at DESC;

SELECT grc_number, purchase_order_id, warehouse_id,
       expected_weight_kg, net_weight_kg, weight_variance_kg,
       partial_receipt, flagged
FROM receipt_checks
WHERE flagged = TRUE OR partial_receipt = TRUE
ORDER BY created_at DESC;
```

Do not update production rows manually without a backup, reviewed SQL and business approval.

## 22. Database backup and recovery

Compressed backup:

```powershell
$env:PGPASSWORD = "<database-password>"
pg_dump -h <host> -p <port> -U <user> -d <database> -F c -f aapoorti.dump
Remove-Item Env:PGPASSWORD
Get-FileHash .\aapoorti.dump -Algorithm SHA256
```

Restore into a separate test database:

```powershell
$env:PGPASSWORD = "<database-password>"
createdb -h <host> -p <port> -U <user> aapoorti_restore_test
pg_restore -h <host> -p <port> -U <user> -d aapoorti_restore_test --clean --if-exists .\aapoorti.dump
Remove-Item Env:PGPASSWORD
```

Also back up proof storage. A DB backup without its referenced proof objects is incomplete.

After restore:

1. Point a non-production API at the restored DB/storage.
2. Check health and login.
3. Compare table counts.
4. Inspect sample PO, SO, payment, receipt, stock, delivery and ledger chains.
5. Open proof files.

## 23. Existing deployment files

### Render

`render.yaml` defines:

- Node API;
- static web frontend;
- Render PostgreSQL;
- persistent upload disk;
- `/health` check;
- SPA rewrite.

API build:

```bash
npm install && npm run build -w packages/domain && npm run build -w apps/api
```

API start:

```bash
npm run start -w apps/api
```

Web build:

```bash
npm install && npm run build -w packages/domain && npm run build -w apps/web
```

Static publish path:

```text
apps/web/dist
```

### Vercel frontend

The root `vercel.json` builds the domain and web workspaces. Required production variable:

```dotenv
VITE_API_BASE_URL=https://<production-api>
```

### CORS

Use exact origins:

```dotenv
ALLOWED_ORIGINS=https://app.example.com,https://staging.example.com
```

Do not use `*` in production.

## 24. Deployment procedure for an already running app

Before deployment:

1. Confirm the production branch and current deployed commit.
2. Pull/export a fresh DB backup and verify proof-storage backup/retention.
3. Run `npm ci` and `npm run build` in a clean environment.
4. Test changed roles and workflows in staging.
5. Confirm environment-variable changes separately; do not commit them.
6. Confirm schema compatibility with the currently deployed API.

Recommended order:

1. Deploy backward-compatible database/API changes.
2. Check `/health` and logs.
3. Deploy frontend with correct `VITE_API_BASE_URL`.
4. Run smoke tests.
5. Monitor errors and business queues.

Rollback:

- Redeploy the previous accepted source/build if database compatibility permits.
- Do not restore an old database merely to roll back frontend/API code.
- A DB restore loses transactions after the recovery point; it requires client approval.

Record release commit, operator, time, environment changes and result.

## 25. Post-deployment smoke test

- [ ] `/health` returns OK and expected storage mode.
- [ ] Admin can login/logout.
- [ ] Navigation is correct for each changed role.
- [ ] Existing products/parties/orders load.
- [ ] Create test PO/cart and open its summary/QR/invoice.
- [ ] Record test receipt and confirm stock movement.
- [ ] Create test sales cart and payment.
- [ ] Create/update delivery docket/task and finish delivery.
- [ ] Ledger reflects payment state.
- [ ] Upload/open affected proof categories.
- [ ] PDF, print, QR and Excel output still work.
- [ ] Mobile view is usable.
- [ ] No new API/database errors appear in logs.

Use controlled test records or a staging environment. Do not pollute statutory production data.

## 26. Debugging guide

### API does not start

Check:

- `DATABASE_URL` or matching `POSTGRES_*` values;
- PostgreSQL health/network/TLS;
- DB DDL privileges;
- port conflict on 8080;
- API startup logs.

### Frontend cannot call API

Check:

- browser Network tab;
- built `VITE_API_BASE_URL`;
- exact `ALLOWED_ORIGINS` value;
- HTTPS/mixed-content errors;
- proxy forwarding of the `Authorization` header.

### Login/session failure

Check:

- user `active` state;
- `sessions` table;
- stale localStorage;
- Bearer token header;
- API/database time and logs.

### Wrong screen or missing data

Check:

- `roles_json` and primary role;
- simple/full mode;
- user warehouse IDs;
- snapshot role/warehouse filtering;
- route-level role list.

### Stock mismatch

Trace the same warehouse/SKU through:

1. purchase order;
2. receipt checks;
3. inventory lots;
4. reservations and blocked quantities;
5. sales orders;
6. returns;
7. probationary sales.

### Ledger mismatch

Check:

- payment `side`;
- linked public/group order ID;
- amount;
- verification status;
- rejected/disputed payments;
- order goods value.

### Proof upload failure

Check MIME type, size, disk permissions/capacity, R2 credentials, bucket policy, object prefix and `/health` storage mode.

### QR scan unavailable

Live decoding depends on browser `BarcodeDetector`, camera permission and secure context. Image scan, pasted link and external phone camera are fallbacks.

## 27. Import utilities

Product bulk upload supports CSV/XLS/XLSX through the Admin product screen/API.

Commands/scripts:

```powershell
npm.cmd run import:workbook -w apps/api
```

Additional scripts:

```text
scripts/import_atm2_products.ts
scripts/import_sales_history.py
```

Before running an import:

1. Read the script and expected headers.
2. Point at staging first.
3. Back up production.
4. Record input checksum and row count.
5. Reconcile inserted/updated/rejected rows.

## 28. Dangerous operations

Treat these as production-destructive:

```powershell
npm.cmd run db:clean -w apps/api
```

```text
POST /sales-orders/reset-operational
DELETE /payments/purchase-advance
DELETE /goods-warrants
DELETE /products/:sku
```

Before executing:

- verify environment and exact target;
- take a tested backup;
- obtain authorization;
- understand downstream order/ledger/stock/proof references;
- record operator and reason.

## 29. Security issues to understand immediately

These are known handover risks, not optional style improvements:

1. Passwords are currently stored in plain text and compared case-insensitively.
2. Seed/shared credentials exist in source initialization.
3. Proof download URLs are not protected by record-level authorization.
4. Session expiry, login throttling and complete account lifecycle controls are limited.
5. Notes visibility is not a complete record-level confidentiality mechanism.
6. Startup DDL is not a formal versioned migration system.
7. Destructive maintenance routes/utilities need stronger safeguards/audit.
8. The operational ledger is not a statutory double-entry accounting ledger.
9. The goods-warrant logo path is hard-coded to a Windows path in the API.
10. Automated test/CI coverage is limited.

Priority hardening:

- Argon2/bcrypt password hashing and forced credential rotation;
- user edit/deactivate/reset and immediate session revocation;
- session expiration and login rate limiting;
- authorized/signed proof retrieval;
- versioned migrations;
- immutable audit log;
- automated API and end-to-end tests;
- configurable/bundled goods-warrant logo;
- route-level code splitting and smaller frontend bundles.

## 30. Safe development workflow

For each change:

1. Identify affected domain records and statuses.
2. Update shared domain types first when shapes change.
3. Add a forward-compatible DB migration/schema change.
4. Implement business logic inside a DB transaction.
5. Validate input and add explicit API role checks.
6. Preserve snapshot filtering and warehouse scope.
7. Put frontend code in the correct feature module.
8. Test all affected roles, not only Admin.
9. Test grouped cart IDs versus line IDs.
10. Run full build and smoke tests.
11. Document deployment/configuration changes.

Minimum verification:

```powershell
npm.cmd run build
```

Do not manually edit generated `dist` files.

## 31. First-day takeover checklist

- [ ] Obtain repository access and identify production commit.
- [ ] Obtain client-owned hosting, DB, R2, DNS and monitoring access.
- [ ] Confirm no secrets are being sent in chat/email/source.
- [ ] Run a clean local install and build.
- [ ] Start local PostgreSQL, API and frontend.
- [ ] Read `server.ts`, `db.ts`, domain types and feature structure.
- [ ] Login with every role in a non-production environment.
- [ ] Walk one complete purchase-to-sale cycle.
- [ ] Review production health/logs without making changes.
- [ ] Verify backup schedule and perform a restore rehearsal.
- [ ] Record deployed URLs, branch, commit and service owners above.
- [ ] Review known security issues with the client.
- [ ] Agree release, rollback, incident and approval procedures.

## 32. Functional documents

Additional project documents:

- `docs/Aapoorti-Client-Source-Code-Handover-Manual.docx`
- `docs/aapoorti-complete-app-manual.html`
- `docs/user-product-flow-guide.md`
- `docs/b2b-product-blueprint.md`

This file is the developer's primary runbook. Update it whenever architecture, commands, infrastructure, schema, storage or deployment behavior changes.

## 33. Current verification status

At the time of this handover update:

- the frontend monolith was split into feature modules listed above;
- `App.tsx` is now the application shell instead of the feature implementation dump;
- the frontend TypeScript/Vite production build passes;
- Vite still reports the known large-chunk warning;
- production secrets and deployed URLs are intentionally not included.
