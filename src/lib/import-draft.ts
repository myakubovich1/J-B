import type { CandidateProfile, ImportedRecord, Source } from "./contracts";

export function importedRecordId(sourceId: string, recordId: string): string {
  return `import:${sourceId}:${recordId}`;
}
export function importedRecordIds(profile: CandidateProfile): Set<string> {
  return new Set(
    [...profile.claims, ...profile.education, ...profile.experiences, ...profile.projects].map(
      (record) => record.id,
    ),
  );
}
export function addReviewedImport(
  profile: CandidateProfile,
  source: Source,
  records: ImportedRecord[],
): CandidateProfile {
  const next = structuredClone(profile);
  const existing = importedRecordIds(next);
  const now = new Date().toISOString();
  for (const record of records) {
    const id = importedRecordId(source.id, record.id),
      f = record.fields;
    if (existing.has(id)) continue;
    let claimText = "";
    if (record.kind === "education") {
      if (!f.school?.trim() || !f.degree?.trim())
        throw new Error("Education requires a school and degree.");
      if (next.education.length >= 20) throw new Error("Your education record limit is reached.");
      if (!next.education.some((e) => e.id === id))
        next.education.push({
          id,
          school: f.school.trim(),
          degree: f.degree.trim(),
          major: f.major || "",
          startDate: f.startDate || "",
          endDate: f.endDate || "",
          gpa: f.gpa || "",
          coursework: f.coursework || "",
        });
      claimText = `${f.school} — ${f.degree}${f.major ? `, ${f.major}` : ""}`;
    } else if (record.kind === "experience") {
      if (!f.company?.trim() || !f.title?.trim())
        throw new Error("Experience requires a company and title.");
      if (next.experiences.length >= 50)
        throw new Error("Your experience record limit is reached.");
      const bullets = (f.bullets || "")
        .split(/\r?\n/)
        .map((v) => v.trim())
        .filter(Boolean);
      if (bullets.length > 12 || bullets.some((v) => v.length > 1500))
        throw new Error("Use at most 12 experience bullets of 1500 characters each.");
      if (!next.experiences.some((e) => e.id === id))
        next.experiences.push({
          id,
          company: f.company.trim(),
          title: f.title.trim(),
          location: f.location || "",
          startDate: f.startDate || "",
          endDate: f.endDate || "",
          bullets,
          confirmed: true,
        });
      claimText = `${f.title} at ${f.company}${bullets.length ? `. ${bullets.join(" ")}` : ""}`;
    } else if (record.kind === "project") {
      if (!f.name?.trim() || !f.contribution?.trim())
        throw new Error("A project requires its name and your own contribution.");
      if (next.projects.length >= 100) throw new Error("Your project record limit is reached.");
      if (!next.projects.some((p) => p.id === id))
        next.projects.push({
          id,
          name: f.name.trim(),
          description: f.description || "",
          technologies: (f.technologies || "")
            .split(/[,;|]/)
            .map((v) => v.trim())
            .filter(Boolean),
          url: f.url || "",
          contribution: f.contribution.trim(),
          confirmed: true,
        });
      claimText = `${f.name}: ${f.description || ""} My contribution: ${f.contribution}`;
    } else if (record.kind === "skill") {
      if (!f.name?.trim() || f.name.length > 100)
        throw new Error("A skill must contain 1–100 characters.");
      if (!next.skills.some((skill) => skill.toLowerCase() === f.name.trim().toLowerCase()))
        next.skills.push(f.name.trim());
      claimText = f.name.trim();
    } else {
      if (!f.text?.trim() || f.text.length > 2000)
        throw new Error("An accomplishment must contain 1–2000 characters.");
      claimText = f.text.trim();
    }
    if (next.skills.length > 100 || next.claims.length >= 500)
      throw new Error("Your profile evidence limit is reached.");
    existing.add(id);
    next.claims.push({
      id,
      type:
        record.kind === "project"
          ? "project"
          : record.kind === "skill"
            ? "skill"
            : record.kind === "education"
              ? "education"
              : record.kind === "experience"
                ? "experience"
                : "achievement",
      text: claimText.slice(0, 2000),
      source: `${source.name} · source ${source.id}`,
      sourceUrl: source.url || undefined,
      verification: "user_confirmed",
      confirmed: true,
      updatedAt: now,
      track: next.preferences.tracks[0] || "general",
    });
  }
  return next;
}
