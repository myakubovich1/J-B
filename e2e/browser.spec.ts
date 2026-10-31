import { test, expect, type APIRequestContext } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { entity, emptyProfile, type Application, type GeneratedResume } from "../src/lib/contracts";
import { executeApplication } from "../src/lib/browser";
import type { Workspace } from "../src/lib/workspace";

async function state(request: APIRequestContext): Promise<Workspace> {
  const result = await request.get("/api/workspace");
  expect(result.ok()).toBeTruthy();
  return result.json() as Promise<Workspace>;
}

test("conditional screening questions pause, preserve confirmed answers, and require a separate submission approval", async ({
  request,
}) => {
  const signup = await request.post("/api/auth", {
    data: {
      action: "signup",
      email: `conditional-${crypto.randomUUID()}@example.test`,
      name: "Casey Fixture",
      password: "Fixture-password-2026!",
    },
  });
  expect(signup.ok(), await signup.text()).toBeTruthy();
  const initial = await state(request);
  const profile = {
    ...initial.profile,
    legalName: "Casey Fixture",
    phone: "+1 212 555 0199",
    location: "New York, United States",
    headline: "Computer science student",
    skills: ["TypeScript", "Python", "React"],
    education: [
      {
        id: crypto.randomUUID(),
        school: "Fixture University",
        degree: "B.S.",
        major: "Computer Science",
        startDate: "2023",
        endDate: "2027",
      },
    ],
    eligibility: {
      country: "United States",
      workAuthorization: "yes",
      sponsorship: "yes",
      confirmedAt: new Date().toISOString(),
    },
  };
  const saved = await request.post("/api/workspace", { data: { action: "save_profile", profile } });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  const apply = await request.post("/api/workspace", {
    data: {
      action: "apply",
      url: `${process.env.APP_URL || "http://127.0.0.1:3000"}/fixture/employer/software-intern`,
    },
  });
  expect(apply.status()).toBe(202);
  await expect
    .poll(
      async () => {
        const current = await state(request);
        return current.approvals.some(
          (approval) =>
            approval.status === "pending" &&
            approval.kind === "question" &&
            approval.questions.some((question) => question.key === "sponsorship_details"),
        );
      },
      { timeout: 90000 },
    )
    .toBeTruthy();
  let current = await state(request);
  const question = current.approvals.find(
    (approval) => approval.status === "pending" && approval.kind === "question",
  )!;
  expect(current.applications[0].status).toBe("needs_input");
  expect(current.applications[0].receipt).toBeNull();
  expect(current.billing.used).toBe(0);
  const response = await request.post("/api/workspace", {
    data: {
      action: "resolve_approval",
      id: question.id,
      decision: "approve",
      answers: {
        sponsorship_details:
          "Test fixture answer: employer sponsorship would be required for this role.",
      },
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  await expect
    .poll(
      async () =>
        (await state(request)).approvals.some(
          (approval) => approval.kind === "submission" && approval.status === "pending",
        ),
      { timeout: 60000 },
    )
    .toBeTruthy();
  current = await state(request);
  expect(current.applications[0].answers.sponsorship_details).toContain("Test fixture answer");
  expect(
    current.answers.some(
      (answer) =>
        answer.key === "sponsorship_details" &&
        answer.confirmed &&
        answer.scope === current.applications[0].jobUrl,
    ),
  ).toBeTruthy();
  expect(current.applications[0].receipt).toBeNull();
  expect(current.applications[0].submissionStartedAt).toBeNull();
  const approval = current.approvals.find(
    (item) => item.kind === "submission" && item.status === "pending",
  )!;
  const stop = await request.post("/api/workspace", {
    data: { action: "resolve_approval", id: approval.id, decision: "deny", answers: {} },
  });
  expect(stop.ok(), await stop.text()).toBeTruthy();
  current = await state(request);
  expect(current.applications[0].status).toBe("withdrawn");
  expect(current.applications[0].receipt).toBeNull();
  expect(current.billing.used).toBe(0);
  expect(current.billing.reserved).toBe(0);
});

test("a real browser pauses at a login form without requesting credentials or clicking submit", async () => {
  const savedEnvironment = {
    APP_MODE: process.env.APP_MODE,
    APP_URL: process.env.APP_URL,
    ENABLE_TEST_EMPLOYER: process.env.ENABLE_TEST_EMPLOYER,
    DATA_DIR: process.env.DATA_DIR,
  };
  const directory = await mkdtemp(path.join(os.tmpdir(), "career-browser-login-"));
  let posts = 0;
  const server = createServer((request, response) => {
    if (request.method === "POST") posts++;
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(
      "<!doctype html><html><body><form data-testid='fixture-application' data-ready='true'><label>Email<input name='email'></label><label>Password<input type='password' name='password'></label><button type='submit'>Submit application</button></form></body></html>",
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  process.env.APP_MODE = "local";
  process.env.APP_URL = `http://127.0.0.1:${port}`;
  process.env.ENABLE_TEST_EMPLOYER = "true";
  process.env.DATA_DIR = directory;
  const url = `${process.env.APP_URL}/fixture/employer/login-required`;
  const profile = emptyProfile("fixture-login@example.test", "Login Fixture");
  const userId = crypto.randomUUID();
  const application: Application = {
    ...entity(userId),
    jobUrl: url,
    job: {
      url,
      canonicalUrl: url,
      externalId: "login-required",
      ats: "fixture",
      company: "Login fixture",
      title: "Test role",
      location: "United States",
      description: "A login-only test fixture.",
      requirements: [],
      salary: "",
      track: "general",
    },
    status: "ready",
    runId: crypto.randomUUID(),
    resumeId: null,
    matchScore: 80,
    matchReasons: [],
    answers: {},
    receipt: null,
    error: null,
    submittedAt: null,
    submissionStartedAt: null,
    approvalId: null,
  };
  // The login branch must stop before reading any document; this metadata is intentionally never dereferenced.
  const resume: GeneratedResume = {
    ...entity(userId),
    templateId: "jakes",
    track: "general",
    applicationId: application.id,
    title: "Login branch fixture",
    content: {
      name: profile.legalName,
      email: profile.email,
      phone: "",
      location: "",
      links: [],
      summary: "",
      education: [],
      experience: [],
      projects: [],
      skills: [],
    },
    texKey: "unused.tex",
    pdfKey: "must-not-read.pdf",
    validation: { valid: true, pages: 1, errors: [], warnings: [], textExtractable: true },
    sourceClaimIds: [],
  };
  let submissionRequested = false;
  try {
    const outcome = await executeApplication({
      application,
      profile,
      resume,
      approved: true,
      beforeSubmit: async () => {
        submissionRequested = true;
      },
    });
    expect(outcome.kind).toBe("needs_input");
    if (outcome.kind === "needs_input") {
      expect(outcome.login).toBe(true);
      expect(outcome.questions).toHaveLength(0);
      expect(outcome.message).toContain("requires login");
    }
    expect(submissionRequested).toBe(false);
    expect(posts).toBe(0);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    for (const [key, value] of Object.entries(savedEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
