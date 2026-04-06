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
- `ALLOWED_ORIGINS`
- `REQUEST_BODY_LIMIT`
- `MAX_UPLOAD_BYTES`
- `VITE_API_BASE_URL`

## Deployment Notes

- SQLite runs from `apps/api/data/aapoorti-b2b-v2.sqlite`
- uploads are stored under `uploads/`
- backend serves uploaded payment and delivery proof files from `/uploads/...`
- for Render backend use:

```bash
npm install && npm run build -w packages/domain && npm run build -w apps/api
```

start command:

```bash
npm run start -w apps/api
```

- for Vercel frontend set `Root Directory` to `apps/web`
- set `VITE_API_BASE_URL` to the deployed backend URL
