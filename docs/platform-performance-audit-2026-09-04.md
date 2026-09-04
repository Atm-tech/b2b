# Platform performance audit — 2026-09-04

## Current production layout

- Frontend: Vercel (`b2b-api-theta.vercel.app`)
- API: Render web service `b2b`, Starter, one instance, Ohio
- Database: Render Postgres `aapoorti-db`, Basic 256 MB, 1 GB, Ohio
- Render disks, static sites, and Key Value instances: none

No duplicate or abandoned Render resources were found. The API and database are in the same region and use Render's private database connection.

## Measurements and decisions

- Vercel frontend: Lighthouse performance 99; LCP 1.7 s; TBT 0 ms; CLS 0.
- Vercel document TTFB from the audit location: median 117 ms, p95 135 ms.
- Render API health endpoint from the audit location: median 353 ms, p95 780 ms.
- Render API usage: CPU p95 about 0.005 cores against a 0.5-core limit; memory p95 about 161 MB against 512 MB.
- Render Postgres usage: CPU max about 0.012 cores; memory max about 132 MB against 256 MB; active connections p95 1.
- No API errors or 5xx responses were found in the inspected seven-day period.

Scaling either Render resource would add cost without addressing the measured bottleneck. The primary server-side inefficiency was snapshot generation: every read and mutation response loaded 19 complete database sections. Snapshot sections are now cached in-process and only sections affected by a successful SQL mutation are refreshed. This matches the current one-instance deployment.

The frontend's large PDF and Excel dependencies are already loaded on demand. Long-lived immutable caching is now configured for Vite's content-hashed `/assets/*` files.

## Applied changes

- Cache and selectively invalidate API snapshot sections.
- Log snapshot refreshes that take at least 100 ms.
- Add missing sort and join indexes for delivery, notes, counterparties, and probationary sales.
- Cache content-hashed Vercel assets for one year with `immutable`.
- Align `render.yaml` with production and remove the obsolete Render static site and disk declarations.
- Consolidate Vercel settings into the active `apps/web/vercel.json` and remove the ignored repository-root duplicate.
- Disable the unavailable local Whisper worker in production; supported browsers use their faster streaming speech recognizer.

## Ohio to Singapore migration

Render does not allow an existing service or database to change region. A Singapore move is therefore a blue/green migration, not a configuration edit. Do not change `render.yaml` to Singapore until the following cutover is complete.

1. Create a new Singapore Postgres database on the same supported PostgreSQL major version.
2. Export the Ohio database using its external URL:

   ```sh
   pg_dump --format=custom --no-owner --no-acl "$SOURCE_DATABASE_URL" --file=aapoorti.dump
   ```

3. Restore into the new Singapore database:

   ```sh
   pg_restore --clean --if-exists --no-owner --no-acl --dbname="$TARGET_DATABASE_URL" aapoorti.dump
   ```

4. Validate row counts, schema constraints, application login, order reads, and a reversible test write.
5. Create the Singapore API service with the existing environment variables and secrets, changing only `DATABASE_URL` to the new database's private URL.
6. Point Vercel's `VITE_API_BASE_URL` at the Singapore API, deploy, and run the end-to-end smoke test.
7. Keep Ohio intact during the rollback window. Remove the old service and database only after traffic and data validation succeed.

The migration requires access to the current database URL and production secrets. Those values are intentionally unavailable through the read-only audit connection, so creating paid duplicate resources before they can be populated and wired would be unsafe.
