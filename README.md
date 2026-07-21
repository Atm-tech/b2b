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
- `docs/user-product-flow-guide.md`: user-facing operational guide for full product flow

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
- `DATABASE_URL`
- `UPLOADS_DIR`
- `ALLOWED_ORIGINS`
- `REQUEST_BODY_LIMIT`
- `MAX_UPLOAD_BYTES`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_OBJECT_PREFIX` (optional, defaults to `proofs`)
- `VITE_API_BASE_URL`

## Deployment Notes

- This app now uses PostgreSQL, not SQLite.
- In production, point `DATABASE_URL` to your Render Postgres instance.
- In production, configure Cloudflare R2 for durable payment, receipt, delivery, and return proofs.
- The backend keeps serving proof files from `/uploads/...`, so existing records and frontend links remain compatible.
- Without all four required R2 credentials, proof storage falls back to `UPLOADS_DIR`.
- for Render backend use:

```bash
npm install && npm run build -w packages/domain && npm run build -w apps/api
```

start command:

```bash
npm run start -w apps/api
```

- recommended Render env:

```bash
DATABASE_URL=<render-postgres-connection-string>
UPLOADS_DIR=/var/data/uploads
ALLOWED_ORIGINS=https://your-frontend.example.com
NODE_ENV=production
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_ACCESS_KEY_ID=<r2-access-key-id>
R2_SECRET_ACCESS_KEY=<r2-secret-access-key>
R2_BUCKET_NAME=aapoorti-proofs
```

- frontend can be deployed on Render static hosting or Vercel
- set `VITE_API_BASE_URL` to the deployed backend URL
- a sample Render Blueprint is included in [render.yaml](/d:/AAPOORTI/Managment%20system/Sales%20managment/render.yaml)
- a sample Render env file is included in [.env.render.example](/d:/AAPOORTI/Managment%20system/Sales%20managment/.env.render.example)
- a sample Vercel env file is included in [.env.vercel.example](/d:/AAPOORTI/Managment%20system/Sales%20managment/.env.vercel.example)

### Render dashboard env

Set these on the Render backend service:

```bash
NODE_ENV=production
PORT=8080
DATABASE_URL=<render-postgres-connection-string>
UPLOADS_DIR=/var/data/uploads
ALLOWED_ORIGINS=https://your-frontend.vercel.app
REQUEST_BODY_LIMIT=2mb
MAX_UPLOAD_BYTES=8388608
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_ACCESS_KEY_ID=<r2-access-key-id>
R2_SECRET_ACCESS_KEY=<r2-secret-access-key>
R2_BUCKET_NAME=aapoorti-proofs
R2_OBJECT_PREFIX=proofs
```

### Cloudflare R2 proof storage

1. In Cloudflare, create a private R2 bucket named `aapoorti-proofs`.
2. Create an R2 API token with Object Read & Write permission scoped only to that bucket.
3. Add the five `R2_*` values above to the backend service environment.
4. Redeploy the backend and open `/health`; `proofStorage` should be `cloudflare-r2`.
5. Upload and open one test proof from each workflow before removing the Render persistent disk.

Do not enable the public `r2.dev` URL for this bucket. Existing files in `UPLOADS_DIR` remain readable during migration; new proof files go to R2 once the credentials are complete. Product CSV uploads remain temporary local files.

### Vercel dashboard env

Set this on the Vercel frontend project:

```bash
VITE_API_BASE_URL=https://your-api.onrender.com
```

The frontend already reads `VITE_API_BASE_URL` directly at build time. If it is not set, it falls back to:

- `http://localhost:8080` on localhost
- current browser origin for same-origin hosting

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

The running API uses PostgreSQL and initializes the schema and compatibility columns on startup.
