# Deployment

The web app and the durable worker are separate processes. Browser automation and LaTeX compilation must run on dedicated worker infrastructure. Do not move those jobs into a Vercel request handler.

## Local development

Use Node.js 24 or newer. Install the locked dependencies with `npm ci`, copy `.env.example` to `.env.local`, set `APP_MODE=local`, and run `npm run dev` and `npm run worker` in separate terminals. Local accounts use salted scrypt password hashes and opaque, hashed sessions. Each person signs up; there are no seeded users. SQLite, artifacts, and encrypted integration credentials persist in `DATA_DIR` (default `.data/`). Keep this directory private, outside any public/static directory, and preserve `.secrets.key` when backing it up. Local mode is intended for a single development host.

The local test employer is a deliberate fixture, not a live employer integration. Enable it only in development with `ENABLE_TEST_EMPLOYER=true`. No employer submissions are made by automated tests.

## Supabase

1. Create or select a Supabase project under your account. This repository does not provision paid infrastructure automatically.
2. Install the Supabase CLI, inspect `supabase --help`, link the intended project, and apply the migration in `supabase/migrations`. Review the target before pushing. A local stack can use `supabase start` followed by `supabase db reset`; resetting deletes the local database.
3. Set `APP_MODE=supabase`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY` on the web and worker hosts. Never prefix the service key with `NEXT_PUBLIC_`.
4. The migration creates all required tables, tenant RLS, owner indexes, private artifact bucket, durable queue RPCs, rate limiting, billing idempotency tables, and Supabase Vault secret wrappers. Runtime entities store their validated TypeScript contracts in a JSONB `data` column; tenant identity is constrained independently in SQL. Transactional triggers maintain the education, experience, project, skill, achievement, career-track, preference, resume-configuration, and job inventory projections.
5. Enable email confirmation in Supabase Auth and configure your transactional SMTP provider. Set the production Site URL and allow `${APP_URL}/api/auth/callback`. The sign-up flow remains pending until email confirmation when enabled.
6. Run `RUN_SUPABASE_INTEGRATION=true npm test -- tests/supabase.integration.test.ts` against a disposable project after setting the variables above. It creates and removes two temporary users and checks persisted data, tenant RLS, and forbidden subscription writes.
7. Run Supabase database advisors and resolve findings before beta access.

The Supabase migration and credentials require validation against your configured project. Docker was unavailable during the initial implementation, so the full Supabase stack was not tested on this host.

## Vercel web application

Use the Next.js preset, Node.js 24, `npm ci`, and `npm run build`. Set `APP_URL` to the canonical HTTPS URL. Set `APP_MODE=supabase`; production fails closed when the mode is not specified. Public environment variables must match the target project. The web process stores state in Supabase and only queues durable work. Configure previews with their own Supabase project and Stripe test keys.

Deploy through the Git integration or a reviewed prebuilt CI workflow. Apply backward-compatible database migrations before promotion. Health-check the sign-in page, sign up a test account, create a profile, produce a resume on the worker, and inspect the audit trail before admitting beta users.

## Worker

Run `npm run worker` on a long-lived container or VM with the same Supabase project and server environment. It claims jobs atomically and leases each run for ten minutes by default. `WORKER_CONCURRENCY` controls simultaneous leases; `WORKER_LEASE_SECONDS` can be adjusted within the supported queue bounds. Use a supervisor that restarts a crashed process. Failed or uncertain submissions retain the application latch and are never blindly retried.

Build the isolated LaTeX image according to `docs/RESUMES.md`. The compiler container must have no network, a non-root UID, a read-only root filesystem, restricted mounted inputs, resource/time limits, and no application credentials. Browserbase credentials, when configured, belong only on the worker host. Egress must block private IP ranges and cloud metadata endpoints while allowing the chosen ATS providers. Do not give the public web container a Docker socket.

`Dockerfile` builds the web process with Next standalone output. `Dockerfile.worker` supplies Node, Chromium, Poppler, and the Docker client for a dedicated trusted worker host. `compose.worker.yml` is an optional Linux-host recipe, not a managed remote compiler. Before using it, create `.env.production` with Supabase/worker credentials, set `COMPILE_ROOT` to an absolute private directory owned by worker UID 1000, and set `DOCKER_GID` to the host socket group. The same absolute compile path is mounted inside the worker and on the host, so the host daemon can bind only the per-job directory into its compiler container. Build the compiler image before starting the worker:

```sh
docker compose -f compose.worker.yml --profile tools build compiler-image
docker compose -f compose.worker.yml up -d --build worker
```

Docker socket access is root-equivalent for the trusted worker process. Isolate this host and never add that mount to the public web service. The untrusted compiler receives neither the socket nor secrets; it runs as a non-root UID matching the worker's temporary-directory owner, with private directory permissions and the restrictions above. An explicitly named compiler container is force-removed after timeout as well as normal completion. This host/container recipe is supplied for deployment review but was not executed here because the Docker daemon was unavailable.

Document extraction is also queued to the worker. The Vercel web process accepts a bounded private upload and persists a source/run, rather than relying on system Poppler binaries in a serverless request. Review completed extracted text through Career Profile → Saved sources.

## Stripe

Create recurring prices for Pro and Autonomous in Stripe, then set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`, and `STRIPE_AUTONOMOUS_PRICE_ID`. Prices are hypotheses controlled by the configured Stripe price objects. Set monthly submission quotas with `PLAN_FREE_LIMIT`, `PLAN_PRO_LIMIT`, and `PLAN_AUTONOMOUS_LIMIT` (defaults 5, 100, and 300).

Register `${APP_URL}/api/billing/webhook` for `checkout.session.completed` and `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`. Configure the customer portal in Stripe. Webhooks validate the signature against the raw request, claim the event idempotently, and reconcile against the current Stripe subscription to tolerate out-of-order events. Checkout redirects grant no entitlement by themselves. Only active or trialing subscriptions within their valid period unlock paid plans. For local testing, forward Stripe CLI test events to the webhook and use test price IDs.

The product reserves one quota slot immediately before a submission and consumes it only after a verified receipt. Internal retries do not create additional verified submissions. A safe failure releases its reservation; an uncertain submit retains its reservation pending reconciliation. Quota windows currently use UTC calendar months, independently of a subscription's billing date.

## OAuth and inbox access

Register the GitHub, Google, and Microsoft OAuth applications with the precise callback URLs documented by their routes. Keep client secrets server-only. OAuth tokens are stored through `src/lib/secrets.ts`: AES-GCM files locally and Supabase Vault in deployment. Integration rows contain only secret references. Obtain the required provider approvals before enabling restricted inbox scopes for real customers. User-assisted code/login handoff remains necessary for unsupported login flows, MFA, CAPTCHA, or provider restrictions.

## Operations and recovery

Grant operator metrics access by setting `ADMIN_USER_IDS` to an explicit comma-separated list of authenticated user UUIDs. No user is an operator by default, and email addresses or editable profile metadata do not grant access. The standalone `/admin` view and `/api/admin` endpoint enforce the allowlist independently. They return aggregate counts and hashed customer references, excluding contact details, answers, document content, and payment identifiers.

Metrics use the current UTC calendar month; active users count distinct profile, run, or usage activity within the last 30 days. Nominal monthly recurring revenue uses `PLAN_PRO_MONTHLY_USD=39` and `PLAN_AUTONOMOUS_MONTHLY_USD=199` by default and excludes trials, taxes, discounts, proration, and payment failures. Set these nominal prices to match the configured Stripe plans; they do not replace Stripe price IDs or invoice reconciliation. Runtime is recorded elapsed time and may include approval pauses.

Configure `MODEL_INPUT_USD_PER_MILLION`, `MODEL_OUTPUT_USD_PER_MILLION`, and `BROWSER_USD_PER_MINUTE` for useful execution cost estimates. The metrics view flags incomplete pricing rather than treating unpriced model/browser operations as known free usage. `GLOBAL_EMERGENCY_STOP=true` (or the supported `EMERGENCY_STOP=true` alias) pauses new actions; update it on both web and worker hosts and restart processes as required by the deployment platform. The operator view is read-only and does not edit environment configuration.

Back up Postgres and private storage, enable provider audit logging, and configure worker process alerts. Check queue depth, expired leases, failure categories, token usage, and verified submissions in the admin view. Set the global stop before investigating anomalous submissions or costs. A stop prevents new side effects; a submission already sent to a portal cannot be undone automatically.

Restore credentials from the managed vault, never from application logs or browser screenshots. Rotate integration tokens and service keys after a suspected incident. Verify both tenants and secret lookup ownership after restoring backups. Run the local unit tests and fixture E2E flow on each change; run the gated Supabase/provider diagnostics in a disposable staging environment before release.
