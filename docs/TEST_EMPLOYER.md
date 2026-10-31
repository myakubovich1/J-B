# Local employer fixture

Enable only in local development:

```sh
APP_MODE=local ENABLE_TEST_EMPLOYER=true npm run dev
APP_MODE=local ENABLE_TEST_EMPLOYER=true npm run worker
```

Use the same `APP_URL` and `DATA_DIR` in both processes. The default origin is `http://127.0.0.1:3000`. Install Playwright Chromium (`npx playwright install chromium`), Tectonic, and Poppler first. The test employer is disabled under `NODE_ENV=production`, including `next start`; test with `next dev`.

The posting is `/fixture/employer/software-intern`. It exposes real JSON-LD job metadata. Its application form uploads a PDF through ordinary browser form submission. Sponsorship `yes` reveals a mandatory question for the agent to ask the candidate. Unknown answers are never invented. The form does not create employer accounts, send email, or send an application outside this local server.

`POST /api/fixture/apply` validates required fields, confirmed yes/no answers, optional conditional details, PDF signature, PDF parsing, and an external application UUID. A separate SQLite file at `DATA_DIR/fixture.db` records the unique receipt UUID, application UUID, PDF SHA-256, byte count, submitted field names, and timestamp. It retains neither candidate field values nor the uploaded resume bytes. Duplicate application UUIDs return the same receipt only when the resume hash matches; conflicting resubmissions fail.

`/fixture/confirmation/:receiptId` renders evidence only for an actual persisted submission. It exposes no applicant name, email, phone, or eligibility details. The browser worker verifies this page and saves a screenshot in the candidate's private artifact storage.

The Playwright test `e2e/core.spec.ts` exercises registration and profile editing through the UI, template switching and compilation, PDF preview, job URL queueing, explicit approval, actual worker browser submission, receipt evidence, tracking, and duplicate prevention. Run it with the parent Playwright configuration, app, and worker active:

```sh
npm run test:e2e
```

Tests create generated fixture identities in test data only. No production path seeds demo users, applications, or receipts. Do not run submitting E2E flows against real employer URLs.
