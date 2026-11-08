# Implementation progress

Updated: 2026-11-07. Latest full local verification: 2026-11-04.

## Release assessment

Functional local MVP / internal alpha, ready for staging integration work. Not ready for public release or unsupervised real-customer applications. Local fixture success does not establish live ATS reliability or production security. No live employer applications were sent during development.

## Verified integrated core

- Next.js App Router, strict TypeScript, Tailwind, accessible reusable controls, Lucide, responsive Agent-first workspace and all seven navigation areas.
- Real local registration/sign-in/sign-out, scrypt passwords, opaque hashed sessions, private per-user persistence, and durable worker queue.
- Resumable profile forms, education, confirmed experience/projects, skills, preferences, explicit country-specific eligibility, provenance inventory, and version history/restore.
- Six real LaTeX templates, including MIT-attributed Jake’s Resume; structured renderer, exact confirmed wording, relevant record selection, PDF/TeX artifacts, validation and preview.
- Safe URL intake → employer metadata → relevance → PDF → actual Playwright form filling/upload → explicit review → single submission → real stored fixture receipt → private evidence → tracking and CSV export.
- Clarification of conditional screening questions; exact scoped confirmed answer memory; separate submission approval; cancel-before-submit; no login credential capture.
- Duplicate job/run prevention, atomic leases/concurrency, atomic quota reservation, verified-success accounting, retry guards, stale-review rejection, ambiguous-submit latch, and emergency stop.
- Desktop/mobile screenshots inspected. Full UI core test passed after fixing SQLite row serialization and form labeling.
- Prepared-form fingerprints bind answers to question wording/choices and require fresh review when the form changes. Unknown optional preselected values pause. Final filled fields are persisted for manual and standing-authorized submissions.
- CSV/JSON imports produce editable education, experience, project, skill, and achievement suggestions. Explicit review adds them only to the local profile draft; saving persists confirmed records with source provenance. Arbitrary prose/OCR remain manual.
- Built-in template layout settings persist per tenant/template and are snapshotted on generated resumes. Custom templates support immutable, bounded PNG/JPEG bundles with integrity checks and concurrent-upload cleanup. Custom PDFs always require manual submission review.
- Discovery stores source health, inventories, revisions, additions/updates/removals/reopenings, and employer closure evidence. Partial scans do not infer removals; consent and limits are rechecked before enqueue.
- Operator metrics show explicit cohorts/denominators for completion, verification, clarification, resume generation/validation, and application cost. Durable in-app cost alerts deduplicate and recover partial notification writes.

## Implemented integration boundaries

- Supabase schema/RLS, relational projections, private artifact bucket, Auth callback, service-only queue/quota/rate-limit functions, and Vault secret references.
- OpenAI Responses structured extraction and bounded read-only chat tool loop; explicit configured model IDs and token/cost events.
- Public GitHub REST imports and selected repositories; OAuth/PKCE for authorized private access; all imported contributions require confirmation.
- Greenhouse and Lever deterministic browser paths, Browserbase persistent per-user contexts, secure sign-in handoff, platform challenge pauses.
- Premium source monitoring for GitHub Markdown and supported ATS feeds, deduplication, current-posting verification, matching, standing-authorization controls, and scheduled queue runs.
- Gmail/Microsoft OAuth and token refresh, narrow header searches, association/detection, notification events, and scheduled polling. Status changes remain reviewable user actions.
- Stripe Checkout/portal, signed idempotent webhook processing, entitlement reconciliation, configurable quotas/plans.
- Operator view with users/subscriptions/nominal MRR, attempts/receipts/failures, runtime, browser minutes, tokens/cost, retries, queue and failure categories.

## Verification evidence

- `RUN_LATEX_TESTS=1 npm test`: 142 passed, 1 skipped across 20 files. The skipped test requires a real configured Supabase project.
- `npm run test:e2e:local`: 8 passed. Includes onboarding, real PDF upload, explicit and scoped standing authorization, portal receipt, tracking, duplicates, conditional questions, login pause, changed-form review, structured import/edit/save, tenant boundaries, premium enforcement, and core-screen accessibility/mobile checks.
- Real Tectonic compilation: all six templates, accented candidate names, and settings-aware PDFs passed. An A4/12pt PDF was visually inspected: one page, no compiler warnings/layout issues.
- `npm run typecheck` and `npm run build`: passed against the integrated source.
- `npm audit --audit-level=high`: zero reported vulnerabilities at the recorded run. This is not a complete security audit.
- Focused discovery/job tests: 52 passed, including 23 discovery lifecycle cases. Resume/settings/assets tests: 11 passed. Admin/observability tests: 13 passed; these are included in the full suite, not additional totals.
- Supabase core SQL was exercised against embedded PostgreSQL by the persistence workstream, including tenant RLS, queue claim, quota reservation, and rejected privileged calls. Full hosted-stack/Vault test remains gated.
- Verification ran in an ordinary-path temporary checkout with identical locked dependencies because cloud-backed reads in the canonical workspace stalled. Durable source remains in this repository; no production deployment was performed.

## Requires configuration or remains unverified

- No production credentials were supplied. Supabase hosted Auth/Storage/Vault, OpenAI live requests, Stripe Checkout/live reconciliation, GitHub private OAuth, Google/Microsoft consent/refresh, Browserbase, and actual employer workflows are not represented as live-tested.
- Docker daemon was unavailable; custom/production isolated LaTeX execution is implemented but has not been run on this host. It fails closed when unavailable. Trusted built-in local compilation is verified.
- Real ATS diagnostics must remain non-submitting until a permitted employer/domain and authorized live test are configured. Third-party forms may change.

## Outstanding expansion

- Workday, generic/model-driven Stagehand fallback, reliable account registration and password handoff/storage are intentionally unsupported. These stop for user assistance.
- Custom asset compilation remains unverified until Docker is available; workspace asset admission checks are conservative rather than a hard transactional global storage ledger.
- Structured CSV/JSON imports are supported; automated extraction from arbitrary transcript/LinkedIn/resume prose and OCR are not implemented.
- Exact-question memory is conservative; semantic question equivalence and broader ATS field widgets need supported adapters/tests.
- Email detects reviewable updates; automatic legal/consequential status interpretation, message-body drafting, OTP inbox retrieval, and employer email sending are not enabled.
- Transactional external notifications, production incident-alert delivery, staging provider diagnostics, retention/account-erasure workflows, and a full deployment rehearsal remain necessary before a public beta.
- Cost estimates require operator unit prices; procurement/pricing economics are not validated.

## Next tasks

1. Configure a disposable Supabase staging project; apply migrations, run gated tests/advisors, and verify Auth, Vault, Storage, and tenant isolation.
2. Build and test the isolated compiler and Chromium worker on dedicated infrastructure, including egress restrictions, crash recovery, and concurrent execution.
3. Complete provider consent and Stripe test-mode setup; validate OAuth refresh/revocation, inbox permissions, billing lifecycle, and Browserbase sessions using real credentials.
4. Validate the chosen Greenhouse/Lever employer workflows without submission, then conduct explicitly authorized controlled live tests with receipt reconciliation.
5. Complete retention/account-erasure workflows, external incident delivery, backup/restore rehearsal, and staging deployment/rollback validation before admitting real beta users.
6. Expand one ATS widget/workflow at a time with fixtures and authorized diagnostics. Workday/account registration remain outside current supported automation.
