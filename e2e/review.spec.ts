import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { entity, emptyProfile, type Application, type GeneratedResume } from "../src/lib/contracts";
import { executeApplication, questionContext } from "../src/lib/browser";
import { writeArtifact } from "../src/lib/storage";

test("changed portal questions and form fields require fresh input and review before any submit", async () => {
  const names = ["APP_MODE", "APP_URL", "ENABLE_TEST_EMPLOYER", "DATA_DIR"] as const;
  const savedEnvironment = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const directory = await mkdtemp(path.join(os.tmpdir(), "career-form-review-"));
  let question = "Are you willing to relocate?";
  let extraField = false;
  let preselectedDisclosure = false;
  let posts = 0;
  const server = createServer((request, response) => {
    request.resume();
    response.writeHead(200, { "Content-Type": "text/html" });
    if (request.method === "POST") {
      posts++;
      response.end(
        "<!doctype html><html><body><div data-testid='confirmation'>Thank you. Application received. Confirmation receipt: review-fixture.</div></body></html>",
      );
      return;
    }
    response.end(`<!doctype html><html><body>
      <form method="POST" enctype="multipart/form-data" data-testid="fixture-application" data-ready="true">
        <label>Email address<input name="email" type="email" required></label>
        <label>${question}<input name="screening" required></label>
        ${extraField ? '<label>Additional information (optional)<input name="extra"></label>' : ""}
        ${preselectedDisclosure ? '<label>Allow marketing messages<input type="checkbox" name="marketing" checked></label>' : ""}
        <label>Resume<input type="file" name="resume" required></label>
        <button type="submit">Submit application</button>
      </form></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.APP_MODE = "local";
  process.env.APP_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ENABLE_TEST_EMPLOYER = "true";
  process.env.DATA_DIR = directory;
  const url = `${process.env.APP_URL}/fixture/employer/form-review`;
  const userId = crypto.randomUUID();
  const profile = emptyProfile("review@example.test", "Review Fixture");
  const application: Application = {
    ...entity(userId),
    jobUrl: url,
    job: {
      url,
      canonicalUrl: url,
      externalId: "form-review",
      ats: "fixture",
      company: "Review fixture",
      title: "Test role",
      location: "United States",
      description: "A mutable form fixture.",
      requirements: [],
      salary: "",
      track: "general",
    },
    status: "ready",
    runId: crypto.randomUUID(),
    resumeId: null,
    matchScore: 80,
    matchReasons: [],
    answers: { screening: "yes" },
    answerContexts: { screening: questionContext({ label: question }) },
    receipt: null,
    error: null,
    submittedAt: null,
    submissionStartedAt: null,
    approvalId: null,
  };
  // This isolated browser contract test checks upload/review behavior. Real PDF compilation and
  // validation are covered by the compiler suite and complete application E2E test.
  const resume: GeneratedResume = {
    ...entity(userId),
    templateId: "jakes",
    track: "general",
    applicationId: application.id,
    title: "Review fixture",
    texKey: "unused.tex",
    pdfKey: null,
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
    validation: { valid: true, pages: 1, errors: [], warnings: [], textExtractable: true },
    sourceClaimIds: [],
  };
  let submissionChecks = 0;
  try {
    resume.pdfKey = await writeArtifact(
      userId,
      "fixture.pdf",
      Buffer.from("%PDF-1.4\n% browser upload fixture"),
      "application/pdf",
    );
    const prepared = await executeApplication({ application, profile, resume, approved: false });
    expect(prepared.kind).toBe("prepared");
    if (prepared.kind !== "prepared") throw new Error("Fixture preparation failed");
    application.answers = { ...application.answers, ...prepared.fields };
    application.answerContexts = prepared.answerContexts;
    application.formSnapshotHash = prepared.formSnapshotHash;
    const attempt = () =>
      executeApplication({
        application,
        profile,
        resume,
        approved: true,
        reviewHash: prepared.formSnapshotHash,
        beforeSubmit: async () => {
          submissionChecks++;
        },
      });

    question = "Are you willing to travel every week?";
    const changedQuestion = await attempt();
    expect(changedQuestion.kind).toBe("needs_input");
    if (changedQuestion.kind === "needs_input")
      expect(changedQuestion.questions).toContainEqual({ key: "screening", label: question });
    expect(submissionChecks).toBe(0);
    expect(posts).toBe(0);

    question = "Are you willing to relocate?";
    extraField = true;
    const changedForm = await attempt();
    expect(changedForm.kind).toBe("prepared");
    if (changedForm.kind === "prepared")
      expect(changedForm.formSnapshotHash).not.toBe(prepared.formSnapshotHash);
    expect(submissionChecks).toBe(0);
    expect(posts).toBe(0);

    extraField = false;
    preselectedDisclosure = true;
    const unreviewedDisclosure = await attempt();
    expect(unreviewedDisclosure.kind).toBe("needs_input");
    if (unreviewedDisclosure.kind === "needs_input")
      expect(unreviewedDisclosure.questions).toContainEqual({
        key: "marketing",
        label: "Allow marketing messages",
        options: ["yes", "no"],
      });
    expect(submissionChecks).toBe(0);
    expect(posts).toBe(0);

    preselectedDisclosure = false;
    const unchanged = await attempt();
    expect(unchanged.kind).toBe("submitted");
    expect(submissionChecks).toBe(1);
    expect(posts).toBe(1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    for (const name of names) {
      if (savedEnvironment[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnvironment[name];
    }
    await rm(directory, { recursive: true, force: true });
  }
});
