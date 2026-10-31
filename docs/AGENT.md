# Application worker

The web process queues durable `agent_runs`; `npm run worker` leases and executes them. Use Node 24+. Browser work and LaTeX compilation never run inside a long web request. The worker is a deterministic state machine, with optional OpenAI structured extraction for permitted pages lacking job metadata. Configure `OPENAI_MODEL_EXTRACTION` explicitly; no model call or fabricated AI response occurs without a key and model.

## Local vertical slice

Set `APP_MODE=local`, `APP_URL=http://127.0.0.1:3000`, and `ENABLE_TEST_EMPLOYER=true` for both web and worker. Install Chromium with `npx playwright install chromium`. Start the web app and worker, register, complete a profile, choose a template, and send `http://127.0.0.1:3000/fixture/employer/software-intern`. The fixture is explicitly a test employer and disabled in production. The worker uses a real browser, uploads the compiled PDF, waits for approval, clicks the actual form, and verifies the fixture receipt page. It does not contact an employer.

With a disposable local Autonomous entitlement, the configured loopback hostname may also be used in standing rules for this fixture. This exception requires explicit local mode, the fixture flag, and a non-production process; URL validation still permits only the configured fixture routes, never other private-network destinations. Production standing rules reject IP literals and localhost.

## Supported live sources

Greenhouse job data uses the [public read-only Job Board API](https://docs.greenhouse.io/job-board). Lever data uses its [Postings API](https://github.com/lever/postings-api). API access to published jobs does not authorize submission. Set `BROWSER_ALLOWED_DOMAINS` only after verifying that the specific employer allows your workflow. It is an exact comma-separated hostname allowlist. `BROWSER_RESOURCE_DOMAINS` additionally permits explicit third-party assets/API hosts; it does not authorize top-level navigation or submission to those hosts. Unknown forms and required fields pause for input. Workday and generic form execution require manual completion in this version. There is no CAPTCHA/MFA bypass, stealth browser, or account creation without approval.

The deterministic Greenhouse and Lever browser adapters use predictable input names/labels, upload controls, submit buttons, and provider receipt selectors. They have fixture coverage but have not been verified against live employers. UI changes, custom controls, anti-bot challenges, and login requirements can require user input. Stagehand/model-driven action fallback is deliberately not enabled: arbitrary model clicks would weaken the reviewed submission boundary.

## Browser isolation and login

Local browsers use fresh contexts without persisting authentication cookies. Production local browsers require `BROWSER_EGRESS_PROXY_URL`, whose operator must enforce public-only DNS and network egress. Browserbase uses its API and CDP, one managed persistent context per user and employer domain, with CAPTCHA solving, stealth, and recording disabled. Only the context/session identifiers are stored as metadata; no cookies, passwords, connect URLs, or API keys enter application records or prompts. `getBrowserHandoff` retrieves a fresh live browser debug link for an authorized user when a login run is waiting. Complete login there, then continue. A separate personal browser's login is not transferred into local headless sessions.

All HTTP document reads pin DNS to a public address and revalidate every redirect. Browser requests are restricted to the explicitly enabled hostnames and public DNS resolution. Production browser workers must also have an egress firewall/proxy against DNS rebinding and metadata networks; Playwright routing alone is not a network security boundary.

## Approval and recovery

Application identity is a deterministic tenant-and-canonical-URL UUID, with a database uniqueness constraint. A submission approval binds a SHA-256 snapshot of the profile, generated resume ID, job URL, exact known answers, and prepared form. Saved posting answers carry a context hash of the question wording and choices; a reused field name cannot authorize a different question. The browser fingerprints editable field labels, types, required flags, visibility, choices, filled values, and destination. A changed form returns for fresh review before the submission latch is set. Hidden CSRF/session tokens are excluded from this fingerprint because they change per visit. An unknown optional field with an existing value or checked box also pauses for review.

The worker rechecks authorization, plan quota, profile state, standing rules, and emergency stop immediately before clicking. A profile edit during autonomous browser preparation prevents submission. Country-specific eligibility checkpoints are invalidated when the saved eligibility facts change. It atomically reserves quota before persisting the `submissionStartedAt` latch and the final filled fields, including standing-authorized submissions. Reviews and application details show these prepared fields separately from historical answer memory. A verified receipt is saved before idempotently counting a verified submission. Unknown outcomes become `submission_unverified`; the worker never blindly clicks submit again after a persisted latch.

Retries are limited to classified preparation/network failures. Expired leases resume preparation, while a submission latch requires manual reconciliation. Keep exactly one lane per user where possible; the database enforces durable run leasing and per-application quota reservations. `WORKER_CONCURRENCY` defaults to 1, maximum 4. All consequential actions and progress stages are tenant-scoped persistent events.

## Discovery

Sources support GitHub repository README/file URLs, Greenhouse boards, and Lever boards. GitHub content is accessed through its supported contents API, tracked by content SHA, and parsed for supported ATS links. Links are verified against the employer before queueing. Discovery requires an active Autonomous subscription plus explicit standing rules, allowed domains, and confirmed eligibility. A discovery run requeues itself at `DISCOVERY_INTERVAL_MINUTES` while enabled. Save an initial `kind: discovery` run when a user enables monitoring. Limits, score, emergency stop, and pause controls are checked again before submission; pausing does not reverse an already sent network request.

`GLOBAL_EMERGENCY_STOP=true` stops worker claims and is checked immediately before submit. `PER_USER_MONTHLY_BUDGET_USD`, `MAX_JOB_ATTEMPTS`, `MAX_BROWSER_RUNTIME_MS`, and `MAX_DISCOVERY_JOBS_PER_RUN` constrain work. Model/browser costs use configured unit rates; leaving rates zero means cost estimates are incomplete, not that providers are free.
