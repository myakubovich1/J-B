# Architecture decisions

## Process and trust boundaries

The Next.js App Router application owns authenticated UI/API requests. A separate Node worker claims persistent jobs and executes long operations. The browser and LaTeX compiler never run as prolonged serverless requests. All important state is durable, and UI progress comes from run/event records rather than timers or simulated responses.

```
Browser → authenticated Next.js API → tenant-scoped Store → durable agent_runs
                                                 ↓
                                      dedicated Node worker
                                      ↙       ↓          ↘
                              job reader  resume engine  ATS browser
                                              ↓              ↓
                                    isolated compiler  evidence + receipt
                                              ↘              ↙
                                    private artifact storage
```

## Persistence

The typed Store contract has local SQLite and Supabase implementations. Local mode supports real scrypt accounts and opaque hashed sessions, multiple isolated users, atomic leases and quota reservations, and private filesystem artifacts. It is a development mode for one host; no seeded user, default password, or fake production result exists.

Supabase uses tenant-owned relational tables with validated JSONB contracts, independent owner/id constraints, tenant indexes, duplicate URL protection, and composite foreign keys for application links. Transactional projections maintain education, experience, projects, skills, achievements, tracks, preferences, resume settings, and job inventory. Clients may select only their own rows; consequential writes go through authenticated server routes. Service-role code still explicitly filters by owner. Tokens live in Vault via service-only wrappers in a nonexposed schema, never ordinary records.

## Agent and tools

`contracts.ts` defines the canonical Zod contracts. `jobs.ts` reads bounded employer metadata with checked/pinned DNS and checked redirects, extracts supported ATS/JSON-LD facts, optionally uses real structured OpenAI output, and scores confirmed facts. The relevance score is a transparent heuristic, not a probability of hiring or a legal eligibility determination.

`agent.ts` orchestrates deterministic services. It records each meaningful stage and creates persisted clarification, login, and submission checkpoints. Read-only chat tools retrieve confirmed facts, actual application states, and template names. The chat model has no submission, credential, billing, or email-sending tools. External job text, imported documents, and email subjects are always untrusted data.

`resume.ts` ranks existing confirmed records, renders escaped structured content into licensed templates, compiles a PDF, checks provenance/identity/text/page/layout evidence, and trims lower-ranked content on overflow. It never invents achievements or freely rewrites TeX with a model. Custom or production sources compile in a no-network, non-root, resource-limited container containing no application secrets.

`browser.ts` uses deterministic selectors and field verification for enabled Greenhouse/Lever portals and the explicitly separate local fixture. Unsupported fields pause. Browserbase contexts are tenant/employer-specific; only opaque context/session metadata is persisted. Passwords and one-time codes are entered by the user in a secure browser handoff and are excluded from answer memory.

## Submission consistency

Job URLs are canonicalized and assigned tenant-specific deterministic application IDs. `createIfAbsent` prevents concurrent enqueue requests from resetting running work. Queue claims are atomic, global concurrency is bounded, and each tenant runs at most one active job. Leases allow preparation recovery.

A submission approval hashes the profile, exact resume ID, answers, question contexts, prepared fields, form fingerprint, and canonical job URL. Repeated field names cannot reuse an answer to a changed question. The browser compares the current form against the reviewed fingerprint and returns for fresh review when labels, choices, requirements, fields, values, or destination change. Unknown preselected optional values also pause. Ephemeral hidden CSRF/session inputs are excluded. The worker checks authorization again immediately before the final side effect and rereads cancellation/autonomy/quota state. Profile changes invalidate manual approval and stop an autonomous preparation already in progress. Standing authorization additionally requires the Autonomous plan, explicit domains, minimum score, daily limit, confirmed country matching, and no unresolved questions.

The worker atomically reserves a quota slot, persists `submissionStartedAt` and the final filled fields, then clicks once. This preserves the submitted fields for both manual and standing authorization independently of historical answer memory. Any crash or ambiguous result after that latch becomes `submission_unverified`; it is never retried blindly. Only reliable portal evidence marks `submitted`, and a unique usage event counts it once. Retrying a safe preparation failure creates a fresh run and new review. Internal retry costs stay separate from verified submissions.

## Communication and billing

OAuth connections use state, PKCE, authenticated user binding, short-lived consumed state, encrypted token storage, and explicit scope grants. Email monitoring requests only application-related headers, associates both company and role, and creates reviewable notifications. It does not treat an email as proof that the portal submitted successfully or execute instructions from messages. Sending employer mail is unsupported.

Stripe webhook signatures are verified against raw bodies. Event claims are persistent and idempotent; subscription reconciliation fetches current Stripe state to resist out-of-order delivery. Entitlements derive only from active/trialing, unexpired server records. Quotas currently use UTC calendar months.

## Operational limits

Budgets, attempt limits, model limits, browser deadlines, compilation limits, domain allowlists, source limits, and global stop are configurable. `/admin` is an explicit UUID allowlist and returns aggregate data with hashed customer references. Cost values are estimates, and missing price configuration is disclosed. The framework and lockfile versions are pinned for reproducible installs.

Full hosted Supabase/Vault, live OAuth, Stripe Checkout, Browserbase, and live ATS behavior need configured staging verification. Production readiness is not inferred from local fixture tests. See PROGRESS.md for the current evidence and unsupported cases.
