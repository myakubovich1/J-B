import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyProfile,
  entity,
  type Application,
  type CandidateProfile,
  type Collection,
  type Job,
  type JobSource,
  type Records,
} from "../src/lib/contracts";

const memory = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../src/lib/store", () => ({
  getStore: () => ({
    list: async (table: string, userId: string) =>
      [...memory.entries()]
        .filter(([key]) => key.startsWith(`${table}:${userId}:`))
        .map(([, value]) => structuredClone(value)),
    get: async (table: string, id: string, userId: string) =>
      structuredClone(memory.get(`${table}:${userId}:${id}`) || null),
    save: async (table: string, row: { id: string; userId: string }) => {
      memory.set(`${table}:${row.userId}:${row.id}`, structuredClone(row));
      return row;
    },
    createIfAbsent: async (table: string, row: { id: string; userId: string }) => {
      const key = `${table}:${row.userId}:${row.id}`;
      if (!memory.has(key)) memory.set(key, structuredClone(row));
      return memory.get(key);
    },
  }),
}));
vi.mock("../src/lib/billing", () => ({ getPlanState: vi.fn() }));
vi.mock("../src/lib/agent", async (original) => ({
  ...(await original<typeof import("../src/lib/agent")>()),
  enqueueApplication: vi.fn(),
}));
vi.mock("../src/lib/integrations", () => ({ integrationToken: vi.fn() }));
vi.mock("../src/lib/jobs", async (original) => ({
  ...(await original<typeof import("../src/lib/jobs")>()),
  safeRead: vi.fn(),
  extractJob: vi.fn(),
  validateJobUrl: vi.fn(async (value: string) => new URL(value)),
}));
import { getStore } from "../src/lib/store";
import { getPlanState } from "../src/lib/billing";
import { enqueueApplication } from "../src/lib/agent";
import { integrationToken } from "../src/lib/integrations";
import { JobError, safeRead, extractJob } from "../src/lib/jobs";
import { ensureDiscoveryScheduled, githubSource, monitorSources } from "../src/lib/discovery";

const save = <K extends Collection>(table: K, row: Records[K]) => getStore().save(table, row);
const row = <K extends Collection>(table: K, id: string, userId = "user-a") =>
  getStore().get(table, id, userId);
const plan = {
  plan: "autonomous" as const,
  discovery: true,
  limit: 300,
  used: 0,
  reserved: 0,
  subscription: null,
};
const urlA = "https://jobs.lever.co/acme/role-a";
const urlB = "https://jobs.lever.co/acme/role-b";
const urlC = "https://jobs.lever.co/acme/role-c";
function job(url: string): Job {
  return {
    url,
    canonicalUrl: url,
    externalId: url.split("/").at(-1)!,
    ats: url.includes("greenhouse") ? "greenhouse" : "lever",
    company: "Acme",
    title: "Software engineering intern",
    location: "United States",
    description: "Build TypeScript applications.",
    requirements: ["TypeScript"],
    salary: "",
    track: "software",
  };
}
function result(data: unknown, etag?: string) {
  return {
    text: JSON.stringify(data),
    url: "https://api.github.com/fixture",
    status: 200,
    headers: etag ? { etag } : {},
  };
}
function github(urls: string[], sha = "revision-1") {
  return result({
    content: Buffer.from(urls.map((url) => `[Role](${url})`).join("\n")).toString("base64"),
    encoding: "base64",
    sha,
  });
}
async function seed(
  kind: JobSource["kind"] = "github",
  userId = "user-a",
  change?: (p: CandidateProfile) => void,
) {
  const profile = emptyProfile(`${userId}@example.test`, "Fixture Candidate");
  profile.skills = ["TypeScript"];
  profile.autonomy = {
    enabled: true,
    approvedAt: new Date().toISOString(),
    allowedDomains: [
      "jobs.lever.co",
      "jobs.eu.lever.co",
      "job-boards.greenhouse.io",
      "boards.greenhouse.io",
    ],
    maxPerDay: 20,
    minScore: 0,
  };
  profile.eligibility = {
    country: "United States",
    workAuthorization: "yes",
    sponsorship: "no",
    confirmedAt: new Date().toISOString(),
  };
  change?.(profile);
  await save("candidate_profiles", { ...entity(userId, "profile"), profile, version: 1 });
  const source: JobSource = {
    ...entity(userId, "source"),
    name: "Internship leads",
    url:
      kind === "github"
        ? "https://github.com/acme/internships"
        : kind === "greenhouse"
          ? "https://job-boards.greenhouse.io/acme"
          : "https://jobs.eu.lever.co/acme",
    kind,
    enabled: true,
    lastCheckedAt: null,
    lastRevision: null,
    error: null,
  };
  await save("job_sources", source);
  return source;
}
async function existingApplication(url: string, change: Partial<Application> = {}) {
  const app: Application = {
    ...entity("user-a"),
    jobUrl: url,
    job: job(url),
    status: "discovered",
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
    ...change,
  };
  await save("applications", app);
  return app;
}

beforeEach(() => {
  memory.clear();
  vi.clearAllMocks();
  vi.stubEnv("GLOBAL_EMERGENCY_STOP", "false");
  vi.stubEnv("EMERGENCY_STOP", "false");
  vi.stubEnv("MAX_DISCOVERY_JOBS_PER_RUN", "10");
  vi.mocked(getPlanState).mockResolvedValue({ ...plan });
  vi.mocked(extractJob).mockImplementation(async (url) => job(url));
  vi.mocked(integrationToken).mockImplementation(async (userId) => `fixture-token-${userId}`);
  vi.mocked(enqueueApplication).mockImplementation(async (userId, url) => {
    const app: Application = {
      ...entity(userId),
      jobUrl: url,
      job: null,
      status: "discovered",
      runId: crypto.randomUUID(),
      resumeId: null,
      matchScore: null,
      matchReasons: [],
      answers: {},
      receipt: null,
      error: null,
      submittedAt: null,
      submissionStartedAt: null,
      approvalId: null,
    };
    await save("applications", app);
    return app;
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("source lifecycle through supported API reads", () => {
  it("normalizes and deduplicates GitHub leads, verifies the employer, and avoids repeat queue entries", async () => {
    await seed();
    vi.mocked(safeRead).mockResolvedValue(
      github([
        `${urlA}?utm_source=github`,
        urlA,
        urlB,
        "https://evil.example/job",
        "https://jobs.lever.co/acme",
        "https://user:pass@jobs.lever.co/acme/secret",
      ]),
    );
    expect(await monitorSources("user-a")).toEqual({ checked: 1, queued: 2 });
    let source = (await row("job_sources", "source"))!;
    expect(source.health).toBe("healthy");
    expect(source.listingSnapshot?.map((item) => item.url)).toEqual([urlA, urlB]);
    expect(source.listingSnapshot?.every((item) => item.verification === "open")).toBe(true);
    expect(source.lastScan).toMatchObject({
      listed: 2,
      added: 2,
      queued: 2,
      verifiedOpen: 2,
      complete: true,
    });
    expect(await monitorSources("user-a")).toEqual({ checked: 1, queued: 0 });
    source = (await row("job_sources", "source"))!;
    expect(source.lastScan).toMatchObject({ added: 0, updated: 0, removed: 0, queued: 0 });
    expect(enqueueApplication).toHaveBeenCalledTimes(2);
    expect(extractJob).toHaveBeenCalledTimes(2);
  });

  it("tracks added, removed and reappearing source entries without claiming a removed employer job closed", async () => {
    await seed("github", "user-a", (p) => {
      p.autonomy.minScore = 100;
    });
    vi.mocked(safeRead)
      .mockResolvedValueOnce(github([urlA, urlB], "sha-one"))
      .mockResolvedValueOnce(github([urlA, urlC], "sha-two"))
      .mockResolvedValueOnce(github([urlA, urlB, urlC], "sha-three"));
    await monitorSources("user-a");
    await monitorSources("user-a");
    let source = (await row("job_sources", "source"))!;
    expect(source.lastRevision).toBe("sha-two");
    expect(source.lastScan).toMatchObject({ added: 1, removed: 1, queued: 0 });
    expect(source.listingSnapshot?.find((item) => item.url === urlB)).toMatchObject({
      verification: "open",
      removedAt: expect.any(String),
    });
    await monitorSources("user-a");
    source = (await row("job_sources", "source"))!;
    expect(source.listingSnapshot?.find((item) => item.url === urlB)?.removedAt).toBeNull();
    expect(source.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: urlB, kind: "removed" }),
        expect.objectContaining({ url: urlB, kind: "reopened" }),
      ]),
    );
  });

  it("records Greenhouse metadata updates with a content revision when ETags are absent", async () => {
    await seed("greenhouse", "user-a", (p) => {
      p.autonomy.minScore = 100;
    });
    const url = "https://job-boards.greenhouse.io/acme/jobs/123";
    const first = {
      id: 123,
      title: "Software intern",
      location: { name: "United States" },
      updated_at: "2026-10-01",
      absolute_url: url,
    };
    vi.mocked(safeRead)
      .mockResolvedValueOnce(result({ jobs: [first] }))
      .mockResolvedValueOnce(
        result({
          jobs: [{ ...first, title: "Platform software intern", updated_at: "2026-11-04" }],
        }),
      );
    await monitorSources("user-a");
    const revision = (await row("job_sources", "source"))!.lastRevision;
    await monitorSources("user-a");
    const source = (await row("job_sources", "source"))!;
    expect(source.lastRevision).not.toBe(revision);
    expect(source.lastScan).toMatchObject({ added: 0, updated: 1, removed: 0 });
    expect(source.changes?.filter((change) => change.kind === "updated")).toHaveLength(1);
    expect(safeRead).toHaveBeenCalledWith("https://boards-api.greenhouse.io/v1/boards/acme/jobs");
  });

  it("paginates the Lever EU feed before calculating removals", async () => {
    await seed("lever", "user-a", (p) => {
      p.autonomy.minScore = 100;
    });
    const items = Array.from({ length: 101 }, (_, i) => ({
      id: `role-${i}`,
      hostedUrl: `https://jobs.eu.lever.co/acme/role-${i}`,
      text: "Software intern",
      categories: { location: "United States" },
    }));
    vi.mocked(safeRead).mockImplementation(async (url) =>
      result(
        new URL(url).searchParams.get("skip") === "100" ? items.slice(100) : items.slice(0, 100),
      ),
    );
    await monitorSources("user-a");
    expect(safeRead).toHaveBeenCalledWith(
      "https://api.eu.lever.co/v0/postings/acme?mode=json&skip=0&limit=100",
    );
    expect(safeRead).toHaveBeenCalledWith(
      "https://api.eu.lever.co/v0/postings/acme?mode=json&skip=100&limit=100",
    );
    const source = (await row("job_sources", "source"))!;
    expect(source.listingSnapshot).toHaveLength(101);
    expect(source.lastScan?.complete).toBe(true);
  });
  it("detects changed employer facts even when a GitHub source revision is unchanged", async () => {
    await seed("github", "user-a", (p) => {
      p.autonomy.minScore = 100;
    });
    vi.mocked(safeRead).mockResolvedValue(github([urlA], "unchanged-sha"));
    await monitorSources("user-a");
    vi.mocked(extractJob).mockResolvedValue({
      ...job(urlA),
      description: "Updated employer requirements for this role.",
    });
    await monitorSources("user-a");
    const source = (await row("job_sources", "source"))!;
    expect(source.lastRevision).toBe("unchanged-sha");
    expect(source.lastScan?.updated).toBe(1);
  });

  it("keeps missing entries when the source scan is truncated", async () => {
    const source = await seed("greenhouse", "user-a", (p) => {
      p.autonomy.minScore = 100;
    });
    const oldUrl = "https://job-boards.greenhouse.io/acme/jobs/9999";
    await save("job_sources", {
      ...source,
      listingSnapshot: [
        {
          url: oldUrl,
          fingerprint: "old",
          title: "Prior role",
          company: "Acme",
          firstSeenAt: source.createdAt,
          lastSeenAt: source.createdAt,
          removedAt: null,
          verification: "unverified",
          verifiedAt: null,
        },
      ],
    });
    vi.mocked(safeRead).mockResolvedValue(
      result({
        jobs: Array.from({ length: 201 }, (_, i) => ({
          id: i + 1,
          title: "Software intern",
          absolute_url: `https://job-boards.greenhouse.io/acme/jobs/${i + 1}`,
        })),
      }),
    );
    await monitorSources("user-a");
    const updated = (await row("job_sources", "source"))!;
    expect(updated.health).toBe("partial");
    expect(updated.lastScan).toMatchObject({ listed: 200, complete: false, removed: 0 });
    expect(updated.listingSnapshot?.find((item) => item.url === oldUrl)?.removedAt).toBeNull();
  });

  it.each(["api_failure", "malformed_feed", "invalid_encoding"])(
    "preserves the last successful inventory on %s",
    async (failure) => {
      await seed();
      vi.mocked(safeRead).mockResolvedValueOnce(github([urlA]));
      await monitorSources("user-a");
      const previous = (await row("job_sources", "source"))!;
      if (failure === "api_failure")
        vi.mocked(safeRead).mockRejectedValueOnce(new Error("untrusted-provider-secret"));
      else
        vi.mocked(safeRead).mockResolvedValueOnce(
          result(
            failure === "malformed_feed"
              ? { error: "bad response" }
              : { content: "??bad encoding", encoding: "base64" },
          ),
        );
      await monitorSources("user-a");
      const failed = (await row("job_sources", "source"))!;
      expect(failed.health).toBe("error");
      expect(failed.lastRevision).toBe(previous.lastRevision);
      expect(failed.lastSuccessfulAt).toBe(previous.lastSuccessfulAt);
      expect(failed.listingSnapshot).toEqual(previous.listingSnapshot);
      expect(failed.error).not.toContain("untrusted-provider-secret");
    },
  );

  it("distinguishes verified absent postings from restricted or temporarily unavailable reads", async () => {
    await seed();
    vi.mocked(safeRead).mockResolvedValue(github([urlA, urlB, urlC]));
    vi.mocked(extractJob).mockImplementation(async (url) => {
      throw new JobError(
        `The job posting returned HTTP ${url === urlA ? 410 : url === urlB ? 403 : 503}.`,
        url === urlC ? "upstream_unavailable" : "job_closed",
      );
    });
    await monitorSources("user-a");
    const source = (await row("job_sources", "source"))!;
    expect(source.listingSnapshot?.find((item) => item.url === urlA)?.verification).toBe("closed");
    expect(source.listingSnapshot?.find((item) => item.url === urlB)?.verification).toBe(
      "unavailable",
    );
    expect(source.lastScan).toMatchObject({ closed: 1, unavailable: 2, queued: 0 });
    expect(enqueueApplication).not.toHaveBeenCalled();
  });
});

describe("consent, tenancy and bounded scheduling", () => {
  it.each(["during_feed", "during_verification"])(
    "preserves a source pause %s and never enqueues afterward",
    async (when) => {
      await seed();
      const pause = async () => {
        const source = (await row("job_sources", "source"))!;
        await save("job_sources", { ...source, enabled: false });
      };
      vi.mocked(safeRead).mockImplementation(async () => {
        if (when === "during_feed") await pause();
        return github([urlA]);
      });
      vi.mocked(extractJob).mockImplementation(async (url) => {
        await pause();
        return job(url);
      });
      await monitorSources("user-a");
      expect(await row("job_sources", "source")).toMatchObject({
        enabled: false,
        health: "paused",
      });
      expect(enqueueApplication).not.toHaveBeenCalled();
      if (when === "during_feed") expect(extractJob).not.toHaveBeenCalled();
    },
  );

  it("rechecks standing consent after employer verification", async () => {
    await seed();
    vi.mocked(safeRead).mockResolvedValue(github([urlA]));
    vi.mocked(extractJob).mockImplementation(async (url) => {
      const record = (await row("candidate_profiles", "profile"))!;
      record.profile.autonomy.enabled = false;
      await save("candidate_profiles", record);
      return job(url);
    });
    await monitorSources("user-a");
    expect(enqueueApplication).not.toHaveBeenCalled();
    expect((await row("job_sources", "source"))?.listingSnapshot?.[0].verification).toBe("open");
  });
  it("rechecks a tightened daily limit after employer verification", async () => {
    await seed();
    await existingApplication(urlB, {
      status: "submitted",
      submissionStartedAt: new Date().toISOString(),
    });
    vi.mocked(safeRead).mockResolvedValue(github([urlA]));
    vi.mocked(extractJob).mockImplementation(async (url) => {
      const record = (await row("candidate_profiles", "profile"))!;
      record.profile.autonomy.maxPerDay = 1;
      await save("candidate_profiles", record);
      return job(url);
    });
    await monitorSources("user-a");
    expect(enqueueApplication).not.toHaveBeenCalled();
    expect((await row("job_sources", "source"))?.listingSnapshot?.[0].verification).toBe("open");
  });

  it.each(["daily", "pending", "quota"])(
    "does not spend verification work past the %s bound",
    async (bound) => {
      await seed("github", "user-a", (p) => {
        p.autonomy.maxPerDay = 1;
      });
      vi.mocked(safeRead).mockResolvedValue(github([urlA]));
      if (bound === "daily")
        await existingApplication(urlB, {
          status: "submission_unverified",
          submissionStartedAt: new Date().toISOString(),
        });
      if (bound === "pending") await existingApplication(urlB, { status: "needs_input" });
      if (bound === "quota")
        vi.mocked(getPlanState).mockResolvedValue({ ...plan, used: plan.limit });
      await monitorSources("user-a");
      expect(extractJob).not.toHaveBeenCalled();
      expect(enqueueApplication).not.toHaveBeenCalled();
    },
  );

  it("applies a per-run queue cap while retaining all observed leads", async () => {
    await seed();
    vi.stubEnv("MAX_DISCOVERY_JOBS_PER_RUN", "1");
    vi.mocked(safeRead).mockResolvedValue(github([urlA, urlB]));
    expect(await monitorSources("user-a")).toEqual({ checked: 1, queued: 1 });
    expect((await row("job_sources", "source"))?.listingSnapshot).toHaveLength(2);
    expect(extractJob).toHaveBeenCalledTimes(1);
  });

  it("never borrows another tenant's GitHub connection or application history", async () => {
    await seed("github", "user-a");
    await seed("github", "user-b");
    for (const userId of ["user-a", "user-b"])
      await save("integration_connections", {
        ...entity(userId),
        provider: "github",
        status: "connected",
        account: userId,
        scopes: ["repo"],
        secretRef: `fixture-ref-${userId}`,
      });
    vi.mocked(safeRead).mockResolvedValue(github([urlA]));
    await monitorSources("user-a");
    await monitorSources("user-b");
    expect(safeRead).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("api.github.com/repos/acme"),
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer fixture-token-user-a",
        },
      },
    );
    expect(safeRead).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("api.github.com/repos/acme"),
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer fixture-token-user-b",
        },
      },
    );
    expect(enqueueApplication).toHaveBeenNthCalledWith(1, "user-a", urlA);
    expect(enqueueApplication).toHaveBeenNthCalledWith(2, "user-b", urlA);
    expect(JSON.stringify(await row("job_sources", "source", "user-a"))).not.toContain(
      "fixture-token",
    );
  });

  it("does not replace a source configuration edited while its API read was in flight", async () => {
    await seed();
    vi.mocked(safeRead).mockImplementation(async () => {
      const source = (await row("job_sources", "source"))!;
      await save("job_sources", { ...source, url: "https://github.com/acme/new-source" });
      return github([urlA]);
    });
    await monitorSources("user-a");
    expect(await row("job_sources", "source")).toMatchObject({
      url: "https://github.com/acme/new-source",
      lastRevision: null,
      lastCheckedAt: null,
    });
    expect(enqueueApplication).not.toHaveBeenCalled();
  });

  it("enforces paid standing consent before reading any source and honors emergency stop", async () => {
    await seed();
    vi.mocked(getPlanState).mockResolvedValue({ ...plan, plan: "free", discovery: false });
    await expect(monitorSources("user-a")).rejects.toMatchObject({ code: "discovery_disabled" });
    expect(safeRead).not.toHaveBeenCalled();
    vi.mocked(getPlanState).mockResolvedValue({ ...plan });
    vi.stubEnv("GLOBAL_EMERGENCY_STOP", "true");
    expect(await monitorSources("user-a")).toEqual({ checked: 0, queued: 0 });
    expect(safeRead).not.toHaveBeenCalled();
  });

  it("schedules one initial run and can schedule again after a persisted pause and resume", async () => {
    await seed();
    await Promise.all([ensureDiscoveryScheduled("user-a"), ensureDiscoveryScheduled("user-a")]);
    let runs = await getStore().list("agent_runs", "user-a");
    expect(runs).toHaveLength(1);
    await save("agent_runs", { ...runs[0], status: "completed" });
    const source = (await row("job_sources", "source"))!;
    await save("job_sources", { ...source, enabled: false });
    await ensureDiscoveryScheduled("user-a");
    expect(await getStore().list("agent_runs", "user-a")).toHaveLength(1);
    await save("job_sources", { ...source, enabled: true, updatedAt: "2026-11-04T12:00:00Z" });
    await ensureDiscoveryScheduled("user-a");
    runs = await getStore().list("agent_runs", "user-a");
    expect(runs).toHaveLength(2);
  });

  it("rejects credential-bearing or incomplete GitHub source URLs", () => {
    for (const url of [
      "https://token@github.com/acme/jobs",
      "http://github.com/acme/jobs",
      "https://github.com/acme/jobs/blob/main",
    ])
      expect(() => githubSource(url)).toThrow();
  });
});
