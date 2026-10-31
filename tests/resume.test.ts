import { describe, expect, it } from "vitest";
import {
  buildResumeContent,
  builtInTemplates,
  checkPdfLayout,
  compileLatex,
  escapeLatex,
  renderLatex,
  trimResumeContent,
  validateContent,
  validateCustomTemplate,
} from "../src/lib/resume";
import { emptyProfile, type Job } from "../src/lib/contracts";

export function sampleProfile() {
  const profile = emptyProfile("alex@example.test", "Alex Example");
  profile.location = "New York, NY";
  profile.phone = "+1 212 555 0100";
  profile.headline = "Computer science student focused on reliable web applications.";
  profile.education = [
    {
      id: "edu-1",
      school: "Example University",
      degree: "B.S.",
      major: "Computer Science",
      startDate: "2023",
      endDate: "2027",
      coursework: "Algorithms, Databases",
    },
  ];
  profile.skills = ["TypeScript", "React", "PostgreSQL", "Python"];
  profile.experiences = [
    {
      id: "exp-1",
      company: "Example Research Lab",
      title: "Research Assistant",
      location: "New York",
      startDate: "May 2025",
      endDate: "August 2025",
      confirmed: true,
      bullets: [
        "Built a TypeScript dashboard for research data review.",
        "Reduced query latency by 30% through PostgreSQL index tuning.",
      ],
    },
  ];
  profile.projects = [
    {
      id: "project-1",
      name: "Research Notes",
      description: "Built a searchable knowledge base using React and PostgreSQL.",
      contribution: "Implemented the document search interface and data import pipeline.",
      technologies: ["TypeScript", "React", "PostgreSQL"],
      url: "https://example.test/notes",
      confirmed: true,
    },
  ];
  return profile;
}
const job: Job = {
  url: "https://example.test/job",
  canonicalUrl: "https://example.test/job",
  externalId: "1",
  ats: "fixture",
  company: "Fixture",
  title: "Software Engineering Intern",
  location: "Remote",
  description: "Build TypeScript and React applications backed by PostgreSQL.",
  requirements: ["TypeScript", "React"],
  salary: "",
  track: "software",
};

describe("structured resume selection and provenance", () => {
  it("excludes unconfirmed imported projects and suggestions", () => {
    const profile = sampleProfile();
    profile.projects.push({
      ...profile.projects[0],
      id: "imported",
      name: "Unconfirmed project",
      confirmed: false,
    });
    profile.claims.push({
      id: "claim",
      type: "skill",
      text: "Expert in Kubernetes",
      source: "AI suggestion",
      verification: "suggestion",
      confirmed: true,
      updatedAt: "2026-01-01",
      track: "software",
    });
    const { content, sourceClaimIds } = buildResumeContent(profile, "software", job);
    expect(content.projects.map((p) => p.name)).toEqual(["Research Notes"]);
    expect(content.skills).not.toContain("Expert in Kubernetes");
    expect(sourceClaimIds).not.toContain("imported");
    expect(validateContent(content, profile)).toEqual([]);
  });
  it("rejects fabricated metrics, identity, employer, and skills", () => {
    const profile = sampleProfile();
    const { content } = buildResumeContent(profile, "software", job);
    content.name = "Somebody Else";
    content.experience[0].company = "Fabricated Company";
    content.experience[0].bullets.push("Generated $1 million revenue.");
    content.skills.push("Aviation");
    expect(validateContent(content, profile).length).toBeGreaterThanOrEqual(4);
  });
  it("preserves numeric achievements exactly", () => {
    const profile = sampleProfile();
    const { content } = buildResumeContent(profile, "software", job);
    expect(content.experience[0].bullets).toContain(
      "Reduced query latency by 30% through PostgreSQL index tuning.",
    );
  });
  it("escapes every TeX control character in profile data", () => {
    expect(escapeLatex("A&B 30% #1 $x_1 {a} ~ ^ \\input{/etc/passwd}")).toBe(
      "A\\&B 30\\% \\#1 \\$x\\_1 \\{a\\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{}input\\{/etc/passwd\\}",
    );
    const profile = sampleProfile();
    profile.legalName = "Alex \\input{/etc/passwd}";
    expect(renderLatex(buildResumeContent(profile, "software").content, "jakes")).not.toContain(
      "\\input{/etc/passwd}",
    );
  });
  it("trims lower-ranked items before font shrinking", () => {
    const content = buildResumeContent(sampleProfile(), "software").content;
    content.projects.push({ ...content.projects[0], name: "Lower ranked" });
    const trimmed = trimResumeContent(content);
    expect(trimmed?.projects).toHaveLength(1);
    expect(content.projects).toHaveLength(2);
    expect(renderLatex(trimmed!, "jakes")).toContain("11pt");
  });
  it("detects clipped and substantially overlaid PDF text", () => {
    const xml =
      '<page width="612" height="792"><word xMin="10" yMin="10" xMax="90" yMax="20">A</word><word xMin="10" yMin="10" xMax="90" yMax="20">B</word><word xMin="610" yMin="30" xMax="640" yMax="40">C</word></page>';
    expect(checkPdfLayout(xml)).toHaveLength(2);
  });
});

describe("custom template contract", () => {
  const valid =
    "\\documentclass{article}\n\\begin{document}\n{{NAME}} {{CONTACT}} {{RESUME_BODY}}\n\\end{document}";
  it("accepts safe self-contained placeholders and rejects unknown/input primitives", () => {
    expect(validateCustomTemplate(valid)).toEqual([]);
    expect(validateCustomTemplate(valid.replace("{{RESUME_BODY}}", "{{UNKNOWN}}"))).not.toEqual([]);
    expect(
      validateCustomTemplate(
        valid.replace("{{RESUME_BODY}}", "{{RESUME_BODY}} \\input{/etc/passwd}"),
      ),
    ).not.toEqual([]);
  });
  it("rejects missing essential placeholders", () => {
    expect(validateCustomTemplate(valid.replace("{{NAME}}", "Name"))).toContain(
      "Templates must include {{NAME}} and {{CONTACT}}.",
    );
  });
});

describe.skipIf(process.env.RUN_LATEX_TESTS !== "1")("actual LaTeX integration", () => {
  it.each(builtInTemplates)(
    "compiles $name to a readable one-page PDF",
    async (template) => {
      const profile = sampleProfile();
      const content = buildResumeContent(profile, template.track, job).content;
      const result = await compileLatex(renderLatex(content, template.id));
      expect(result.pages).toBe(1);
      expect(result.text).toContain(profile.legalName);
      expect(result.text).toContain(profile.email);
      expect(result.text).toContain("30%");
      expect(result.warnings).toEqual([]);
      expect(result.layoutIssues).toEqual([]);
      if (process.env.RESUME_QA_DIR && template.id === "jakes") {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        await fs.mkdir(process.env.RESUME_QA_DIR, { recursive: true });
        await fs.writeFile(path.join(process.env.RESUME_QA_DIR, "jakes-resume.pdf"), result.pdf);
      }
    },
    60000,
  );
  it("preserves accented candidate names with Unicode font mapping", async () => {
    const profile = sampleProfile();
    profile.legalName = "Zoë García";
    const result = await compileLatex(
      renderLatex(buildResumeContent(profile, "software").content, "jakes"),
    );
    expect(result.text).toContain("Zoë García");
    expect(result.text).toContain("TypeScript | React");
    expect(result.warnings).toEqual([]);
    expect(result.layoutIssues).toEqual([]);
  }, 60000);
});
