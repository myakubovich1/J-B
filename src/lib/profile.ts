import { createHash } from "node:crypto";
import { profileSchema, type CandidateProfile, type Claim } from "./contracts";
/** Normalization never upgrades an imported assertion into a confirmed fact. */
export function normalizeProfile(input: CandidateProfile): CandidateProfile {
  const profile = profileSchema.parse(input);
  const strings = (values: string[]) => [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  profile.legalName = profile.legalName.trim();
  profile.preferredName = profile.preferredName.trim();
  profile.email = profile.email.trim().toLowerCase();
  profile.skills = strings(profile.skills);
  profile.preferences.titles = strings(profile.preferences.titles);
  profile.preferences.locations = strings(profile.preferences.locations);
  profile.preferences.targetCompanies = strings(profile.preferences.targetCompanies);
  profile.preferences.excludedCompanies = strings(profile.preferences.excludedCompanies);
  profile.autonomy.allowedDomains = strings(
    profile.autonomy.allowedDomains.map((d) => d.toLowerCase()),
  );
  let fixtureHostname: string | undefined;
  if (
    process.env.APP_MODE === "local" &&
    process.env.ENABLE_TEST_EMPLOYER === "true" &&
    process.env.NODE_ENV !== "production"
  ) {
    try {
      const origin = new URL(process.env.APP_URL || "http://127.0.0.1:3000");
      if (["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname))
        fixtureHostname = origin.hostname;
    } catch {
      /* Invalid configuration grants no fixture exception. */
    }
  }
  for (const domain of profile.autonomy.allowedDomains)
    if (
      domain !== fixtureHostname &&
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
    )
      throw new Error(
        "Allowed domains must be exact public hostnames, without schemes, paths, or wildcards.",
      );
  for (const experience of profile.experiences)
    experience.bullets = experience.bullets.map((b) => b.trim()).filter(Boolean);
  const now = new Date().toISOString();
  const facts: Claim[] = [];
  function add(type: Claim["type"], key: string, text: string, confirmed: boolean) {
    if (!text.trim()) return;
    facts.push({
      id: `profile:${createHash("sha256").update(key).digest("hex").slice(0, 24)}`,
      type,
      text: text.slice(0, 2000),
      source: "Career Profile",
      verification: confirmed ? "user_confirmed" : "imported",
      confirmed,
      updatedAt: now,
      track: "general",
    });
  }
  profile.education.forEach((e) =>
    add(
      "education",
      e.id,
      `${e.school} — ${[e.degree, e.major].filter(Boolean).join(", ")} (${e.startDate} – ${e.endDate})`,
      true,
    ),
  );
  profile.experiences.forEach((e) => {
    add(
      "experience",
      e.id,
      `${e.title} at ${e.company} (${e.startDate} – ${e.endDate})`,
      e.confirmed,
    );
    e.bullets.forEach((b, i) => add("achievement", `${e.id}:${i}`, b, e.confirmed));
  });
  profile.projects.forEach((p) =>
    add(
      "project",
      p.id,
      `${p.name}: ${p.description}${p.contribution ? ` My contribution: ${p.contribution}` : ""}`,
      p.confirmed,
    ),
  );
  // Skills entered in this explicit profile form are user assertions, never external inferences.
  profile.skills.forEach((s) => add("skill", `skill:${s.toLowerCase()}`, s, true));
  const reviewed = profile.claims
    .filter((c) => !c.id.startsWith("profile:"))
    .map((c) => ({
      ...c,
      verification: c.confirmed
        ? ("user_confirmed" as const)
        : c.verification === "suggestion"
          ? ("suggestion" as const)
          : ("imported" as const),
    }));
  profile.claims = [...reviewed, ...facts].slice(0, 500);
  return profile;
}
