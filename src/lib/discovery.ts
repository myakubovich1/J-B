import { entity, type CandidateProfile, type JobSource } from "./contracts";
import { getStore } from "./store";
import { getPlanState } from "./billing";
import { enqueueApplication } from "./agent";
import {
  canonicalJobUrl,
  detectAts,
  extractJob,
  JobError,
  matchJob,
  safeRead,
  validateJobUrl,
} from "./jobs";
import { integrationToken } from "./integrations";

const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

export function githubSource(input: string): {
  owner: string;
  repo: string;
  path: string;
  ref: string | null;
} {
  const url = new URL(input),
    parts = url.pathname.split("/").filter(Boolean);
  if (
    url.hostname !== "github.com" ||
    parts.length < 2 ||
    !/^[\w.-]+$/.test(parts[0]) ||
    !/^[\w.-]+$/.test(parts[1])
  )
    throw new JobError("Use a GitHub repository or file URL.", "invalid_source");
  if (parts.length > 2 && parts[2] !== "blob")
    throw new JobError("Use the repository root or a GitHub file URL.", "invalid_source");
  return {
    owner: parts[0],
    repo: parts[1].replace(/\.git$/, ""),
    ref: parts[2] === "blob" ? parts[3] : null,
    path: parts[2] === "blob" ? parts.slice(4).join("/") : "README.md",
  };
}

export function postingLinks(markdown: string): string[] {
  const candidates = markdown.match(/https:\/\/[^\s<>)\]"']+/g) || [];
  return [
    ...new Set(
      candidates
        .map((value) => value.replace(/&amp;/g, "&"))
        .filter((value) => {
          try {
            return ["greenhouse", "lever"].includes(detectAts(value));
          } catch {
            return false;
          }
        })
        .map(canonicalJobUrl),
    ),
  ].slice(0, 100);
}

async function listings(source: JobSource): Promise<{ urls: string[]; revision: string }> {
  if (source.kind === "github") {
    const parsed = githubSource(source.url),
      path = parsed.path.split("/").map(encodeURIComponent).join("/");
    const connection = (await getStore().list("integration_connections", source.userId)).find(
      (c) => c.provider === "github" && c.status === "connected",
    );
    const token = connection?.secretRef ? await integrationToken(source.userId, connection) : null;
    const result = await safeRead(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${path}${parsed.ref ? `?ref=${encodeURIComponent(parsed.ref)}` : ""}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    const data = object(JSON.parse(result.text));
    if (typeof data.content !== "string" || data.encoding !== "base64")
      throw new JobError(
        "The GitHub source must be a supported text file below the API size limit.",
        "invalid_source",
      );
    const text = Buffer.from(data.content, "base64").toString("utf8");
    return {
      urls: postingLinks(text),
      revision: typeof data.sha === "string" ? data.sha : result.headers.etag || "",
    };
  }
  const checked = await validateJobUrl(source.url);
  const parts = checked.pathname.split("/").filter(Boolean);
  if (
    source.kind === "greenhouse" &&
    detectAts(checked.href) === "greenhouse" &&
    parts[0] &&
    /^[\w-]+$/.test(parts[0])
  ) {
    const result = await safeRead(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(parts[0])}/jobs`,
    );
    const data = object(JSON.parse(result.text));
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    return {
      urls: jobs
        .map((job) => object(job).absolute_url)
        .filter((url): url is string => typeof url === "string")
        .slice(0, 100),
      revision: result.headers.etag || new Date().toISOString().slice(0, 10),
    };
  }
  if (source.kind === "lever" && detectAts(checked.href) === "lever" && parts[0]) {
    const host = checked.hostname.includes(".eu.") ? "api.eu.lever.co" : "api.lever.co";
    const result = await safeRead(
      `https://${host}/v0/postings/${encodeURIComponent(parts[0])}?mode=json`,
    );
    const data: unknown = JSON.parse(result.text);
    const jobs = Array.isArray(data) ? data : [];
    return {
      urls: jobs
        .map((job) => object(job).hostedUrl)
        .filter((url): url is string => typeof url === "string")
        .slice(0, 100),
      revision: result.headers.etag || new Date().toISOString().slice(0, 10),
    };
  }
  throw new JobError("This source does not match its configured provider.", "invalid_source");
}

export function discoveryEnabled(profile: CandidateProfile, plan: { discovery: boolean }): boolean {
  return (
    plan.discovery &&
    profile.autonomy.enabled &&
    !!profile.autonomy.approvedAt &&
    profile.autonomy.allowedDomains.length > 0 &&
    !!profile.eligibility.confirmedAt
  );
}

export async function ensureDiscoveryScheduled(userId: string): Promise<void> {
  const store = getStore(),
    plan = await getPlanState(userId),
    profileRecord = (await store.list("candidate_profiles", userId))[0],
    profile = profileRecord?.profile;
  if (
    !profile ||
    !discoveryEnabled(profile, plan) ||
    process.env.GLOBAL_EMERGENCY_STOP === "true" ||
    process.env.EMERGENCY_STOP === "true"
  )
    return;
  if (!(await store.list("job_sources", userId)).some((source) => source.enabled)) return;
  if (
    (await store.list("agent_runs", userId)).some(
      (run) => run.kind === "discovery" && ["queued", "running"].includes(run.status),
    )
  )
    return;
  // A deterministic initial run prevents duplicate queue entries across concurrent API requests.
  const sourceRevision = (await store.list("job_sources", userId)).map((s) => ({
    id: s.id,
    enabled: s.enabled,
    updatedAt: s.updatedAt,
  }));
  const id = (await import("./agent")).stableHash({
    userId,
    kind: "discovery",
    version: profileRecord?.version,
    sources: sourceRevision,
  });
  const uuid = `${id.slice(0, 8)}-${id.slice(8, 12)}-4${id.slice(13, 16)}-a${id.slice(17, 20)}-${id.slice(20, 32)}`;
  await store.createIfAbsent("agent_runs", {
    ...entity(userId, uuid),
    applicationId: "",
    kind: "discovery",
    status: "queued",
    stage: "reading_job",
    attempts: 0,
    maxAttempts: 2,
    leaseUntil: null,
    nextAttemptAt: new Date().toISOString(),
    error: null,
    approved: false,
    submitted: false,
  });
}

export async function monitorSources(userId: string): Promise<{ checked: number; queued: number }> {
  const store = getStore(),
    plan = await getPlanState(userId),
    profile = (await store.list("candidate_profiles", userId))[0]?.profile;
  if (!profile || !discoveryEnabled(profile, plan))
    throw new JobError(
      "Discovery requires an active Autonomous plan and explicit standing authorization with allowed employer domains.",
      "discovery_disabled",
    );
  if (process.env.GLOBAL_EMERGENCY_STOP === "true" || process.env.EMERGENCY_STOP === "true")
    return { checked: 0, queued: 0 };
  const sources = (await store.list("job_sources", userId)).filter((source) => source.enabled);
  let checked = 0,
    queued = 0;
  for (const source of sources) {
    try {
      const result = await listings(source);
      checked++;
      // GitHub additions are leads only. Every candidate posting is verified against the employer source below.
      {
        const existing = new Set(
          (await store.list("applications", userId)).map((application) => application.jobUrl),
        );
        for (const url of result.urls) {
          if (process.env.GLOBAL_EMERGENCY_STOP === "true" || process.env.EMERGENCY_STOP === "true")
            break;
          const currentProfile = (await store.list("candidate_profiles", userId))[0]?.profile;
          if (!(await store.get("job_sources", source.id, userId))?.enabled) break;
          if (!currentProfile || !discoveryEnabled(currentProfile, await getPlanState(userId)))
            break;
          if (
            queued >= currentProfile.autonomy.maxPerDay ||
            queued >= Number(process.env.MAX_DISCOVERY_JOBS_PER_RUN || 10)
          )
            break;
          if (
            !currentProfile.autonomy.allowedDomains.includes(new URL(url).hostname) ||
            existing.has(canonicalJobUrl(url))
          )
            continue;
          try {
            const job = await extractJob(url, userId),
              match = matchJob(currentProfile, job);
            if (
              match.blocked ||
              match.needsConfirmation ||
              match.score < currentProfile.autonomy.minScore
            )
              continue;
            const app = await enqueueApplication(userId, url);
            await store.save("applications", {
              ...app,
              job,
              matchScore: match.score,
              matchReasons: match.reasons,
            });
            existing.add(canonicalJobUrl(url));
            queued++;
          } catch (error) {
            await store.save("agent_actions", {
              ...entity(userId),
              action: "discovery_posting_skipped",
              applicationId: null,
              details: {
                sourceId: source.id,
                category: error instanceof JobError ? error.code : "invalid_posting",
              },
            });
          }
        }
      }
      const latest = await store.get("job_sources", source.id, userId);
      if (latest)
        await store.save("job_sources", {
          ...latest,
          lastCheckedAt: new Date().toISOString(),
          lastRevision: result.revision,
          error: null,
        });
    } catch (error) {
      const latest = await store.get("job_sources", source.id, userId);
      if (latest)
        await store.save("job_sources", {
          ...latest,
          lastCheckedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : "Source monitoring failed.",
        });
    }
  }
  return { checked, queued };
}
