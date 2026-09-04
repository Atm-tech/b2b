# B CONNECT

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

## Use a tablet as the frontend

The laptop runs both development servers and keeps PostgreSQL, uploads, and all
backend processing local. The tablet only opens the web frontend.

1. Connect the laptop and tablet to the same Wi-Fi network.
2. On the laptop, run `npm run dev:lan`.
3. Vite prints a `Network` address. Open that address on the tablet, for example
   `http://192.168.1.20:5173`.
4. Keep the terminal running while using the tablet.

The frontend automatically calls port `8080` on the same laptop address. Windows
may ask for firewall access the first time; allow Node.js on private networks.

## Install as an app

The web workspace is an installable **B CONNECT** PWA, matching the Aapoorti E-Franchise app shell. After deploying it over HTTPS, open it in Chrome or Edge and use the in-app **Install App** button. The installed app launches in its own window and caches the application shell for reliable loading; live operational data still requires the API connection.

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
- The assistant uses the bundled offline language dataset by default and consumes no AI tokens.
- To explicitly enable hosted interpretation, set both `ASSISTANT_USE_OPENAI=true` and `OPENAI_API_KEY` (optional).
- Local voice transcription uses multilingual Faster-Whisper and consumes no API tokens. Run `npm run speech:setup` once, then `npm run speech:warmup` to download/cache the configured model. Development defaults to the CPU/int8 `small` model; configure it with `LOCAL_WHISPER_MODEL`, `LOCAL_WHISPER_THREADS`, and `LOCAL_WHISPER_TIMEOUT_MS`.
- `OPENAI_ASSISTANT_MODEL` (optional; defaults to `gpt-4o-mini`)

The app-wide assistant remains usable without an OpenAI key through its deterministic local parser. Add the key only to the backend environment, never to a `VITE_*` frontend variable.

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

## WhatsApp wholesale ordering

The staff application now includes **WhatsApp Wholesale** for Admin and Sales users. It supports:

- retailer phone-number, salesperson, warehouse and opt-in mapping
- retailer-specific rates, minimum quantities, CD/TOD and validity windows
- selected-retailer special offers
- Meta Commerce Manager scheduled catalogue feed
- signed and idempotent Meta webhooks
- catalogue-cart and typed-message order drafts
- salesperson stock/rate review followed by retailer confirmation
- automatic Sales Order creation and invoice-summary messaging
- inbound/outbound message audit history

With Meta credentials blank, outbound messages are recorded in safe **Simulation** mode. This allows staff workflows and database records to be tested without contacting retailers.

### Meta setup

1. Create and verify a Meta Business Portfolio and WhatsApp Business Account.
2. Create a Meta developer Business app and add the WhatsApp product.
3. Create a permanent system-user access token with WhatsApp messaging and management permissions.
4. Add the `WHATSAPP_*` values documented in `.env.render.example` to the Render service.
5. In Meta WhatsApp configuration, set the callback URL to:

   ```text
   https://b2b-v8kb.onrender.com/whatsapp/webhook
   ```

6. Enter the same secret value in Meta and `WHATSAPP_VERIFY_TOKEN`, then subscribe to `messages`.
7. In Commerce Manager, create a scheduled data feed using the feed URL displayed in the staff WhatsApp Wholesale screen.
8. Keep the product catalogue's retailer ID equal to the ERP SKU.
9. Create an approved utility/marketing offer template with three body variables: retailer name, offer summary and expiry. Store its name in `WHATSAPP_OFFER_TEMPLATE`.

The server rejects unsigned production webhooks when `WHATSAPP_APP_SECRET` is missing or incorrect. Never put Meta secrets in Vercel or frontend code.
