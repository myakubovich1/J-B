# Troubleshooting

## Jobs stay queued

The web process deliberately does not execute long jobs. Start `npm run worker` from the same checkout with the same `.env.local` and `DATA_DIR` or Supabase project. Inspect its structured startup log. A running user job serializes the user’s other jobs. Check `GLOBAL_EMERGENCY_STOP`, budgets, queue deadlines, and operator metrics. Restart the worker after changing code or environment; its default command is not watch mode.

## Resume generation fails

Install Tectonic and Poppler, then verify `tectonic --version`, `pdfinfo -v`, and `pdftotext -v`. The first trusted local compile needs network access to fetch the TeX bundle. Custom and production compilation require the isolated image and a functioning Docker daemon. Missing packages must be reviewed and cached at image build time; runtime networking stays disabled.

Empty or unconfirmed profiles cannot generate a useful resume. Confirm imported projects and experience, and provide a legal name and valid email. A failed identity/text/page/layout validation blocks application upload. Shorten long content or choose the appropriate page limit; font size is not silently shrunk.

## Test employer unavailable

The fixture exists only when `APP_MODE=local`, `ENABLE_TEST_EMPLOYER=true`, and `NODE_ENV` is not production. Use `npm run dev`, not `next start`, for fixture E2E tests. Use the same exact `APP_URL` (`127.0.0.1` and `localhost` are different origins). It never calls real employers.

## Portal asks for login, MFA, CAPTCHA, or an unknown field

The run pauses. Configure Browserbase for a managed sign-in handoff; enter credentials in its secure view. Local headless execution cannot import your personal browser’s cookies. Unknown required questions must be answered and confirmed for their scope. CAPTCHA, access controls, and account restrictions are never bypassed. Unsupported Workday/generic widgets require manual completion.

Live browser execution is disabled unless an operator adds exact permitted domains to `BROWSER_ALLOWED_DOMAINS`. Some ATS forms also require approved resource domains. Production self-hosted Chromium requires an egress-restricted proxy. Do not turn off URL/DNS protections to make a portal work.

## Submission is unverified

Do not retry. `submissionStartedAt` means the portal may already have received the application. Review actual portal/email evidence and reconcile the receipt through a reviewed operational process. The application keeps its quota reservation until reconciled. Preparation retry is available only when no submit was initiated.

## Supabase or OAuth unavailable

Check mode and server-only environment configuration. Verify that migrations are applied to the intended staging project, the private bucket exists, Vault wrappers execute only as service_role, and the public key belongs to that project. Run the gated Supabase test against a disposable project. Never expose the service-role key in public variables.

OAuth callbacks must exactly match the registered URL and `APP_URL`. Consent denial, expired state, changed app user/session, missing PKCE state, restricted Gmail access, and revoked credentials fail clearly. Start connection again instead of reusing old callback links.

## Billing does not change a plan

Checkout success is not entitlement. Configure the signed webhook endpoint, supported event types, recurring price IDs, and Stripe test keys. Inspect webhook delivery/retry status. The handler reconciles current Stripe state and ignores duplicate completed deliveries. Unit tests validate signatures/idempotency without representing real Checkout as tested.

## Local files and folder names

This repository’s original `J*B` folder contains a literal asterisk. Some Node package wildcard subpath exports and Vite tooling can misinterpret it. The app avoids affected imports, and current unit/build/E2E commands are verified here. If new tooling fails on paths, use an ordinary-character checkout for CI; do not rename a user’s existing checkout automatically. Keep `.data/`, environment files, credentials, and artifacts out of Git and public hosting directories.

Cloud-synced folders can also create conflict copies such as `.next/types/routes.d 2.ts`, producing duplicate TypeScript declarations. The TypeScript configuration excludes generated `.next` filenames containing spaces while retaining normal Next-generated route checking. These are disposable build outputs. If another generated-cache conflict persists, stop the development server and regenerate `.next`; do not delete source files or change cloud settings automatically.
