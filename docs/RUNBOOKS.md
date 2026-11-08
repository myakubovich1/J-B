# Operations runbooks

These procedures describe the shipped code. Steps marked **unrehearsed** have not been executed against hosted infrastructure; rehearse them in staging before relying on them. See [RELEASE_READINESS.md](RELEASE_READINESS.md) for what has been verified where.

## Topology

| Component | Runs on | State |
| --- | --- | --- |
| Web (Next.js, `Dockerfile` or Vercel) | Stateless host(s) | None; all state in Supabase |
| Worker (`Dockerfile.worker`, `compose.worker.yml`) | Dedicated trusted host with Docker | Per-job temp dirs only |
| LaTeX compiler (`workers/latex/Dockerfile`) | Short-lived containers started by the worker | None (no network, read-only, removed after each compile) |
| Supabase | Managed | Postgres, Auth, private Storage bucket, Vault |
| Stripe, OAuth providers, Browserbase | Managed | Provider-side |
| Alert receiver | `ALERT_WEBHOOK_URL` (Slack incoming webhook or equivalent) | — |

Each environment (staging, production) has its **own** Supabase project, Stripe account mode (test for staging), OAuth apps or redirect URIs, alert channel, and `DEPLOYMENT_ENVIRONMENT` value.

## Health and monitoring

- `GET /api/health` — liveness; 200 while the web process serves. Used by the web image `HEALTHCHECK`.
- `GET /api/ready` — readiness; 503 when the database is unreachable or production configuration is unsafe (local mode, fixture enabled, non-HTTPS `APP_URL`, live Stripe key outside production). `worker` and `emergency_stop` report `degraded` without failing. Send `Authorization: Bearer $HEALTH_CHECK_TOKEN` for check details.
- Point an external uptime monitor at `/api/ready` every minute and alert on non-200 **or** a `degraded` worker check lasting more than 5 minutes.
- Workers upsert `worker_heartbeats` every 15 s. A worker is stale after 90 s.
- External alerts (`src/lib/alerts.ts`) are sent for: `submission_unverified` (critical), `worker_failing` (5 consecutive iteration failures), `worker_watchdog_exit`, `emergency_stop_engaged`, `stripe_webhook_failed`, and first crossings of `cost_monthly_budget` / `cost_expensive_application`. Every alert is also logged as `operational_alert`; delivery failures log `alert_delivery_failed`. Route those log events to the same channel as a fallback.
- Verify the signature: `HMAC_SHA256(ALERT_WEBHOOK_SECRET, "<X-Waypoint-Timestamp>.<raw body>")` equals `X-Waypoint-Signature` without the `sha256=` prefix; reject timestamps older than 5 minutes.

## Deployment (staging first, then production) — unrehearsed on hosted infrastructure

Preconditions: CI green on the exact commit (`typecheck`, `npm test` with `RUN_LATEX_TESTS=1 RUN_DOCKER_TESTS=1`, `test:e2e:local`, `build`, `npm audit`), release gate register reviewed, a rollback target recorded (previous web deployment ID, previous worker image tag, latest migration applied).

1. **Announce** the window in the operator channel. For production, engage the emergency stop on the worker (`GLOBAL_EMERGENCY_STOP=true`, restart) if the release changes submission, browser, or billing code.
2. **Back up**: confirm the latest Supabase backup is recent (or take one), and snapshot the Storage bucket (see Backup).
3. **Migrate** (Supabase CLI, from the release commit):
   ```sh
   supabase link --project-ref <ref>        # confirm the ref is the intended environment
   supabase migration list                  # compare local vs remote
   supabase db push --dry-run               # review every statement
   supabase db push
   ```
   Migrations must be additive/backward compatible with the currently deployed code (expand → deploy → contract in a later release). Both current migrations are additive.
4. **Build the compiler image** on the worker host and run the sandbox suite there:
   ```sh
   docker build -f workers/latex/Dockerfile -t career-latex:<git-sha> .
   RUN_DOCKER_TESTS=1 LATEX_DOCKER_IMAGE=career-latex:<git-sha> npx vitest run tests/latex-sandbox.test.ts
   ```
   Set `LATEX_DOCKER_IMAGE=career-latex:<git-sha>` for the worker. Never deploy an image whose sandbox suite has not passed on that host's kernel and Docker version.
5. **Deploy the worker** (`docker compose -f compose.worker.yml up -d --build worker`) with `APP_VERSION=<git-sha>`. Confirm a fresh heartbeat in `/api/ready` details.
6. **Deploy the web app** (Vercel promotion or new image) with `APP_VERSION=<git-sha>`.
7. **Smoke test**: `/api/ready` is `ok`; sign up a staging test account; save a profile; generate a resume (worker compile in Docker); for staging only, run a non-submitting ATS diagnostic; open `/admin` as an operator; then delete the test account from Settings.
8. **Release the stop** (if engaged) and watch alerts, queue depth, and failure categories in `/admin` for 30 minutes.

## Rollback

- **Web**: promote the previous Vercel deployment (or redeploy the previous image tag). Stateless; immediate.
- **Worker**: engage the emergency stop, redeploy the previous image tag, release the stop. Runs leased by the old worker expire and are reclaimed; a lease that expired after the submission latch becomes `submission_unverified` and is never retried automatically.
- **Database**: migrations are forward-only. Prefer a forward fix. If a migration itself must be reverted, apply an explicit reviewed down migration. For `20261107230000_operations.sql` the inverse is:
  ```sql
  drop function if exists public.prune_operational_records(integer);
  drop table if exists public.worker_heartbeats;
  ```
  Code from this release tolerates neither object being present only in the sense that heartbeats/retention log errors; roll the code back first.
- **Data corruption**: restore into a *new* project (point-in-time if available), verify, then repoint. Never restore over the live project without a verified copy.

## Incident response

Severity: **SEV1** possible unauthorized or duplicate employer submission, cross-tenant data exposure, credential leak; **SEV2** workers down, billing entitlements wrong, provider outage blocking core flows; **SEV3** degraded performance or a single-user failure.

1. **Stop side effects first** (SEV1/SEV2 involving submissions or cost): set `GLOBAL_EMERGENCY_STOP=true` on worker *and* web, restart both. A stop prevents new side effects; it cannot recall a submission already sent.
2. **Assess** with `/admin` (failure categories, queue, `submission_unverified` count) and structured logs (`worker_*`, `operational_alert`, `account_deleted`, `retention_*`). Logs contain no customer content by design; correlate with hashed customer references.
3. **Uncertain submission** (`submission_unverified`): do not retry. Check the employer portal/receipt and the user's confirmation email; record the outcome on the application (`submitted` with evidence, or `failed`). Tell the user exactly what is known.
4. **Credential compromise**: rotate `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`, OAuth client secrets, `BROWSERBASE_API_KEY`, `ALERT_WEBHOOK_SECRET`, `HEALTH_CHECK_TOKEN`; force reconnection of affected integrations (disconnect revokes Google/GitHub grants); for local mode rotate `.secrets.key` only together with re-encrypting or discarding stored secrets.
5. **Stripe webhooks failing**: entitlements lag but Stripe retries for up to 3 days. Fix the cause; failed events are reclaimable (`webhook_events.status='failed'`). Replay from the Stripe dashboard if needed — processing is idempotent and reconciles current subscription state.
6. **Worker watchdog exits / crash loops**: the supervisor restarts the process. Check for runaway browser sessions or compiles; the compiler is killed at `LATEX_TIMEOUT_MS`.
7. **Close out**: written timeline, customer impact, root cause, regression test, and notification obligations (legal decision — see owner decisions in RELEASE_READINESS.md).

## Backup and restore

**Supabase (unrehearsed)** — Database backups depend on the Supabase plan (daily backups; point-in-time recovery is an add-on): choose and document the RPO/RTO. Database backups do **not** include Storage object bytes: schedule a separate copy of the `career-artifacts` bucket (e.g. S3-compatible sync to an encrypted, access-restricted location with the same retention as the database). Vault secrets are restored with the database; if a restore is to a different project, integrations must be reconnected.

Restore rehearsal (quarterly and before launch):
1. Restore the latest backup into a new disposable project; copy the Storage snapshot into its bucket.
2. Apply any migrations newer than the backup.
3. Point a staging web/worker at it. Run `RUN_SUPABASE_INTEGRATION=true npm test -- tests/supabase.integration.test.ts`.
4. Verify: row counts per table versus source; two sample tenants can read only their own records; an artifact download works; an integration secret lookup by its owner succeeds and by another user fails.
5. Record duration (RTO) and data loss window (RPO) in this file.

**Local mode** (single-host development) — verified in this repository's rehearsal:
1. Stop the web and worker processes (or at least the worker) so SQLite is quiescent.
2. Copy the entire `DATA_DIR` (`career.db`, `-wal`/`-shm` if present, `artifacts/`, `secrets/`, and `.secrets.key`). Without `.secrets.key` the encrypted integration secrets are unrecoverable.
3. Restore by copying the directory to a new location with mode `0700`, set `DATA_DIR`, start, and sign in.

## Retention

The worker runs `runRetention()` every `RETENTION_INTERVAL_HOURS` (default 6, `0` disables): it deletes private artifacts that no record references and that are older than 24 h (left by failed writes), expired sessions and rate-limit windows, processed webhook claims older than 90 days, and heartbeats older than 7 days. Customer records are deleted only by account deletion. Time-based expiry of customer data (e.g. evidence screenshots after N days) is **not** implemented and needs an owner policy decision.

## Account deletion support

Customers delete their own account under Settings → Your data and account. Deletion refuses while a Stripe subscription can still charge (`active`, `trialing`, `past_due`, `unpaid`) or a worker step holds a live lease; the customer cancels or waits, then retries. Deletion revokes Google/GitHub grants (Microsoft consent must be removed by the user), removes Storage objects, and deletes the Supabase Auth user, which cascades through every tenant table and purges Vault secrets. Stripe customer and invoice records remain in Stripe. Logs record `account_deleted` with a pseudonymous reference only.
