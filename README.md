# Waypoint

A working AI career-agent application built with Next.js, strict TypeScript, Supabase, OpenAI, a durable job worker, Playwright, and a structured LaTeX resume engine.

The local workflow is implemented end to end: **sign up → build a profile → choose a template → compile and validate a PDF → send a job URL → review answers → approve → submit through a real browser to the local test employer → verify its receipt → track the application.** No live employer applications were sent during development.

## Run locally

Requirements: Node.js 24+, npm, Tectonic, and Poppler. On macOS: `brew install tectonic poppler`. On other platforms install their official packages. Custom TeX always needs the isolated Docker compiler.

```sh
npm ci
cp .env.example .env.local
npx playwright install chromium
npm run dev
```

In a second terminal:

```sh
npm run worker
```

Open the `APP_URL` configured in `.env.local` (default [http://127.0.0.1:3000](http://127.0.0.1:3000)). The development command follows that port; `--port` overrides it for an isolated test stack. Create your own local account. Data persists in `.data/`, which is ignored by Git. No API keys are required for confirmed-fact resume selection and the test-employer flow. The first trusted local LaTeX compile downloads its TeX bundle.

Add your contact information and education or confirmed experience/projects, enter your skills and country-specific eligibility, and save. In **Resumes**, select Jake’s Resume and generate a PDF. In **Agent**, use **Try the local test employer**. The worker prepares the application and pauses for your review; only **Approve & submit** permits its single submission. The employer fixture returns an actual stored receipt and validates the uploaded PDF.

The test employer is deliberately labeled, available only in local development, and disabled by production builds. It retains receipt evidence, not applicant contact values or the uploaded PDF. Real customer workflows never use fixture results.

## Tests

```sh
npm run typecheck
npm test
RUN_LATEX_TESTS=1 npm test
npm run test:e2e:local
npm run build
```

`test:e2e:local` starts and cleans up an isolated web/worker stack on port 3100, keeps test data in `.data/e2e/`, and leaves your preview running. Set `E2E_PORT` if that port is occupied. To use an already running local development server and worker, run `npm run test:e2e`; it reads `.env.local`. Tests create disposable accounts and submit only to local fixtures. Coverage includes onboarding, template selection, PDF artifacts, unknown and changed questions, fresh form review, explicit and scoped standing authorization, actual browser submission, receipt verification, tracking, duplicate prevention, cancellation, login handoff, tenant isolation, premium enforcement, and accessibility. Provider tests requiring credentials are explicitly gated.

## Integrations

- **Supabase:** complete migrations, Auth integration, private Storage, tenant RLS, transactional queue/quota functions, and Vault references. Configure credentials and validate against a disposable staging project before beta use.
- **OpenAI:** real Responses API structured job extraction and read-only career-assistant tools. Set `OPENAI_API_KEY`, `OPENAI_MODEL_EXTRACTION`, and optionally `OPENAI_MODEL_CHAT`. With no keys/models, the UI identifies unavailable AI conversation; deterministic supported workflows continue.
- **GitHub:** public REST repository imports work without credentials. Optional OAuth + PKCE enables user-authorized private repositories; each imported project requires confirmation of the user’s contribution.
- **Browserbase:** optional persistent isolated contexts and secure user-assisted sign-in. Exact operator domain allowlists and user approval are required for live browser execution. CAPTCHA/MFA are never bypassed.
- **Stripe:** Checkout, portal, signed/idempotent webhooks, current-subscription reconciliation, and verified-submission quotas. No paid entitlement is granted from a redirect or client claim.
- **Gmail / Microsoft:** OAuth, encrypted token storage/refresh, narrowly searched application correspondence, scheduled polling, and reviewable status notifications. Gmail remains gated behind provider verification or approved test-user access. Messages do not fabricate portal submission receipts.

Live Greenhouse/Lever adapters are implemented, but real-employer validation remains non-submitting until explicitly configured and authorized. Workday, unsupported forms, account registration, and model-driven browser fallback currently require user assistance. See [PROGRESS.md](PROGRESS.md) for exact verification and remaining work.

## Deployment and operating notes

Deploy the web process to Vercel using Supabase mode. Run the worker on a dedicated host with Chromium, Poppler, and access to the isolated LaTeX runtime. Do not run browser sessions or compilation in web request handlers. Production fails closed when the persistence mode is unspecified. Third-party credentials, provider approvals, infrastructure, and staging validation are still required.

- [Architecture](ARCHITECTURE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Security](docs/SECURITY.md)
- [Resume engine and template contract](docs/RESUMES.md)
- [Agent execution and browser support](docs/AGENT.md)
- [OAuth setup](docs/OAUTH.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

Set `ADMIN_USER_IDS` to an explicit comma-separated UUID allowlist for `/admin`. The operator view reports saved activity, nominal MRR, queue state, costs, retries, and failure categories. Cost estimates require configured unit prices. Set `GLOBAL_EMERGENCY_STOP=true` on both processes to stop new side effects.
