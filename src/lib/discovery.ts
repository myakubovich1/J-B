import { createHash } from "node:crypto";
import { entity, type Application, type CandidateProfile, type JobSource } from "./contracts";
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
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.hostname !== "github.com" ||
    parts.length < 2 ||
    !/^[\w.-]+$/.test(parts[0]) ||
    !/^[\w.-]+$/.test(parts[1])
  )
    throw new JobError("Use a GitHub repository or file URL.", "invalid_source");
  if (parts.length > 2 && parts[2] !== "blob")
    throw new JobError("Use the repository root or a GitHub file URL.", "invalid_source");
  if (parts[2] === "blob" && (parts.length < 5 || !parts[3]))
    throw new JobError(
      "Choose a complete GitHub file URL including its branch and path.",
      "invalid_source",
    );
  return {
    owner: parts[0],
    repo: parts[1].replace(/\.git$/, ""),
    ref: parts[2] === "blob" ? parts[3] : null,
    path: parts[2] === "blob" ? parts.slice(4).join("/") : "README.md",
  };
}

const MAX_LISTINGS = 200;
const MAX_SNAPSHOT = 1000;
type Listing = { url: string; fingerprint: string; title: string; company: string };
type SourceListing = NonNullable<JobSource["listingSnapshot"]>[number];
type Change = NonNullable<JobSource["changes"]>[number];
function hash(value: unknown): string {
  const normalized = (data: unknown): unknown =>
    Array.isArray(data)
      ? data.map(normalized)
      : data && typeof data === "object"
        ? Object.fromEntries(
            Object.entries(data)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, normalized(v)]),
          )
        : data;
  return createHash("sha256")
    .update(JSON.stringify(normalized(value)))
    .digest("hex");
}
function postingUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  try {
    const url = new URL(input.replace(/&amp;/g, "&"));
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    )
      return null;
    const canonical = new URL(canonicalJobUrl(url.href));
    const ats = detectAts(canonical.href),
      parts = canonical.pathname.split("/").filter(Boolean),
      jobsIndex = parts.indexOf("jobs");
    if (ats === "lever" && parts.length === 2) return canonical.href;
    if (
      ats === "greenhouse" &&
      ((jobsIndex >= 1 && /^\d+$/.test(parts[jobsIndex + 1] || "")) ||
        /^\d+$/.test(url.searchParams.get("gh_jid") || ""))
    )
      return canonical.href;
  } catch {
    /* Invalid or unrelated links are not job leads. */
  }
  return null;
}
function allPostingLinks(markdown: string): string[] {
  return [
    ...new Set(
      (markdown.match(/https:\/\/[^\s<>)\]"']+/g) || [])
        .map(postingUrl)
        .filter((url): url is string => !!url),
    ),
  ];
}
export function postingLinks(markdown: string): string[] {
  return allPostingLinks(markdown).slice(0, MAX_LISTINGS);
}
function normalizedListings(
  rows: unknown[],
  kind: "greenhouse" | "lever",
  company: string,
): Listing[] {
  const result = new Map<string, Listing>();
  for (const row of rows) {
    const data = object(row),
      url = postingUrl(kind === "greenhouse" ? data.absolute_url : data.hostedUrl);
    if (!url) continue;
    const title =
      typeof (data.title ?? data.text) === "string"
        ? String(data.title ?? data.text).slice(0, 500)
        : "";
    result.set(url, {
      url,
      title,
      company,
      fingerprint: hash({
        url,
        title,
        location: data.location ?? object(data.categories).location,
        updatedAt: data.updated_at,
        categories: data.categories,
        description: data.description,
        lists: data.lists,
        additional: data.additional,
        salaryRange: data.salaryRange,
      }),
    });
  }
  return [...result.values()];
}

async function listings(
  source: JobSource,
): Promise<{ items: Listing[]; revision: string; complete: boolean }> {
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
    if (typeof data.content !== "string" || data.encoding !== "base64" || data.truncated === true)
      throw new JobError(
        "The GitHub source must be a complete text file below the API size limit.",
        "invalid_source",
      );
    const base64 = data.content.replace(/\s/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0)
      throw new JobError("GitHub returned an invalid text-file encoding.", "invalid_source");
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(base64, "base64"));
    } catch {
      throw new JobError("Choose a UTF-8 text file for monitoring.", "invalid_source");
    }
    if (text.includes("\u0000"))
      throw new JobError("Choose a text file for monitoring.", "invalid_source");
    const urls = allPostingLinks(text);
    return {
      items: urls
        .slice(0, MAX_LISTINGS)
        .map((url) => ({ url, fingerprint: hash(url), title: "", company: "" })),
      revision: typeof data.sha === "string" ? data.sha : result.headers.etag || hash(text),
      complete: urls.length <= MAX_LISTINGS,
    };
  }
  const checked = await validateJobUrl(source.url),
    parts = checked.pathname.split("/").filter(Boolean);
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
    if (!Array.isArray(data.jobs))
      throw new JobError("Greenhouse returned an invalid job feed.", "invalid_source");
    const items = normalizedListings(data.jobs, "greenhouse", parts[0]);
    return {
      items: items.slice(0, MAX_LISTINGS),
      revision: result.headers.etag || hash(items),
      complete: items.length <= MAX_LISTINGS,
    };
  }
  if (
    source.kind === "lever" &&
    detectAts(checked.href) === "lever" &&
    parts[0] &&
    /^[\w-]+$/.test(parts[0])
  ) {
    const host = checked.hostname.includes(".eu.") ? "api.eu.lever.co" : "api.lever.co";
    const rows: unknown[] = [];
    let complete = false;
    // Explicit bounded pagination avoids declaring missing entries removed after a partial page.
    for (let skip = 0; skip < MAX_LISTINGS; skip += 100) {
      const result = await safeRead(
        `https://${host}/v0/postings/${encodeURIComponent(parts[0])}?mode=json&skip=${skip}&limit=100`,
      );
      const data: unknown = JSON.parse(result.text);
      if (!Array.isArray(data))
        throw new JobError("Lever returned an invalid job feed.", "invalid_source");
      rows.push(...data.slice(0, 100));
      if (data.length < 100) {
        complete = true;
        break;
      }
    }
    const items = normalizedListings(rows, "lever", parts[0]);
    return { items: items.slice(0, MAX_LISTINGS), revision: hash(items), complete };
  }
  throw new JobError("This source does not match its configured provider.", "invalid_source");
}

function sourceSnapshot(source: JobSource, items: Listing[], complete: boolean, now: string) {
  const previous = new Map((source.listingSnapshot || []).map((item) => [item.url, item]));
  const snapshot = new Map<string, SourceListing>();
  const changes: Change[] = [];
  const changed = (url: string, kind: Change["kind"]) => {
    if (!changes.some((change) => change.url === url && change.kind === kind))
      changes.push({ url, kind, observedAt: now });
  };
  for (const item of items) {
    const old = previous.get(item.url);
    if (!old) changed(item.url, "added");
    else if (old.removedAt) changed(item.url, "reopened");
    else if (old.fingerprint !== item.fingerprint) changed(item.url, "updated");
    snapshot.set(item.url, {
      ...old,
      ...item,
      title: item.title || old?.title || "",
      company: item.company || old?.company || "",
      firstSeenAt: old?.firstSeenAt || now,
      lastSeenAt: now,
      removedAt: null,
      verification: old?.verification || "unverified",
      verifiedAt: old?.verifiedAt || null,
    });
  }
  for (const old of previous.values()) {
    if (snapshot.has(old.url)) continue;
    if (complete && !old.removedAt) changed(old.url, "removed");
    snapshot.set(old.url, { ...old, removedAt: complete ? old.removedAt || now : old.removedAt });
  }
  return { snapshot, changes, changed };
}
function stopped(): boolean {
  return process.env.GLOBAL_EMERGENCY_STOP === "true" || process.env.EMERGENCY_STOP === "true";
}
function sameSource(source: JobSource, live: JobSource | null): live is JobSource {
  return !!live && live.url === source.url && live.kind === source.kind;
}
function runLimit(): number {
  const value = Number(process.env.MAX_DISCOVERY_JOBS_PER_RUN || 10);
  return Number.isFinite(value) && value >= 1 ? Math.min(100, Math.floor(value)) : 10;
}
function hasQueueCapacity(
  profile: CandidateProfile,
  plan: { used: number; reserved: number; limit: number },
  applications: Application[],
  queued: number,
): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const startedToday = applications.filter((app) =>
    app.submissionStartedAt?.startsWith(today),
  ).length;
  const pending = applications.filter(
    (app) =>
      !app.submissionStartedAt &&
      ["discovered", "evaluating", "resume_preparing", "ready", "applying", "needs_input"].includes(
        app.status,
      ),
  ).length;
  return (
    startedToday + pending < profile.autonomy.maxPerDay &&
    queued < runLimit() &&
    plan.used + plan.reserved < plan.limit
  );
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
  const sourceRevision = (await store.list("job_sources", userId))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => ({ id: s.id, enabled: s.enabled, updatedAt: s.updatedAt }));
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
  if (stopped()) return { checked: 0, queued: 0 };
  const sources = (await store.list("job_sources", userId)).filter((source) => source.enabled);
  let checked = 0,
    queued = 0;
  for (const source of sources) {
    if (stopped()) break;
    const before = await store.get("job_sources", source.id, userId);
    if (!sameSource(source, before) || !before.enabled) continue;
    try {
      const result = await listings(source),
        now = new Date().toISOString();
      checked++;
      const observed = sourceSnapshot(before, result.items, result.complete, now);
      let verifiedOpen = 0,
        closed = 0,
        unavailable = 0,
        sourceQueued = 0;
      for (const item of result.items) {
        if (stopped()) break;
        const liveSource = await store.get("job_sources", source.id, userId);
        let currentProfile = (await store.list("candidate_profiles", userId))[0]?.profile;
        let currentPlan = await getPlanState(userId);
        if (
          !sameSource(source, liveSource) ||
          !liveSource.enabled ||
          !currentProfile ||
          !discoveryEnabled(currentProfile, currentPlan)
        )
          break;
        const applications = await store.list("applications", userId);
        if (
          applications.some((app) => canonicalJobUrl(app.jobUrl) === item.url) ||
          !currentProfile.autonomy.allowedDomains.includes(new URL(item.url).hostname)
        )
          continue;
        // Bound preparation backlog as well as daily submissions; waiting questions must be resolved.
        if (!hasQueueCapacity(currentProfile, currentPlan, applications, queued)) break;
        const listing = observed.snapshot.get(item.url)!;
        let employerVerified = false;
        try {
          const job = await extractJob(item.url, userId);
          if (!job.title.trim() || canonicalJobUrl(job.canonicalUrl) !== item.url)
            throw new JobError(
              "The employer posting could not be verified at its listed URL.",
              "invalid_posting",
            );
          const jobFingerprint = hash({
            title: job.title,
            company: job.company,
            location: job.location,
            description: job.description,
            requirements: job.requirements,
            salary: job.salary,
          });
          if (listing.jobFingerprint && listing.jobFingerprint !== jobFingerprint)
            observed.changed(item.url, "updated");
          if (listing.verification === "closed") observed.changed(item.url, "reopened");
          Object.assign(listing, {
            title: job.title.slice(0, 500),
            company: job.company.slice(0, 300),
            verification: "open",
            verifiedAt: now,
            jobFingerprint,
            errorCategory: undefined,
          });
          verifiedOpen++;
          employerVerified = true;
          // Reading a posting can take time. Recheck both consent and source state after the read.
          const afterRead = await store.get("job_sources", source.id, userId);
          currentProfile = (await store.list("candidate_profiles", userId))[0]?.profile;
          currentPlan = await getPlanState(userId);
          if (
            stopped() ||
            !sameSource(source, afterRead) ||
            !afterRead.enabled ||
            !currentProfile ||
            !discoveryEnabled(currentProfile, currentPlan)
          )
            break;
          if (!currentProfile.autonomy.allowedDomains.includes(new URL(item.url).hostname))
            continue;
          if (
            !hasQueueCapacity(
              currentProfile,
              currentPlan,
              await store.list("applications", userId),
              queued,
            )
          )
            break;
          const match = matchJob(currentProfile, job);
          if (
            match.blocked ||
            match.needsConfirmation ||
            match.score < currentProfile.autonomy.minScore
          )
            continue;
          const app = await enqueueApplication(userId, item.url);
          // Do not overwrite a deduplicated run that was already preparing or submitted.
          if (app.status === "discovered")
            await store.save("applications", {
              ...app,
              job,
              matchScore: match.score,
              matchReasons: match.reasons,
            });
          queued++;
          sourceQueued++;
        } catch (error) {
          const category = error instanceof JobError ? error.code : "invalid_posting";
          const verifiedClosed =
            category === "job_closed" &&
            /HTTP (404|410)\b/.test(error instanceof Error ? error.message : "");
          if (verifiedClosed && listing.verification !== "closed")
            observed.changed(item.url, "closed");
          if (!employerVerified) {
            Object.assign(listing, {
              verification: verifiedClosed ? "closed" : "unavailable",
              verifiedAt: now,
              errorCategory: category,
            });
            if (verifiedClosed) closed++;
            else unavailable++;
          }
          await store.save("agent_actions", {
            ...entity(userId),
            action: "discovery_posting_skipped",
            applicationId: null,
            details: { sourceId: source.id, category },
          });
        }
      }
      const latest = await store.get("job_sources", source.id, userId);
      if (!sameSource(source, latest)) continue;
      const snapshot = [...observed.snapshot.values()]
        .sort(
          (a, b) =>
            Number(!!a.removedAt) - Number(!!b.removedAt) ||
            b.lastSeenAt.localeCompare(a.lastSeenAt),
        )
        .slice(0, MAX_SNAPSHOT);
      await store.save("job_sources", {
        ...latest,
        lastCheckedAt: now,
        lastSuccessfulAt: now,
        lastRevision: result.revision,
        error: null,
        health: !latest.enabled ? "paused" : result.complete ? "healthy" : "partial",
        listingSnapshot: snapshot,
        changes: [...(latest.changes || []), ...observed.changes].slice(-100),
        lastScan: {
          listed: result.items.length,
          added: observed.changes.filter((c) => c.kind === "added").length,
          updated: observed.changes.filter((c) => c.kind === "updated").length,
          removed: observed.changes.filter((c) => c.kind === "removed").length,
          verifiedOpen,
          closed,
          unavailable,
          queued: sourceQueued,
          complete: result.complete,
        },
      });
    } catch (error) {
      const latest = await store.get("job_sources", source.id, userId);
      if (sameSource(source, latest))
        await store.save("job_sources", {
          ...latest,
          lastCheckedAt: new Date().toISOString(),
          health: latest.enabled ? "error" : "paused",
          error:
            error instanceof JobError
              ? error.message
              : "Source monitoring failed. Retry after checking the source configuration.",
        });
    }
  }
  return { checked, queued };
}
