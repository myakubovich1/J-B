# Implementation progress

Updated: 2026-11-09. Latest full local verification: 2026-11-09 (branch `main`, after merging the J*B rebrand into the release work). The per-requirement release gates, evidence, and owner decisions are in [docs/RELEASE_READINESS.md](docs/RELEASE_READINESS.md).

## Release assessment

Locally verified internal alpha. **No gate is staging- or production-verified**: no staging environment, Supabase project, Stripe test account, OAuth apps, Browserbase account, alert channel, or permitted employer pages were available. Recommended next step is a staging deployment followed by internal testing; a supervised private beta should wait for the blocked staging gates, the legal/policy decisions, and a non-submitting real-ATS diagnostic. Not ready for public launch. No live employer applications have ever been sent.

## Verified integrated core

- Next.js App Router, strict TypeScript, Tailwind, accessible reusable controls, Lucide, responsive Agent-first workspace and all seven navigation areas.
- Real local registration/sign-in/sign-out, scrypt passwords, opaque hashed sessions, private per-user persistence, and durable worker queue.
- Resumable profile forms, education, confirmed experience/projects, skills, preferences, explicit country-specific eligibility, provenance inventory, and version history/restore.
- Six real LaTeX templates, including MIT-attributed Jake’s Resume; structured renderer, exact confirmed wording, relevant record selection, PDF/TeX artifacts, validation and preview.
- Safe URL intake → employer metadata → relevance → PDF → actual Playwright form filling/upload → explicit review → single submission → real stored fixture receipt → private evidence → tracking and CSV export.
- Clarification of conditional screening questions; exact scoped confirmed answer memory; separate submission approval; cancel-before-submit; no login credential capture.
- Duplicate job/run prevention, atomic leases/concurrency, atomic quota reservation, verified-success accounting, retry guards, stale-review rejection, ambiguous-submit latch, and emergency stop.
- Prepared-form fingerprints bind answers to question wording/choices and require fresh review when the form changes. Unknown optional preselected values pause.
- CSV/JSON imports produce editable suggestions that are added only after explicit review and confirmation.
- Built-in template layout settings persist per tenant/template and are snapshotted on generated resumes. Custom templates support immutable, bounded PNG/JPEG bundles. Custom PDFs always require manual submission review.
- Discovery source health, inventories, revisions, and closure evidence; consent and limits rechecked before enqueue.
- Operator metrics with explicit cohorts/denominators; durable in-app cost alerts.

## Brand: J*B (merged 2026-11-09)

- Product renamed from Waypoint to **J*B** (jasteriskb.com, "Your personal AI career agent") across the homepage, auth, workspace, all views, metadata, chat persona, docs, CI name, package name, user agents, and the OAuth state cookie (`jb_oauth`; short-lived, so renaming is safe). The merge also renamed identifiers added during the release pass: alert webhook headers `X-JB-Timestamp`/`X-JB-Signature`, account export format `jb-account-export`, and the export filename.
- Reusable brand components: `src/components/brand.tsx` (`Logo`, `Asterisk`, `AppIcon`). Favicon `src/app/icon.svg`, generated `apple-icon.tsx` and `opengraph-image.tsx` (fonts vendored in `src/app/_og/`, OFL).
- Palette tokens on `:root` in `globals.css`. The legacy warm palette was converted programmatically (neutrals → slate, sage accent → teal, semantic reds/ambers kept). `--teal-ink` `#0A7270` is the text/button teal for AA contrast; `#06B6B4` is for marks and fills.
- Legacy 8–11px body text was scaled to 12–14px. Georgia serif was replaced by Plus Jakarta Sans display type.
- Internal identifiers kept for compatibility: database tables, env vars, migrations, `career-latex` Docker image name, `career-artifacts` bucket.

## Product surface from the rebrand

- `/` is the marketing homepage for signed-out visitors ("Your career. On autopilot.") and the workspace when signed in. `/signup`, `/signin`, and `/login` (alias) render auth. Plan prices on the homepage come from the same env values as billing. No testimonials or invented statistics.
- Fixed: the Supabase confirmation callback redirected to a non-existent `/login`. It now goes to `/signin?error=confirmation_failed`, which shows a message.
- Agent workspace is three-pane: left nav, chat in the center, and a right context panel for the application in focus (job, candidate match with reasons, tailored resume with a link to the exact PDF, a five-step submission status, and receipt). Falls back to the profile card when no application exists.
- Resume gallery: career-track filters and real first-page previews of every built-in template (`public/templates/*.png|pdf`, rendered with fictional sample content by `scripts/render-template-previews.ts`).
- Fixed: four of the six "distinct" templates rendered identically to another (Finance and Consulting were byte-identical to Jake's Resume, and Product to Technical). `renderLatex` uses a per-template style table (heading style, alignment, section order, section gap); saved layout settings override font family, size, margins, spacing and paper. A regression test asserts that all built-in templates render differently.

## Added in the 2026-11-08 release pass

- **Isolated compiler, executed for the first time.** Docker sandbox suite (`tests/latex-sandbox.test.ts`, `RUN_DOCKER_TESTS=1`) probes the real container and compiles hostile templates. Fixed: deadline never fired in Docker mode (looping template pinned a worker lane); 101 MB output flood onto the worker disk; every built-in template failing offline in production because math fonts were not cached (`cmsy10`, `cmmi9`).
- **Billing:** a late event for a replaced Stripe subscription no longer downgrades the current paying subscription.
- **Queue leases:** stage renewals honour `WORKER_LEASE_SECONDS` (were hard-coded to 600 s); lease watchdog exits a worker before a lease can lapse mid-stage; heartbeats; graceful shutdown.
- **Browser filling:** a transient timeout on a slow page no longer pauses an application on a field the profile answers.
- **OAuth:** disconnect revokes Google/GitHub grants (Microsoft reported as unsupported with manual steps); under-scoped grants are revoked and rejected; GitHub private access can be disconnected.
- **Customer data rights:** JSON export, sign out of all devices, and self-service account deletion (revokes grants, removes artifacts and secrets; Supabase deletion cascades through the auth user). Refuses while a billable subscription or worker step is live.
- **Operations:** `/api/health`, `/api/ready`, signed external alert webhook (uncertain submissions, worker failure/watchdog, emergency stop, webhook failure, cost thresholds), scheduled retention of orphaned artifacts and expired operational rows, web image `HEALTHCHECK`, new migration `20261107230000_operations.sql`.
- **Docs:** `docs/RUNBOOKS.md` (deployment, migration, rollback, incident, backup/restore, retention) and `docs/RELEASE_READINESS.md`.

## Verification evidence (2026-11-09, merged `main`)

- `RUN_LATEX_TESTS=1 RUN_DOCKER_TESTS=1 npx vitest run`: 182 passed, 1 skipped (live Supabase, gated) across 23 files. The extra test over 2026-11-08 is the rebrand's "every built-in template renders a distinct layout" regression; the Docker sandbox compiles every template at 10/12 pt in every font family.
- `npm run test:e2e:local`: 10 passed. `e2e/import-review.spec.ts` now starts at `/signup`, because `/` is the marketing homepage for signed-out visitors.
- `npm run typecheck`, clean `npm run build`, `prettier --check src workers tests e2e scripts` (including `globals.css`): pass. `npm audit --audit-level=high`: 0 vulnerabilities.
- Template gallery previews (`public/templates/*`) regenerated with `scripts/render-template-previews.ts`, since built-in templates now take their margins from layout settings (default 0.65in).

## Verification evidence (2026-11-08, macOS host, Node 24.22, Docker Desktop 28.4)

- `RUN_LATEX_TESTS=1 RUN_DOCKER_TESTS=1 npx vitest run`: 181 passed, 1 skipped (live Supabase, gated) across 23 files.
- `npm run test:e2e:local`: 10 passed, including the account export/sign-out-everywhere/deletion flow and health endpoints.
- `npm run typecheck`, `npm run build`: pass. `npm audit --audit-level=high`: 0 vulnerabilities (not a security audit).
- Baseline before changes reproduced: 141 passed / 1 failed (cold TeX cache timeout; passes warm) / 1 skipped; E2E 8 passed.
- Load rehearsal (`scripts/load-test.mjs`, 2 worker lanes, Docker compiler): 8 users 8/8 in 68 s; 16 users 16/16 in 142 s; 0 failures; invariants held.
- Crash rehearsal (real SIGKILL): run reclaimed and submitted once; kill after the submission latch → `submission_unverified`, not retried or billed, signed alert delivered.
- Local-mode backup/restore rehearsed with identical record counts and working sign-in, application, receipt, and PDF.
- Desktop (1440 px) and mobile (390 px) screens inspected; a mobile overflow in the new account controls was fixed. A Docker-compiled PDF was visually inspected.

## Requires configuration or remains unverified

- Hosted Supabase (Auth, Storage, Vault, RLS advisors), Stripe test mode, live OAuth consent/refresh/revocation, Browserbase, OpenAI, alert channel, and a staging deployment and release rehearsal.
- Real Greenhouse/Lever pages in non-submitting mode need the owner to name permitted employer pages; live submissions need explicit authorization naming the destination and applicant data.
- Worker egress restriction and the compose worker recipe on a Linux host; re-run the sandbox suite there.
- Owner/legal decisions: hosting, billing/grace/refund policy, data retention periods, privacy policy/terms/subprocessors/consent, Google restricted-scope verification, alert on-call, model and unit prices.

## Outstanding expansion (excluded from the first release)

- Workday, employer account registration, and generic/model-driven browser fallback stop for user assistance.
- OCR and automated extraction from arbitrary prose; structured CSV/JSON imports are supported.
- Email sending, drafting, and OTP retrieval; inbox monitoring creates reviewable notifications only.
- Time-based expiry of customer data pending a retention policy.

## Repository and development environment

- **Authoritative repository: `~/Projects/jasteriskb`, branch `main`.** All earlier lines of work are merged into it: the Codex baseline `c03976e`, the J*B rebrand `6d230de`, and the release work through `759d301`. The `jb-rebrand`, `release/waypoint-staging`, `jb-rebrand-verified` and `recovery/codex-baseline` branches and the `~/Projects/waypoint` worktree were retired after the merge. No remote is configured yet.
- The iCloud folder (`…/Projects/J*B`) is a mirror of `main`: its git has `origin` set to `~/Projects/jasteriskb`, and its working tree matches `main`. It sits on a nearly full disk, so iCloud evicts files to "dataless" placeholders and builds, tests and git can stall there. Build and test in `~/Projects/jasteriskb`; update the mirror with `git pull` when it is fully downloaded.
- The `*` in the folder name `J*B` triggers a Vite warning. Prefer a plain directory name.
- Keep `DATA_DIR` outside the project for load tests; data written inside the tree triggers Turbopack reload storms.
