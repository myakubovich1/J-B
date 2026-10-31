# Implementation progress

Updated: 2026-10-31 (J*B rebrand and recovery session).

## Read this first: environment

- The original project folder (`~/Documents/…/Projects/J*B`) is iCloud-synced. With the disk ~98% full, macOS evicts files to "dataless" placeholders (`ls -lO` shows `compressed,dataless`). Builds, tests, and git in that folder hang or take over an hour. This caused the earlier "even `ls` fails" session failure.
- Work is done in a local copy at `~/Projects/jasteriskb`, which has the same git history (checkpoint commit `c03976e`). Keep the project outside iCloud, or free disk space and mark the folder "Keep Downloaded".
- The `*` in the folder name `J*B` also triggers a Vite warning. Prefer a plain directory name.
- `.next/` corruption was the Codex "stale build cache": it had been evicted by iCloud. A clean `rm -rf .next && npm run build` passes.

## Brand (done)

- Product renamed from Waypoint to **J*B** (jasteriskb.com, "Your personal AI career agent") across the homepage, auth, workspace, all views, metadata, chat persona, docs, CI name, package name, user agents, and the OAuth state cookie (`jb_oauth`; short-lived, so renaming is safe).
- Reusable brand components: `src/components/brand.tsx` (`Logo`, `Asterisk`, `AppIcon`). Favicon `src/app/icon.svg`, generated `apple-icon.tsx` and `opengraph-image.tsx` (fonts vendored in `src/app/_og/`, OFL).
- Palette tokens on `:root` in `globals.css`. The legacy warm palette was converted programmatically (neutrals → slate, sage accent → teal, semantic reds/ambers kept). `--teal-ink` `#0A7270` is the text/button teal for AA contrast; `#06B6B4` is for marks and fills.
- Legacy 8–11px body text was scaled to 12–14px. Georgia serif was replaced by Plus Jakarta Sans display type.
- Internal identifiers kept for compatibility: database tables, env vars, migrations, `career-latex` Docker image name, `career-artifacts` bucket.

## Product surface (done this session)

- `/` is the marketing homepage for signed-out visitors ("Your career. On autopilot.") and the workspace when signed in. `/signup`, `/signin`, and `/login` (alias) render auth. Plan prices on the homepage come from the same env values as billing. No testimonials or invented statistics.
- Fixed: the Supabase confirmation callback redirected to a non-existent `/login`. It now goes to `/signin?error=confirmation_failed`, which shows a message.
- Agent workspace is three-pane: left nav, chat in the center, and a right context panel for the application in focus (job, candidate match with reasons, tailored resume with a link to the exact PDF, a five-step submission status, and receipt). Falls back to the profile card when no application exists.
- Resume gallery: career-track filters and real first-page previews of every built-in template (`public/templates/*.png|pdf`, rendered with fictional sample content by `scripts/render-template-previews.ts`).
- Fixed: four of the six "distinct" templates rendered identically to another (Finance and Consulting were byte-identical to Jake's Resume, and Product to Technical). `renderLatex` now uses a per-template style table. A regression test asserts that all built-in templates render differently.

## Feature audit (evidence from this session)

| # | Feature | Status | Evidence / gap |
|---|---|---|---|
| 1 | Registration & login | Working and verified (local mode) | e2e `core`, `safety`, `accessibility`. Supabase Auth mode requires credentials. |
| 2 | Candidate onboarding | Working and verified | e2e `core` fills basics, education, skills, eligibility. |
| 3 | Persistent career profile | Working and verified (SQLite) | Unit `profile`/`store`, e2e `core`. Postgres SQL exercised with embedded PGlite; hosted Supabase untested. |
| 4 | Resume/document import | Partially working | Text import verified (e2e `safety`, unit `imports`). Structured AI extraction requires `OPENAI_*`. No OCR. |
| 5 | GitHub integration | Working for public repos; private needs credentials | Live public REST listing verified this session (100 repos). Import tested with mocks. Private OAuth needs `GITHUB_CLIENT_*`. |
| 6 | LaTeX template selection | Working and verified | e2e `core` selects Jake's Resume and a track default. |
| 7 | Job-specific tailoring | Partially working | Deterministic relevance-based selection of confirmed facts verified. AI tailoring requires `OPENAI_*` and was not live-tested. |
| 8 | PDF compilation | Working and verified | `RUN_LATEX_TESTS=1`: all six templates compile to one page with real Tectonic. Docker isolated compiler not run (no Docker on this host). |
| 9 | Job URL parsing | Verified on fixture; live ATS untested | e2e on local employer. Greenhouse/Lever parsing unit-tested. |
| 10 | Browser application execution | Verified on fixture only | Real Playwright Chromium fills and uploads on the local employer. Live portals are blocked by the empty `BROWSER_ALLOWED_DOMAINS` by design. |
| 11 | Screening questions | Verified on fixture | e2e `browser`, `review`: conditional and changed questions pause, and confirmed answers are reused only on exact match. |
| 12 | Authentication handoff | Verified locally; remote needs credentials | e2e: pauses at a login form without capturing credentials. Browserbase handoff requires `BROWSERBASE_*`. |
| 13 | Authorized submission | Verified on fixture | e2e: single submit after explicit approval; duplicates prevented. |
| 14 | Submission confirmation | Verified on fixture | Stored fixture receipt and evidence. Live portal receipts untested. |
| 15 | Application tracking | Working and verified | e2e table, status, duplicate handling. CSV export route exists. |
| 16 | GitHub internship monitoring | Implemented, partially verified live | Live parse of SimplifyJobs README extracted Greenhouse/Lever links this session. Scheduled monitor → queue → apply is unit/e2e-tested locally, not live. |
| 17 | Stripe subscription enforcement | Enforcement verified; Checkout needs credentials | e2e: autonomy settings rejected (403) without an entitlement. Webhooks unit-tested with signed payloads. Live Checkout needs `STRIPE_*`. |

Passing tests against the local mock employer do not prove that live third-party portals work.

## Verification results (2026-10-31, `~/Projects/jasteriskb`)

- `npm run typecheck`: pass.
- `npx prettier --check src workers tests e2e scripts`: pass. There is no ESLint config; Prettier is the only linter.
- `RUN_LATEX_TESTS=1 npx vitest run`: 93 passed, 1 skipped (Supabase hosted integration, needs credentials).
- `npm run build` from a clean `.next`: pass.
- `npm run test:e2e:local`: 7/7 passed after the rebrand (accessibility/axe WCAG 2.1 AA on marketing, sign-up, Agent, Career Profile, Resumes). Baseline before changes was 6/7; `autonomy.spec` failed once in the full suite (stuck in `applying` past 90s) but passed alone and in later full runs. Treat it as timing-sensitive under load.
- Visual check: desktop and mobile screenshots of every screen. No horizontal overflow at 360/390/768px on public pages.

## Missing configuration (none supplied)

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `OPENAI_MODEL_EXTRACTION`, `OPENAI_MODEL_CHAT`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`, `STRIPE_AUTONOMOUS_PRICE_ID`, `GITHUB_CLIENT_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET`, `BROWSERBASE_API_KEY/PROJECT_ID`, `BROWSER_ALLOWED_DOMAINS`, `MODEL_*_USD_PER_MILLION`, `ADMIN_USER_IDS`.

## Requires configuration or remains unverified

- Hosted Supabase (Auth/Storage/Vault), OpenAI, Stripe Checkout, GitHub private OAuth, Google/Microsoft consent, Browserbase, and real employer workflows are not live-tested.
- Isolated Docker LaTeX compilation is implemented but was not run (no Docker daemon).
- `robots` is `noindex` site-wide (pre-launch). Switch to index for the marketing page at launch.

## Outstanding expansion (unchanged from the Codex session)

- Workday, generic model-driven browser fallback, account registration, and password storage are intentionally unsupported and stop for the user.
- Custom TeX asset bundles and a template settings UI (fonts, margins, section order) are not implemented.
- Import does structured extraction only with AI configured. There is no OCR or LinkedIn structured parsing.
- Semantic screening-question equivalence; broader ATS widgets.
- Transactional email (no templates exist yet: Supabase defaults would be unbranded), incident alerts, retention/erasure workflows, and a deployment rehearsal.

## Next tasks

1. Configure a disposable Supabase staging project; apply migrations; run gated tests; brand the Supabase Auth email templates as J*B.
2. Add an OpenAI key and models; verify AI tailoring and chat end to end, and add an eval for "never invents experience".
3. Stripe test mode: run Checkout → webhook → entitlement → discovery unlock.
4. Authorized non-submitting diagnostics against one real Greenhouse and one real Lever posting.
5. Template customization UI (section order, margins, font) on top of `templateStyles` in `src/lib/resume.ts`.
6. Investigate `autonomy.spec` timing under load (poll interval vs. worker lease).
