# Aapoorti B2B Platform

Procurement and sales operating system for Aapoorti.

## Scope

This workspace starts the B2B web app for:

- supplier purchase intake
- quantity-based rate capture
- inventory receipt and variance control
- payment proof and ledger readiness
- warehouse handover and delivery workflows
- salesperson order booking and payment collection

## Structure

- `apps/web`: React + Vite operational dashboard
- `apps/api`: Express API with health and module endpoints
- `packages/domain`: shared process definitions and sample records
- `docs/b2b-product-blueprint.md`: translated business flow and module plan

## Run

```powershell
npm install
npm run dev
```

## Production

Backend:

```powershell
npm install
npm run build -w packages/domain
npm run build -w apps/api
npm run start -w apps/api
```

Frontend:

```powershell
npm install
npm run build -w packages/domain
npm run build -w apps/web
```

## Environment

Copy `.env.example` and set:

- `NODE_ENV`
- `PORT`
- `DATABASE_PATH`
- `UPLOADS_DIR`
- `ALLOWED_ORIGINS`
- `REQUEST_BODY_LIMIT`
- `MAX_UPLOAD_BYTES`
- `VITE_API_BASE_URL`

## Deployment Notes

- SQLite runs from `apps/api/data/aapoorti-b2b-v2.sqlite`
- in production set `DATABASE_PATH` to a persistent disk path
- in production set `UPLOADS_DIR` to a persistent disk path
- backend serves uploaded payment and delivery proof files from `/uploads/...`
- for Render backend use:

```bash
npm install && npm run build -w packages/domain && npm run build -w apps/api
```

start command:

```bash
npm run start -w apps/api
```

- recommended Render env for persistent local database:

```bash
DATABASE_PATH=/var/data/aapoorti-b2b.sqlite
UPLOADS_DIR=/var/data/uploads
ALLOWED_ORIGINS=https://your-frontend.example.com
NODE_ENV=production
```

- for Vercel frontend set `Root Directory` to `apps/web`
- set `VITE_API_BASE_URL` to the deployed backend URL

## Local Postgres

This repo now includes a local PostgreSQL server definition and schema mirror for the current app.

Start Postgres:

```powershell
npm run postgres:up
```

Stop Postgres:

```powershell
npm run postgres:down
```

View logs:

```powershell
npm run postgres:logs
```

Default local connection:

- host: `localhost`
- port: `5432`
- database: `aapoorti_b2b`
- user: `postgres`
- password: `postgres`

Schema files:

- [postgres/init/001-schema.sql](d:/AAPOORTI/Managment%20system/Sales%20managment/postgres/init/001-schema.sql)
- [postgres/init/002-indexes.sql](d:/AAPOORTI/Managment%20system/Sales%20managment/postgres/init/002-indexes.sql)

Important:

- the running API still uses SQLite today
- this Postgres setup is the local server and schema foundation for migration
- next step would be adding a Postgres-backed repository layer or a data migration script from SQLite to Postgres
