// Concurrency/load rehearsal against a running local stack that serves the test employer.
// Each virtual user signs up, saves a profile, compiles a resume, prepares an application in
// a real browser, approves it, and waits for the fixture's verified receipt. It never targets
// a real employer: the run aborts unless the stack serves the local fixture.
//
//   LOAD_BASE_URL=http://127.0.0.1:3200 LOAD_USERS=8 node scripts/load-test.mjs
import { writeFile } from "node:fs/promises";

const base = new URL(process.env.LOAD_BASE_URL || "http://127.0.0.1:3200");
const users = Math.max(1, Number(process.env.LOAD_USERS || 8));
const deadline = Date.now() + Number(process.env.LOAD_TIMEOUT_MS || 900000);
if (!["127.0.0.1", "localhost"].includes(base.hostname) && process.env.LOAD_ALLOW_REMOTE !== "1")
  throw new Error("Refusing a non-loopback target. Set LOAD_ALLOW_REMOTE=1 for a staging stack.");
const fixture = new URL("/fixture/employer/software-intern", base).href;
if (!(await fetch(fixture)).ok)
  throw new Error("The target does not serve the local test employer; refusing to run.");

class Client {
  cookies = new Map();
  async call(path, { method = "GET", body } = {}) {
    const response = await fetch(new URL(path, base), {
      method,
      redirect: "manual",
      headers: {
        Origin: base.origin,
        "Content-Type": "application/json",
        Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(";");
      const index = pair.indexOf("=");
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(`${method} ${path} ${response.status}: ${data?.error ?? ""}`);
    return data;
  }
  workspace() {
    return this.call("/api/workspace");
  }
  async until(check, label) {
    while (Date.now() < deadline) {
      const state = await this.workspace();
      const failed = state.applications?.find((a) => a.status === "failed");
      if (failed) throw new Error(`${label}: application failed: ${failed.error}`);
      const value = check(state);
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`${label}: timed out`);
  }
}

async function virtualUser(index) {
  const client = new Client();
  const timings = {};
  const lap = async (name, task) => {
    const started = Date.now();
    const value = await task();
    timings[name] = Date.now() - started;
    return value;
  };
  const started = Date.now();
  try {
    await lap("signup", () =>
      client.call("/api/auth", {
        method: "POST",
        body: {
          action: "signup",
          email: `load-${index}-${crypto.randomUUID()}@example.test`,
          name: `Load User ${index}`,
          password: "Load-fixture-password-2026!",
        },
      }),
    );
    const { profile } = await client.workspace();
    await lap("profile", () =>
      client.call("/api/workspace", {
        method: "POST",
        body: {
          action: "save_profile",
          profile: {
            ...profile,
            legalName: `Load User ${index}`,
            phone: "+1 212 555 0100",
            location: "New York, NY",
            skills: ["TypeScript", "Python", "React"],
            education: [
              {
                id: crypto.randomUUID(),
                school: "Fixture University",
                degree: "BS",
                major: "Computer Science",
                startDate: "2023",
                endDate: "2027",
              },
            ],
            eligibility: {
              country: "United States",
              workAuthorization: "yes",
              sponsorship: "no",
              confirmedAt: new Date().toISOString(),
            },
          },
        },
      }),
    );
    await lap("resume", async () => {
      await client.call("/api/workspace", {
        method: "POST",
        body: { action: "generate_resume", templateId: "jakes", track: "software" },
      });
      await client.until((s) => s.resumes.some((r) => r.validation.valid), "resume");
    });
    const approval = await lap("prepare", async () => {
      await client.call("/api/workspace", { method: "POST", body: { action: "apply", url: fixture } });
      return client.until(
        (s) => s.approvals.find((a) => a.kind === "submission" && a.status === "pending"),
        "prepare",
      );
    });
    const application = await lap("submit", async () => {
      await client.call("/api/workspace", {
        method: "POST",
        body: { action: "resolve_approval", id: approval.id, decision: "approve", answers: {} },
      });
      return client.until(
        (s) => s.applications.find((a) => a.status === "submitted" && a.receipt?.verifiedAt),
        "submit",
      );
    });
    await client.call("/api/workspace", { method: "POST", body: { action: "apply", url: fixture } });
    const final = await client.workspace();
    const invariants = {
      oneApplication: final.applications.length === 1,
      oneBilledSubmission: final.billing.used === 1,
      receiptUnchanged: final.applications[0]?.receipt?.url === application.receipt.url,
    };
    if (!Object.values(invariants).every(Boolean))
      throw new Error(`invariant violated: ${JSON.stringify(invariants)}`);
    return { ok: true, totalMs: Date.now() - started, timings, usage: final.usage };
  } catch (error) {
    return { ok: false, totalMs: Date.now() - started, timings, error: String(error.message) };
  }
}

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const startedAt = Date.now();
const results = await Promise.all(Array.from({ length: users }, (_, i) => virtualUser(i)));
const passed = results.filter((r) => r.ok);
const stages = ["signup", "profile", "resume", "prepare", "submit"];
const summary = {
  target: base.origin,
  users,
  wallClockMs: Date.now() - startedAt,
  succeeded: passed.length,
  failed: results.length - passed.length,
  failureRate: (results.length - passed.length) / results.length,
  endToEndMs: {
    p50: percentile(passed.map((r) => r.totalMs), 50),
    p95: percentile(passed.map((r) => r.totalMs), 95),
    max: percentile(passed.map((r) => r.totalMs), 100),
  },
  stageMs: Object.fromEntries(
    stages.map((stage) => {
      const values = passed.map((r) => r.timings[stage]).filter((v) => v !== undefined);
      return [stage, { p50: percentile(values, 50), p95: percentile(values, 95) }];
    }),
  ),
  recordedUsage: {
    attempts: passed.reduce((n, r) => n + r.usage.attempts, 0),
    retries: passed.reduce((n, r) => n + r.usage.retries, 0),
    browserMinutes: passed.reduce((n, r) => n + r.usage.browserSeconds, 0) / 60,
    modelTokens: passed.reduce((n, r) => n + r.usage.inputTokens + r.usage.outputTokens, 0),
    costUsd: passed.reduce((n, r) => n + r.usage.costUsd, 0),
    costConfigured: passed.every((r) => r.usage.costConfigured),
  },
  errors: results.filter((r) => !r.ok).map((r) => r.error),
};
console.log(JSON.stringify(summary, null, 2));
if (process.env.LOAD_REPORT) await writeFile(process.env.LOAD_REPORT, JSON.stringify(summary, null, 2));
process.exit(summary.failed ? 1 : 0);
