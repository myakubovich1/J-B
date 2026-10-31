import { z } from "zod";
import { entity, type CandidateProfile } from "./contracts";
import { getStore } from "./store";
const repoSchema = z.object({
  full_name: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  html_url: z.string().url(),
  language: z.string().nullable(),
  stargazers_count: z.number(),
  fork: z.boolean(),
  private: z.boolean(),
  homepage: z.string().nullable().optional(),
});
export type GithubRepo = z.infer<typeof repoSchema>;
async function api(path: string, token?: string) {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "JB-career-agent (+https://jasteriskb.com)",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
    redirect: "error",
  });
  if (!r.ok)
    throw new Error(
      r.status === 403 || r.status === 429
        ? "GitHub rate limit reached. Try again later or connect an account."
        : r.status === 404
          ? "GitHub user or repository not found."
          : `GitHub returned ${r.status}.`,
    );
  return r;
}
export async function listGithubRepos(username: string, token?: string) {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(username))
    throw new Error("Enter a valid GitHub username.");
  const path = token
    ? "/user/repos?sort=updated&per_page=100"
    : `/users/${username}/repos?sort=updated&per_page=100`;
  return z.array(repoSchema).parse(await (await api(path, token)).json());
}
export async function importGithubRepos(userId: string, fullNames: string[], token?: string) {
  const db = getStore();
  const record = (await db.list("candidate_profiles", userId))[0];
  if (!record) throw new Error("Save your career profile before importing projects.");
  const profile: CandidateProfile = structuredClone(record.profile);
  const existing = new Set(profile.projects.map((p) => p.url));
  let count = 0;
  for (const fullName of fullNames) {
    if (!/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(fullName))
      throw new Error("Invalid repository identifier.");
    const repo = repoSchema.parse(await (await api(`/repos/${fullName}`, token)).json());
    if (existing.has(repo.html_url)) continue;
    let readme = "";
    try {
      const r = await api(`/repos/${fullName}/readme`, token);
      const data = z
        .object({ content: z.string(), encoding: z.literal("base64"), size: z.number() })
        .parse(await r.json());
      if (data.size <= 500_000)
        readme = Buffer.from(data.content, "base64").toString("utf8").slice(0, 30_000);
    } catch {
      /* A repository may have no README. Metadata remains a valid attributed source. */
    }
    const source = await db.save("profile_sources", {
      ...entity(userId),
      name: repo.full_name,
      kind: "github",
      storageKey: null,
      url: repo.html_url,
      text: [repo.description, readme].filter(Boolean).join("\n\n"),
      importedAt: new Date().toISOString(),
    });
    profile.projects.push({
      id: crypto.randomUUID(),
      name: repo.name,
      description: repo.description ?? "",
      technologies: repo.language ? [repo.language] : [],
      url: repo.html_url,
      contribution: "",
      confirmed: false,
    });
    if (repo.description)
      profile.claims.push({
        id: crypto.randomUUID(),
        type: "project",
        text: repo.description,
        source: `GitHub ${repo.full_name} (${source.id})`,
        sourceUrl: repo.html_url,
        verification: "imported",
        confirmed: false,
        updatedAt: new Date().toISOString(),
        track: "software",
      });
    existing.add(repo.html_url);
    count++;
  }
  await db.save("profile_versions", { ...record, id: crypto.randomUUID() });
  await db.save("candidate_profiles", {
    ...record,
    profile,
    version: record.version + 1,
    updatedAt: new Date().toISOString(),
  });
  return count;
}
