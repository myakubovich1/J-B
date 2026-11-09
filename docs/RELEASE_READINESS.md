# Release gate register

Last updated: 2026-11-09 (UTC). Branch `main` of `~/Projects/jasteriskb` (the J*B rebrand `6d230de` merged into the 2026-11-08 release work). Owner of every open item: the product owner unless stated.

**Status vocabulary.** *Implemented* — code exists, not independently verified. *Locally verified* — executed and passing on the development host (macOS, Node 24.22, Docker Desktop 28.4, local SQLite or embedded PostgreSQL); never hosted. *Staging verified* / *Production verified* — executed against that hosted environment. *Blocked* — cannot be verified without an external dependency named in the row. *Excluded* — deliberately outside the first supported release.

**Summary.** No gate is staging- or production-verified: no staging environment, credentials, or provider accounts were available. Every gate that could run locally has run. Six release-blocking defects and four lesser defects were found and fixed in this pass (blocking: G-14, G-18, G-33a, G-33b, G-33c, G-28b; lesser: G-10, G-11, G-48, alert coverage in G-20). Each fix has a regression test, and the tests for the blocking defects were confirmed to fail on the old code where practical.

## Evidence index

| Run | Command | Result |
| --- | --- | --- |
| Baseline reproduction (before changes) | `RUN_LATEX_TESTS=1 npx vitest run` | 141 passed, 1 failed, 1 skipped. The failure was a cold Tectonic bundle cache fetching packages over the network past the 45 s deadline; re-run warm: 15/15. Environmental, not a code defect; production uses the pre-warmed Docker image with `--only-cached`. |
| Baseline E2E | `npm run test:e2e:local` | 8 passed (2.4 min) — matches the recorded baseline |
| Baseline typecheck / audit | `npm run typecheck`; `npm audit --audit-level=high` | pass; 0 vulnerabilities |
| Final unit/integration | `RUN_LATEX_TESTS=1 RUN_DOCKER_TESTS=1 npx vitest run` | 181 passed, 1 skipped (live Supabase, gated) across 23 files |
| Final E2E | `npm run test:e2e:local` | 10 passed (8 baseline + account lifecycle + health) |
| Final build / audit / format | `npm run build`; `npm audit --audit-level=high`; `prettier --check` | build pass; 0 vulnerabilities; all files formatted except `src/app/globals.css`, which was already unformatted in the recovered baseline |
| Docker sandbox | `RUN_DOCKER_TESTS=1 npx vitest run tests/latex-sandbox.test.ts` | 22 passed against image `career-latex:local` built from `workers/latex/Dockerfile` |
| Post-merge (J*B rebrand into release work, 2026-11-09) | `RUN_LATEX_TESTS=1 RUN_DOCKER_TESTS=1 npx vitest run`; `npm run test:e2e:local`; `npm run build`; `prettier --check` | 182 passed, 1 skipped; E2E 10 passed; build pass; all files formatted (`globals.css` included); 0 vulnerabilities |
| Load rehearsal | `scripts/load-test.mjs` (see G-49) | 8 users: 8/8 in 68 s; 16 users: 16/16 in 142 s; 0 failures after fixes |
| Crash recovery | scripted SIGKILL of the worker (see G-18) | Kill during preparation: reclaimed after 30 s lease, submitted once, billed once. Kill after submission latch: `submission_unverified`, not retried, not billed, reservation held, signed critical alert delivered to a local webhook receiver |

## Foundation

| ID | Requirement | Current implementation | Defect / missing work | Acceptance criteria | Verification | Result | Status | Remaining dependency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G-01 | Reproducible baseline | Canonical source in the iCloud `J*B` folder had uncommitted Nov 4 work on top of `c03976e` and evicted (dataless) files that stall shell reads | Recovered into `~/Projects/jasteriskb` (commit `ddf4d4e`) with copy-on-write identical locked deps; on 2026-11-09 the rebrand and release branches were merged into `main`, the single authoritative branch | Same lockfile; baseline numbers reproduced or discrepancies explained | Evidence index above | Reproduced; one environmental discrepancy explained | Locally verified | — (iCloud folder is a mirror of `main`; see PROGRESS) |
| G-02 | Migrations apply cleanly | Two forward-only migrations | Test applied only the first file; now applies all in order | All migrations apply on PostgreSQL | `tests/postgres.test.ts` (PGlite) | 6/6 | Locally verified (core SQL only; Vault/Auth/Storage are stubs) | Disposable Supabase project; `supabase db push --dry-run` then push |
| G-03 | Tenant isolation & RLS | Owner-filtered store; RLS select-own policies; privileged mutations service-only; composite FKs | — | Cross-tenant reads return nothing; client roles cannot mutate or call privileged RPCs | PGlite RLS tests; E2E tenant-boundary tests; store tests | pass | Locally verified | Hosted: `RUN_SUPABASE_INTEGRATION=true` test + database advisors on staging |
| G-04 | Supabase Auth (signup, confirmation, callback, session refresh) | Implemented via `@supabase/ssr` | — | Confirmation link signs in; sessions refresh via proxy | Staging smoke test | not run | Blocked | Supabase project + SMTP provider |
| G-05 | Private Storage | Owner-prefixed keys; service-role writes; read policy by folder | — | Users cannot read other prefixes; downloads authorized server-side | Local filesystem path tested; hosted not | partial | Locally verified (local backend) | Staging project |
| G-06 | Vault secrets | Service-only wrappers, owner-bound lookup, purge trigger | PGlite cannot load Vault | Owner lookup succeeds, other owner fails, delete purges | Supabase integration test | not run | Blocked | Staging project |
| G-07 | Server-side authorization on sensitive operations | Every route calls `requireUser`/`currentUser`, admin allowlist, signed webhook, fixture disabled outside local dev | Audit found no unauthenticated sensitive route | Each sensitive route rejects anonymous and cross-origin requests | Route audit; E2E 401/403/cross-origin cases; new routes covered by `tests/operations.test.ts` and `e2e/account.spec.ts` | pass | Locally verified | — |
| G-08 | OAuth state + PKCE | One-time state bound to user and provider, S256 challenge | — | Wrong user/state rejected; state consumed once | `tests/oauth.test.ts` with provider HTTP fixtures | pass | Locally verified | Live provider apps for staging |
| G-09 | Token refresh | Refresh before expiry; rotated refresh tokens kept | No live test | Expired access token refreshes; revoked refresh token asks to reconnect | Live provider test | not run | Implemented | Google/Microsoft test apps + test users |
| G-10 | Disconnect / revocation | **Was:** deleted only the local secret; the provider grant (incl. refresh token) stayed valid. GitHub private access had no disconnect control | Added Google `/revoke` and GitHub grant deletion; Microsoft reported as unsupported with manual instructions; local credential always destroyed; GitHub disconnect button | Disconnect revokes at provider when supported and reports the result | `tests/oauth.test.ts` (fixtures, including provider outage) | pass | Locally verified | Live provider confirmation on staging |
| G-11 | Scope enforcement | **Was:** stored whatever scopes were granted | Grants missing a requested scope are revoked and rejected | Under-scoped consent cannot be saved | `tests/oauth.test.ts` | pass | Locally verified | Google restricted-scope verification for `gmail.readonly` (owner) |
| G-12 | Stripe Checkout & portal | Checkout with metadata; existing subscribers routed to portal | — | Test-mode checkout grants plan via webhook only | Mocked unit tests | partial | Implemented | Stripe test account, prices, webhook endpoint, CLI forwarding |
| G-13 | Webhook signature & idempotency | Raw-body signature; persistent claim; retry of failed/stale claims | Added alert on processing failure | Tampered → 400; duplicate → no reprocessing | `tests/billing.test.ts` | pass | Locally verified | Staging replay with Stripe CLI |
| G-14 | Out-of-order delivery & replaced subscriptions | **Defect:** a late event for a replaced subscription (e.g. old cancellation after re-subscribing) overwrote the current one and downgraded a paying user to free | Fixed: a different subscription replaces the record only when Stripe reports it entitled | Late stale event keeps current plan; current cancellation still downgrades | `tests/billing.test.ts` regression (fails on old code) | pass | Locally verified | Staging lifecycle run |
| G-15 | Payment failure & cancellation | Entitlement only for `active`/`trialing` within period | Grace period is a policy choice (currently none) | `past_due` and `canceled` remove paid features | `tests/billing.test.ts` | pass | Locally verified | Owner: dunning/grace policy; staging test clocks |
| G-16 | Durable queue leases, retries, concurrency | Atomic claim (SQLite `BEGIN IMMEDIATE`; Postgres advisory lock + `skip locked`), per-tenant serialization, bounded retries | — | One claimant per run; tenant runs serialized | `tests/store.test.ts`, `tests/postgres.test.ts`, load rehearsal | pass | Locally verified | Hosted Postgres under concurrent workers |
| G-17 | Quota reservations | Reserve before submit; consume on verified receipt; release on safe failure | — | No double count; uncertain submit keeps reservation | Store/PGlite tests; load invariants | pass | Locally verified | — |
| G-18 | Worker crash recovery & supervision | Lease expiry reclaim; latch → `submission_unverified`. **Added:** heartbeats, lease watchdog, graceful shutdown, failure alerts | **Defect:** every stage renewed the lease to a hard-coded 600 s, ignoring `WORKER_LEASE_SECONDS` — recovery always took up to 10 min, and a configured lease above 600 s was silently *shortened*, allowing a reclaim while a long stage was still acting. Fixed: one bounded `leaseSeconds()` for claims and renewals; the watchdog tracks each run's last renewal and exits before a lease can lapse | Killed worker's run is reclaimed and completes once; kill after latch never resubmits | `tests/lease.test.ts` (fails on old code); scripted SIGKILL rehearsal with real worker processes | Preparation kill: recovered in 36 s, 1 application, 1 billed. Post-latch kill: `submission_unverified`, 0 billed, reservation held, alert delivered | Locally verified | Supervisor on worker host (systemd/compose `restart`) |
| G-19 | Budgets, cost accounting, emergency stop | Per-user budget, attempt/model/browser limits, cost events, global stop | Unit prices are configuration | Budget blocks new runs; stop prevents side effects | `tests/observability.test.ts`, `tests/agent.test.ts` | pass | Locally verified | Owner: model choice and unit prices |
| G-20 | Operational alerts | **Was:** in-app only. **Added:** signed webhook delivery with retries and log fallback for uncertain submissions, worker failure/watchdog, emergency stop, webhook failure, cost thresholds | All three code paths that mark a submission uncertain alert (the worker-recovery path initially did not; found by the crash rehearsal) | Alerts reach an external channel; signature verifiable; no customer content | `tests/operations.test.ts` (HTTP fixture); crash rehearsal against a local signature-checking receiver | pass; receiver validated the HMAC | Locally verified | Real alert channel URL + on-call owner |

## Application workflow

| ID | Requirement | Verification | Result | Status | Remaining dependency |
| --- | --- | --- | --- | --- | --- |
| G-21 | Confirmed facts & provenance only | `tests/resume.test.ts`, `tests/profile.test.ts` | pass | Locally verified | — |
| G-22 | Structured import review & explicit confirmation | `tests/import-review.test.ts`, `e2e/import-review.spec.ts` | pass | Locally verified | — |
| G-23 | Resume settings, generation, validation, private download, immutable history | Resume/settings/assets tests; E2E core; Docker suite compiles 6 templates × 3 fonts × 10/12pt offline | pass | Locally verified | — |
| G-24 | Question-context matching & prepared-form review | `tests/browser.test.ts`, `e2e/review.spec.ts` | pass | Locally verified | — |
| G-25 | Explicit approvals & bounded standing authorization | `e2e/autonomy.spec.ts`, agent tests | pass | Locally verified | — |
| G-26 | Submission latch, duplicate prevention, receipt evidence | E2E core; load invariants (1 application, 1 billed submission, unchanged receipt after re-apply per user) | pass | Locally verified | — |
| G-27 | Cancellation & policy changes during execution | Agent tests; E2E safety | pass | Locally verified | — |
| G-28a | Greenhouse/Lever on real permitted pages, non-submitting | Not run | — | Blocked | Owner names permitted employer pages and sets `BROWSER_ALLOWED_DOMAINS` |
| G-28b | Field filling under load | **Defect:** a transient action timeout on a slow page made a profile-answered field ("First name") look unanswerable, pausing the application (fail-safe, but 1 of 8 load users stalled) | One idempotent retry for fills that throw or read back wrong; unsupported controls still fail fast. Real-Chromium regression in `tests/browser.test.ts` | Locally verified | Confirm on real ATS pages (G-28a) |
| G-28c | Live employer submission | Not run; no authorization | — | Blocked | Explicit authorization naming destination and applicant data |
| G-29 | CAPTCHA/MFA/access controls never bypassed; unsupported portals hand off | `e2e/browser.spec.ts` login pause; unsupported ATS returns `needs_input` | pass | Locally verified | — |
| G-30 | Custom TeX requires manual PDF review | Agent tests | pass | Locally verified | — |

## Worker and compiler isolation

| ID | Requirement | Verification | Result | Status | Remaining dependency |
| --- | --- | --- | --- | --- | --- |
| G-31 | Compiler: non-root, no capabilities, no-new-privs, no network/DNS, read-only root, `noexec` tmpfs, no socket/host paths, no application secrets | `tests/latex-sandbox.test.ts` probes with the production flags | pass | Locally verified (Docker Desktop VM) | Re-run on the Linux worker host |
| G-32 | CPU, memory, PID, output, and time limits | Same suite: PID limit refuses forks, memory 384 MB, memory bomb fails closed | pass | Locally verified | Worker host |
| G-33a | Deadline and cleanup | **Defect:** the deadline never fired in Docker mode — SIGTERM to the CLI left tectonic (PID 1) running and the CLI waiting, so a looping template pinned a worker lane indefinitely. Fixed with SIGKILL + `--init`; container force-removed | Locally verified | Worker host |
| G-33b | Output flood | **Defect:** a template wrote a 101 MB log to the worker disk in 14 s. Fixed with an 8 MB per-file `fsize` limit | Locally verified | Worker host |
| G-33c | Offline fonts | **Defect:** with `--only-cached`, every built-in template failed in production once a profile had contact/skill separators (`cmsy10`) or used 10pt (`cmmi9`). Fixed in the image warmup | Locally verified | Rebuild image on worker host |
| G-34 | Malicious TeX, traversal, malformed/oversized images | Same suite: piped shell input, `\write18`, absolute/`../` writes, corrupt PNG, >1 MB image, traversal filenames | pass | Locally verified | — |
| G-35 | PDF identity, extractable text, layout, page limit | Resume tests + Docker suite; visual check of a Docker-compiled PDF (1 Letter page, fonts embedded, separators rendered) | pass | Locally verified | — |
| G-36 | Browser worker egress restriction | Not testable locally | — | Blocked | Worker network policy / egress proxy (`BROWSER_EGRESS_PROXY_URL`) on worker infrastructure |

## Customer and operator operations

| ID | Requirement | Verification | Result | Status | Remaining dependency |
| --- | --- | --- | --- | --- | --- |
| G-37 | Account data export | `tests/operations.test.ts`; `e2e/account.spec.ts` (download through UI; no other tenant's data) | pass | Locally verified | Hosted Storage listing on staging |
| G-38 | Account deletion | Local: unit + E2E (records, sessions, artifacts, secrets removed; grants revoked; other tenants intact; idempotent; refuses while billable subscription or live run). Supabase: PGlite verifies the auth-user cascade removes every tenant row | pass | Locally verified | Staging: `auth.admin.deleteUser`, Storage removal, Vault purge |
| G-39 | Retention & private-artifact cleanup | `tests/operations.test.ts`: unreferenced artifacts past 24 h removed, referenced/recent kept; expired operational rows pruned; PGlite prune function | pass | Locally verified | Owner: customer-data retention periods |
| G-40 | Credential / session revocation | Sign out of all devices (local verified, E2E second device loses session); OAuth revocation (G-10) | pass | Locally verified | Supabase global sign-out on staging |
| G-41 | External alert delivery | G-20 | — | Locally verified | Real channel |
| G-42 | Backup & restore | Local-mode procedure rehearsed: stopped stack, archived `DATA_DIR` (8 MB, 29 users), restored to a new directory in 21 s; identical record counts in all 10 collections; restored stack signed a user in and served their submitted application, verified receipt, and private PDF. Supabase procedure written in RUNBOOKS | — | Locally verified (local mode only) | Staging restore rehearsal; Supabase plan/PITR and Storage backup choice |
| G-43 | Health, readiness, worker supervision | `/api/health`, `/api/ready` (unit + E2E); heartbeats; watchdog; web image `HEALTHCHECK` | pass | Locally verified | Uptime monitor + supervisor configuration |
| G-44 | Deployment, migration, rollback, incident runbooks | `docs/RUNBOOKS.md` | written | Implemented (unrehearsed) | Staging rehearsal |
| G-45 | Privacy, consent, support flows | Export/delete/sign-out controls in Settings; optional support contact (`NEXT_PUBLIC_SUPPORT_EMAIL`) | — | Blocked | Owner/legal: privacy policy, terms, subprocessor disclosure, consent wording for automated submissions, support address |

## Verification gates

| ID | Requirement | Result | Status |
| --- | --- | --- | --- |
| G-46 | Unit/integration/security suites | 181 passed, 1 skipped | Locally verified |
| G-47 | E2E incl. accessibility (axe) | 10 passed | Locally verified |
| G-48 | UI at desktop and mobile | Screens inspected at 1440 and 390 px. Found and fixed: account buttons overflowed by 121 px on mobile (now wrap; 0 px overflow) | Locally verified |
| G-49 | Load / concurrency | See below | Locally verified (single host, dev-mode web server) |

### G-49 load rehearsal detail

Each virtual user signs up, saves a profile, compiles a resume in the Docker sandbox, prepares the fixture application in headless Chromium, approves, and waits for the verified receipt; it then re-applies to the same URL and checks invariants (exactly one application, one billed submission, unchanged receipt). Stack: Next dev server + one worker with 2 lanes, `LATEX_MODE=docker`, MacBook Air (8 GB), local SQLite. Production web latency is not represented (dev server); worker-side numbers are.

| Run | Users | Result | Wall clock | End-to-end p50 / p95 | Resume p50 / p95 | Prepare p50 / p95 | Submit p50 / p95 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 (before G-28b fix) | 8 | 7/8; 1 paused on a falsely "unanswerable" field (fail-safe) | 873 s (incl. 15 min timeout) | 125 s / 132 s | 24 s / 32 s | 82 s / 85 s | 3 s / 18 s |
| 2 | 8 | invalid run: dev-server file watcher reloaded pages continuously because `DATA_DIR` was inside the project; not a product defect (production has no watcher; the E2E launcher already isolates data) | — | — | — | — | — |
| 3 (after fixes) | 8 | **8/8, 0% failure**, all invariants held | 68 s | 52 s / 68 s | 11 s / 18 s | 35 s / 46 s | 5 s / 10 s |
| 4 | 16 | **16/16, 0% failure**, all invariants held | 142 s | 103 s / 142 s | 29 s / 58 s | 68 s / 82 s | 6 s / 12 s |

Throughput is bounded by worker lanes (≈6.7 applications/min with 2 lanes); latency grows linearly with queue depth, as designed (one active run per tenant, global lane cap). Recorded cost: 0 model tokens (no model configured), 1.1 browser-minutes for 32 attempts, $0 because unit prices are unset — **execution cost is not measured** until model and browser unit prices are configured. Retries: 0.
| G-50 | Staging deployment & release rehearsal | — | Blocked: no staging infrastructure or credentials |
| G-51 | Production cutover | — | Not started; requires owner authorization |

## Scope versus the product description

The original build brief was not available (not in the repository; a search of local Codex session logs did not find it). Scope was compared against the product description and repository documentation.

| Feature | Decision | Reason |
| --- | --- | --- |
| Greenhouse, Lever, local fixture adapters | In first release (pending G-28a) | Deterministic, verifiable |
| Workday | Excluded | Tenant-specific flows, mandatory candidate accounts, frequent CAPTCHA; no reliable supported method. Stops with a manual handoff |
| Candidate account registration on employer portals | Excluded | Would create credentials on the user's behalf and handle email verification; user completes it in the secure handoff |
| Generic/model-driven browser fallback | Excluded | Cannot meet the review-fingerprint and receipt-evidence guarantees; unsupported portals hand off |
| OCR of scanned documents | Excluded (feasible later) | Local OCR (e.g. Tesseract in the worker) is feasible but not built; users paste text |
| Advanced email actions (sending, drafting, OTP retrieval) | Excluded | Read-only reviewable notifications only; sending mail on a user's behalf needs separate consent and provider approval |

## Owner decisions required

1. ~~Product name for release~~ — resolved 2026-11-09: **J*B**. The rebrand is merged into `main`; database tables, env vars, migrations, the `career-latex` image and the `career-artifacts` bucket keep their original names.
2. Hosting: Supabase plan (PITR/backups), web host (Vercel vs container), Linux worker host, regions.
3. Billing policy: prices, plan limits, trials, payment-failure grace period, refunds, and whether deletion should cancel subscriptions automatically (currently it refuses until the customer cancels).
4. Data retention periods for evidence, resumes, applications, and logs.
5. Legal: privacy policy, terms, subprocessor list (Supabase, Stripe, OpenAI, Browserbase, Google, Microsoft), consent for automated submissions, incident-notification obligations.
6. Google restricted-scope verification for Gmail; Microsoft publisher verification.
7. Permitted employer destinations and a consenting test applicant for live ATS diagnostics and any live submission.
8. Alert channel and on-call owner; model selection and unit prices.
