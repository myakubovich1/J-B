import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chown, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  CandidateProfile,
  CareerTrack,
  GeneratedResume,
  Job,
  ResumeContent,
} from "./contracts";
import { entity } from "./contracts";
import { getStore } from "./store";
import { writeArtifact } from "./storage";

const run = promisify(execFile);
export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  track: CareerTrack;
  license: string;
  custom: boolean;
}
export const builtInTemplates: TemplateDefinition[] = [
  {
    id: "jakes",
    name: "Jake's Resume",
    description:
      "Classic single-column typography, ruled sections, and a clear technical hierarchy.",
    track: "software",
    license: "MIT · Jake Gutierrez (adapted)",
    custom: false,
  },
  {
    id: "technical",
    name: "Technical minimal",
    description: "A clean sans-serif layout that puts engineering work and projects first.",
    track: "software",
    license: "MIT · J*B",
    custom: false,
  },
  {
    id: "finance",
    name: "Finance professional",
    description: "Traditional serif typography and a focused education-first structure.",
    track: "finance",
    license: "MIT · J*B",
    custom: false,
  },
  {
    id: "consulting",
    name: "Consulting professional",
    description: "A restrained layout for analytical experience and measurable accomplishments.",
    track: "consulting",
    license: "MIT · J*B",
    custom: false,
  },
  {
    id: "product",
    name: "Product management",
    description: "A modern, readable layout emphasizing product work and individual contribution.",
    track: "product",
    license: "MIT · J*B",
    custom: false,
  },
  {
    id: "general",
    name: "General ATS-friendly",
    description: "Simple headings and a single reading order for broad application compatibility.",
    track: "general",
    license: "MIT · J*B",
    custom: false,
  },
];

export async function listTemplates(userId: string): Promise<TemplateDefinition[]> {
  const custom = await getStore().list("resume_templates", userId);
  return [
    ...builtInTemplates,
    ...custom.map((t) => ({
      id: t.id,
      name: t.name,
      description: "Your custom LaTeX template. Compiled only in the isolated worker.",
      track: t.track,
      license: t.license,
      custom: true,
    })),
  ];
}

/** Every profile value enters TeX through this function; model output is never TeX. */
export function escapeLatex(value: string): string {
  const replacements: Record<string, string> = {
    "\\": "\\textbackslash{}",
    "{": "\\{",
    "}": "\\}",
    $: "\\$",
    "&": "\\&",
    "#": "\\#",
    "%": "\\%",
    _: "\\_",
    "~": "\\textasciitilde{}",
    "^": "\\textasciicircum{}",
  };
  return value
    .normalize("NFC")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/[\\{}$&#%_~^]/g, (c) => replacements[c])
    .replace(/[\r\n]+/g, " ");
}

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9+#.]{2,}/g) ?? []);
}
function relevance(text: string, target: Set<string>): number {
  return [...tokens(text)].reduce((score, term) => score + (target.has(term) ? 1 : 0), 0);
}
function rank<T>(values: T[], toText: (v: T) => string, target: Set<string>): T[] {
  return values
    .map((v, i) => ({ v, i, score: relevance(toText(v), target) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.v);
}
function dates(start: string, end: string): string {
  return [start, end].filter(Boolean).join(" - ");
}
function safeLink(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Select/reorder original confirmed wording, with traceable input IDs. Never infer authorship or achievements. */
export function buildResumeContent(
  profile: CandidateProfile,
  track: CareerTrack,
  job?: Job,
): { content: ResumeContent; sourceClaimIds: string[] } {
  const target = tokens(
    `${job?.title ?? track} ${job?.description ?? ""} ${(job?.requirements ?? []).join(" ")}`,
  );
  const experiences = rank(
    profile.experiences.filter((x) => x.confirmed),
    (x) => `${x.title} ${x.bullets.join(" ")}`,
    target,
  ).slice(0, 4);
  const projects = rank(
    profile.projects.filter((x) => x.confirmed),
    (x) => `${x.name} ${x.description} ${x.contribution} ${x.technologies.join(" ")}`,
    target,
  ).slice(0, 3);
  const claims = profile.claims.filter(
    (x) =>
      x.confirmed &&
      (x.verification === "verified" || x.verification === "user_confirmed") &&
      (x.track === track || x.track === "general"),
  );
  const skills = rank(
    [
      ...new Set([
        ...profile.skills,
        ...claims.filter((x) => x.type === "skill").map((x) => x.text),
      ]),
    ],
    (x) => x,
    target,
  ).slice(0, 24);
  const links = [
    { label: profile.website.replace(/^https?:\/\//, ""), url: profile.website },
    { label: profile.linkedin.replace(/^https?:\/\//, ""), url: profile.linkedin },
    {
      label: profile.github
        ? `github.com/${profile.github.replace(/^https?:\/\/(www\.)?github.com\//, "")}`
        : "",
      url: profile.github.startsWith("https://")
        ? profile.github
        : `https://github.com/${profile.github}`,
    },
  ].filter((x) => x.label && safeLink(x.url));
  return {
    content: {
      name: profile.legalName.trim(),
      email: profile.email.trim(),
      phone: profile.phone,
      location: profile.location,
      links,
      summary: profile.headline,
      education: profile.education.slice(0, 3).map((x) => ({
        school: x.school,
        degree: [x.degree, x.major].filter(Boolean).join(", "),
        dates: dates(x.startDate, x.endDate),
        detail: [x.gpa ? `GPA: ${x.gpa}` : "", x.coursework ? `Coursework: ${x.coursework}` : ""]
          .filter(Boolean)
          .join(" | "),
      })),
      experience: experiences.map((x) => ({
        title: x.title,
        company: x.company,
        dates: dates(x.startDate, x.endDate),
        location: x.location,
        bullets: rank(x.bullets.filter(Boolean), (b) => b, target).slice(0, 4),
      })),
      projects: projects.map((x) => ({
        name: x.name,
        detail: x.technologies.join(", "),
        url: safeLink(x.url) ? x.url : "",
        bullets: [x.description, x.contribution].filter(Boolean),
      })),
      skills,
    },
    sourceClaimIds: [
      ...profile.education.slice(0, 3).map((x) => x.id),
      ...experiences.map((x) => x.id),
      ...projects.map((x) => x.id),
      ...claims.filter((x) => x.type === "skill").map((x) => x.id),
    ],
  };
}

export function validateContent(content: ResumeContent, profile: CandidateProfile): string[] {
  const errors: string[] = [];
  if (!content.name || content.name !== profile.legalName.trim())
    errors.push("A confirmed legal name is required.");
  if (content.email !== profile.email.trim())
    errors.push("The resume email does not match the profile.");
  if (!content.education.length && !content.experience.length && !content.projects.length)
    errors.push(
      "Add education, confirmed experience, or a confirmed project before generating a resume.",
    );
  const allowedBullets = new Set([
    ...profile.experiences.filter((x) => x.confirmed).flatMap((x) => x.bullets),
    ...profile.projects.filter((x) => x.confirmed).flatMap((x) => [x.description, x.contribution]),
  ]);
  if (
    [...content.experience, ...content.projects].some((x) =>
      x.bullets.some((b) => !allowedBullets.has(b)),
    )
  )
    errors.push("Resume content contains wording without a confirmed profile source.");
  const allowedSkills = new Set([
    ...profile.skills,
    ...profile.claims
      .filter(
        (x) =>
          x.confirmed &&
          ["verified", "user_confirmed"].includes(x.verification) &&
          x.type === "skill",
      )
      .map((x) => x.text),
  ]);
  if (content.skills.some((x) => !allowedSkills.has(x)))
    errors.push("Resume skills contain an unconfirmed claim.");
  if (content.summary && content.summary !== profile.headline)
    errors.push("Resume summary must use the user-provided headline.");
  if (
    content.education.some(
      (x) =>
        !profile.education.some(
          (p) =>
            x.school === p.school &&
            x.degree === [p.degree, p.major].filter(Boolean).join(", ") &&
            x.dates === dates(p.startDate, p.endDate) &&
            x.detail ===
              [p.gpa ? `GPA: ${p.gpa}` : "", p.coursework ? `Coursework: ${p.coursework}` : ""]
                .filter(Boolean)
                .join(" | "),
        ),
    )
  )
    errors.push("Education contains an unsupported institution, degree, date, or detail.");
  if (
    content.experience.some(
      (x) =>
        !profile.experiences.some(
          (p) =>
            p.confirmed &&
            x.title === p.title &&
            x.company === p.company &&
            x.location === p.location &&
            x.dates === dates(p.startDate, p.endDate) &&
            x.bullets.every((b) => p.bullets.includes(b)),
        ),
    )
  )
    errors.push("Experience is not supported by a confirmed profile record.");
  if (
    content.projects.some(
      (x) =>
        !profile.projects.some(
          (p) =>
            p.confirmed &&
            x.name === p.name &&
            x.detail === p.technologies.join(", ") &&
            x.bullets.every((b) => b === p.description || b === p.contribution),
        ),
    )
  )
    errors.push("Projects are not supported by a confirmed profile record.");
  return errors;
}

const esc = escapeLatex;
function sections(content: ResumeContent) {
  const heading = (title: string, body: string) => (body ? `\\section*{${title}}\n${body}` : "");
  const items = (bullets: string[]) =>
    bullets.length
      ? `\\begin{itemize}\n${bullets.map((x) => `\\item ${esc(x)}`).join("\n")}\n\\end{itemize}`
      : "";
  const contact = [
    content.email,
    content.phone,
    content.location,
    ...content.links.map((x) => x.label),
  ]
    .filter(Boolean)
    .map(esc)
    .join(" $|$ ");
  const education = heading(
    "Education",
    content.education
      .map(
        (x) =>
          `\\textbf{${esc(x.school)}}\\hfill ${esc(x.dates)}\\\\\n${esc(x.degree)}${x.detail ? `\\\\\n{\\small ${esc(x.detail)}}` : ""}\\par\\vspace{4pt}`,
      )
      .join("\n"),
  );
  const experience = heading(
    "Experience",
    content.experience
      .map(
        (x) =>
          `\\textbf{${esc(x.title)}}\\hfill ${esc(x.dates)}\\\\\n\\textit{${esc(x.company)}}${x.location ? `\\hfill ${esc(x.location)}` : ""}\n${items(x.bullets)}\\vspace{3pt}`,
      )
      .join("\n"),
  );
  const projects = heading(
    "Projects",
    content.projects
      .map(
        (x) =>
          `\\textbf{${esc(x.name)}}${x.detail ? ` {\\small $|$ ${esc(x.detail)}}` : ""}\\par\n${items(x.bullets)}\\vspace{3pt}`,
      )
      .join("\n"),
  );
  const skills = heading("Skills", esc(content.skills.join(" | ")));
  const summary = content.summary ? `\\noindent ${esc(content.summary)}\\par` : "";
  return { contact, education, experience, projects, skills, summary };
}

export const templatePlaceholders = [
  "NAME",
  "CONTACT",
  "SUMMARY",
  "EDUCATION",
  "EXPERIENCE",
  "PROJECTS",
  "SKILLS",
  "RESUME_BODY",
] as const;
export function validateCustomTemplate(source: string): string[] {
  const errors: string[] = [];
  if (Buffer.byteLength(source, "utf8") > 65536)
    errors.push("Custom templates must be at most 64 KiB.");
  if (
    !source.includes("\\documentclass") ||
    !source.includes("\\begin{document}") ||
    !source.includes("\\end{document}")
  )
    errors.push("Upload a complete LaTeX document.");
  if (!source.includes("{{NAME}}") || !source.includes("{{CONTACT}}"))
    errors.push("Templates must include {{NAME}} and {{CONTACT}}.");
  if (
    !source.includes("{{RESUME_BODY}}") &&
    !["EDUCATION", "EXPERIENCE", "PROJECTS", "SKILLS"].every((key) => source.includes(`{{${key}}}`))
  )
    errors.push("Include {{RESUME_BODY}} or all four section placeholders.");
  const unknown = [...source.matchAll(/\{\{([A-Z_]+)\}\}/g)]
    .map((x) => x[1])
    .filter((x) => !templatePlaceholders.includes(x as (typeof templatePlaceholders)[number]));
  if (unknown.length) errors.push(`Unknown placeholders: ${[...new Set(unknown)].join(", ")}.`);
  // Defense in depth only. Obfuscated primitives are contained by Docker, not this denylist.
  if (
    /\\(?:input|include|write|read|openin|openout|immediate|special|catcode|directlua|usepackage\[[^\]]*shell)[\s{0-9]/i.test(
      source,
    )
  )
    errors.push("File I/O, shell commands, includes, and executable specials are not permitted.");
  return errors;
}

type TemplateStyle = {
  sans: boolean;
  heading: string;
  upper: boolean;
  rule: boolean;
  thinRule?: boolean;
  align: "center" | "left";
  order: "education" | "experience";
  margin: string;
  spacing: string;
};
const templateStyles: Record<string, TemplateStyle> = {
  jakes: {
    sans: false,
    heading: "\\large\\scshape",
    upper: false,
    rule: true,
    align: "center",
    order: "education",
    margin: "0.65in",
    spacing: "9pt",
  },
  technical: {
    sans: true,
    heading: "\\large\\bfseries",
    upper: false,
    rule: false,
    align: "left",
    order: "experience",
    margin: "0.6in",
    spacing: "8pt",
  },
  finance: {
    sans: false,
    heading: "\\normalsize\\bfseries",
    upper: true,
    rule: true,
    thinRule: true,
    align: "center",
    order: "education",
    margin: "0.75in",
    spacing: "8pt",
  },
  consulting: {
    sans: false,
    heading: "\\normalsize\\bfseries",
    upper: false,
    rule: true,
    thinRule: true,
    align: "left",
    order: "education",
    margin: "0.7in",
    spacing: "10pt",
  },
  product: {
    sans: true,
    heading: "\\normalsize\\bfseries",
    upper: true,
    rule: true,
    thinRule: true,
    align: "left",
    order: "experience",
    margin: "0.7in",
    spacing: "9pt",
  },
  general: {
    sans: true,
    heading: "\\large\\bfseries",
    upper: false,
    rule: false,
    align: "center",
    order: "education",
    margin: "0.75in",
    spacing: "10pt",
  },
};

export function renderLatex(
  content: ResumeContent,
  templateId: string,
  customSource?: string,
): string {
  const s = sections(content);
  if (customSource) {
    const errors = validateCustomTemplate(customSource);
    if (errors.length) throw new Error(errors.join(" "));
    const values: Record<string, string> = {
      NAME: esc(content.name),
      CONTACT: s.contact,
      SUMMARY: s.summary,
      EDUCATION: s.education,
      EXPERIENCE: s.experience,
      PROJECTS: s.projects,
      SKILLS: s.skills,
      RESUME_BODY: [s.summary, s.education, s.experience, s.projects, s.skills]
        .filter(Boolean)
        .join("\n"),
    };
    return customSource.replace(/\{\{([A-Z_]+)\}\}/g, (_, key: string) => values[key] ?? "");
  }
  if (!builtInTemplates.some((x) => x.id === templateId))
    throw new Error("Unknown resume template.");
  // Each built-in template is a distinct, single-column, ATS-readable layout.
  const style = templateStyles[templateId];
  const { sans, rule } = style;
  const firstExperience = style.order === "experience";
  const heading = `\\titleformat{\\section}{${style.heading}}{}{0pt}{${style.upper ? "\\MakeUppercase" : ""}}${rule ? `[{\\titlerule${style.thinRule ? "[0.4pt]" : ""}}]` : ""}`;
  const header =
    style.align === "center"
      ? // Names keep the user's casing so ATS name matching sees exactly what they typed.
        `\\begin{center}\n{\\LARGE\\bfseries ${esc(content.name)}}\\\\[5pt]\n{\\small ${s.contact}}\n\\end{center}`
      : `{\\LARGE\\bfseries ${esc(content.name)}}\\\\[3pt]\n{\\small ${s.contact}}\\\\[-2pt]\n\\rule{\\linewidth}{0.8pt}`;
  const body = [
    s.summary,
    ...(firstExperience
      ? [s.experience, s.projects, s.education]
      : [s.education, s.experience, s.projects]),
    s.skills,
  ]
    .filter(Boolean)
    .join("\n\n");
  return `${templateId === "jakes" ? '% MIT License\n% \n% Copyright (c) 2020 Jake Gutierrez\n% \n% Permission is hereby granted, free of charge, to any person obtaining a copy\n% of this software and associated documentation files (the "Software"), to deal\n% in the Software without restriction, including without limitation the rights\n% to use, copy, modify, merge, publish, distribute, sublicense, and/or sell\n% copies of the Software, and to permit persons to whom the Software is\n% furnished to do so, subject to the following conditions:\n% \n% The above copyright notice and this permission notice shall be included in all\n% copies or substantial portions of the Software.\n% \n% THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\n% IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\n% FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\n% AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\n% LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\n% OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\n% SOFTWARE.\n' : ""}% Structured resume; profile values escaped.\n% ${templateId === "jakes" ? "Adapted from Jake Gutierrez, https://github.com/jakegut/resume (MIT); see templates/LICENSE-JAKES." : "Copyright (c) J*B contributors, MIT."}\n\\documentclass[letterpaper,11pt]{article}
\\usepackage[margin=${style.margin}]{geometry}
\\usepackage{fontspec}
\\setmainfont{lmroman10-regular.otf}[BoldFont=lmroman10-bold.otf,ItalicFont=lmroman10-italic.otf,BoldItalicFont=lmroman10-bolditalic.otf]
\\setsansfont{lmsans10-regular.otf}[BoldFont=lmsans10-bold.otf,ItalicFont=lmsans10-oblique.otf,BoldItalicFont=lmsans10-boldoblique.otf]
\\usepackage{titlesec}
\\usepackage{enumitem}
\\usepackage[hidelinks]{hyperref}
\\pagestyle{empty}
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{2pt}
\\setlength{\\emergencystretch}{3em}
\\setlist[itemize]{leftmargin=1.2em,itemsep=1pt,topsep=3pt,parsep=0pt}
${heading}
\\titlespacing*{\\section}{0pt}{${style.spacing}}{5pt}
${sans ? "\\renewcommand{\\familydefault}{\\sfdefault}" : ""}
\\begin{document}
${header}
${body}
\\end{document}
`;
}

export interface CompileResult {
  pdf: Buffer;
  text: string;
  pages: number;
  warnings: string[];
  layoutIssues: string[];
  log: string;
}
/** Inspect Poppler's word rectangles for clipping and substantial text overlays. */
export function checkPdfLayout(bboxXml: string): string[] {
  const issues = new Set<string>();
  let inspectedPages = 0;
  for (const page of bboxXml.matchAll(
    /<page\s+width="([\d.]+)"\s+height="([\d.]+)"[^>]*>([\s\S]*?)<\/page>/g,
  )) {
    inspectedPages++;
    const width = Number(page[1]),
      height = Number(page[2]);
    const words = [
      ...page[3].matchAll(
        /<word\s+xMin="([-\d.]+)"\s+yMin="([-\d.]+)"\s+xMax="([-\d.]+)"\s+yMax="([-\d.]+)"[^>]*>/g,
      ),
    ].map((m) => ({ x: Number(m[1]), y: Number(m[2]), right: Number(m[3]), bottom: Number(m[4]) }));
    if (words.length > 12000) {
      issues.add("PDF contains too much text for bounded layout validation.");
      continue;
    }
    if (words.some((w) => w.x < -1 || w.y < -1 || w.right > width + 1 || w.bottom > height + 1))
      issues.add("PDF text extends beyond the page boundary.");
    words.sort((a, b) => a.y - b.y);
    for (let i = 0; i < words.length; i++) {
      const a = words[i];
      for (let j = i + 1; j < words.length && words[j].y < a.bottom; j++) {
        const b = words[j];
        const intersection =
          Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x)) *
          Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
        const smallerArea = Math.min(
          (a.right - a.x) * (a.bottom - a.y),
          (b.right - b.x) * (b.bottom - b.y),
        );
        if (smallerArea > 0 && intersection / smallerArea > 0.65)
          issues.add("PDF contains substantially overlapping text. Review the template layout.");
      }
    }
  }
  if (!inspectedPages) issues.add("PDF word bounds were unavailable for layout validation.");
  return [...issues];
}
const cleanEnvironment = (): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH,
  HOME: os.homedir(),
  NODE_ENV: process.env.NODE_ENV || "development",
  LANG: "en_US.UTF-8",
  TECTONIC_UNTRUSTED_MODE: "1",
});
/** Trusted local templates may use Tectonic. Every custom or production compile requires sandbox Docker. */
export async function compileLatex(
  source: string,
  options: { custom?: boolean } = {},
): Promise<CompileResult> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "career-latex-"));
  const filename = path.join(directory, "resume.tex");
  let sandboxName: string | null = null;
  try {
    await writeFile(filename, source, { mode: 0o644 });
    let log = "";
    const useDocker =
      options.custom ||
      process.env.NODE_ENV === "production" ||
      process.env.LATEX_MODE === "docker";
    if (useDocker) {
      const hostUid = process.getuid?.() ?? 65532,
        uid = hostUid === 0 ? 65532 : hostUid,
        gid = hostUid === 0 ? 65532 : (process.getgid?.() ?? 65532);
      if (hostUid === 0) {
        await chown(directory, uid, gid);
        await chown(filename, uid, gid);
      }
      sandboxName = `career-latex-${crypto.randomUUID()}`;
      const result = await run(
        "docker",
        [
          "run",
          "--rm",
          "--name",
          sandboxName,
          "--network=none",
          "--read-only",
          "--cap-drop=ALL",
          "--security-opt=no-new-privileges",
          "--pids-limit=64",
          "--memory=384m",
          "--cpus=1",
          `--user=${uid}:${gid}`,
          "--tmpfs=/tmp:rw,noexec,nosuid,size=64m",
          "--mount",
          `type=bind,src=${directory},dst=/work`,
          "--workdir=/work",
          "-e",
          "TECTONIC_UNTRUSTED_MODE=1",
          "-e",
          "HOME=/tmp",
          process.env.LATEX_DOCKER_IMAGE || "career-latex:local",
          "resume.tex",
        ],
        { timeout: 45000, maxBuffer: 2 * 1024 * 1024, env: cleanEnvironment() },
      );
      log = `${result.stdout}\n${result.stderr}`;
    } else {
      try {
        const result = await run(
          process.env.TECTONIC_BIN || "tectonic",
          ["-X", "compile", "--untrusted", "--keep-logs", "--outdir", directory, filename],
          { cwd: directory, timeout: 45000, maxBuffer: 2 * 1024 * 1024, env: cleanEnvironment() },
        );
        log = `${result.stdout}\n${result.stderr}`;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          throw new Error(
            "LaTeX compiler unavailable. Install Tectonic for trusted local templates, or build the isolated career-latex Docker worker.",
          );
        throw new Error(
          `LaTeX compilation failed: ${error instanceof Error ? error.message.slice(0, 1500) : "compiler error"}`,
        );
      }
    }
    const pdfPath = path.join(directory, "resume.pdf");
    const pdf = await readFile(pdfPath);
    if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-")) || pdf.length > 5 * 1024 * 1024)
      throw new Error("Compiler output is not a valid, reasonably sized PDF.");
    try {
      log += `\n${await readFile(path.join(directory, "resume.log"), "utf8")}`;
    } catch {
      /* command output still available */
    }
    const [textResult, infoResult, bboxResult] = await Promise.all([
      run("pdftotext", ["-layout", pdfPath, "-"], {
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        env: cleanEnvironment(),
      }),
      run("pdfinfo", [pdfPath], { timeout: 15000, maxBuffer: 65536, env: cleanEnvironment() }),
      run("pdftotext", ["-bbox", pdfPath, "-"], {
        timeout: 15000,
        maxBuffer: 2 * 1024 * 1024,
        env: cleanEnvironment(),
      }),
    ]);
    const pages = Number(infoResult.stdout.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0);
    if (!pages) throw new Error("Unable to validate PDF page count.");
    const warnings = [
      ...new Set(
        log
          .split("\n")
          .filter((x) => /(?:Overfull|Missing character)/.test(x))
          .map((x) => x.trim()),
      ),
    ];
    return {
      pdf,
      text: textResult.stdout,
      pages,
      warnings,
      layoutIssues: checkPdfLayout(bboxResult.stdout),
      log,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error(
        "Isolated compiler or Poppler unavailable. Build the LaTeX image and install Poppler; no PDF was marked valid.",
      );
    throw error;
  } finally {
    if (sandboxName)
      await run("docker", ["rm", "-f", sandboxName], {
        timeout: 5000,
        maxBuffer: 65536,
        env: cleanEnvironment(),
      }).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
}

/** Reduce lowest-ranked content instead of using unreadably small fonts. */
export function trimResumeContent(content: ResumeContent): ResumeContent | null {
  const copy = structuredClone(content);
  if (copy.projects.length > 1) {
    copy.projects.pop();
    return copy;
  }
  const longest = [...copy.experience].reverse().find((x) => x.bullets.length > 2);
  if (longest) {
    longest.bullets.pop();
    return copy;
  }
  if (copy.experience.length > 2) {
    copy.experience.pop();
    return copy;
  }
  if (copy.skills.length > 12) {
    copy.skills = copy.skills.slice(0, 12);
    return copy;
  }
  if (copy.summary) {
    copy.summary = "";
    return copy;
  }
  if (copy.projects.length) {
    copy.projects.pop();
    return copy;
  }
  return null;
}

export async function generateResume(input: {
  userId: string;
  profile: CandidateProfile;
  templateId: string;
  track: CareerTrack;
  job?: Job;
  applicationId?: string;
}): Promise<GeneratedResume> {
  const selected = buildResumeContent(input.profile, input.track, input.job);
  const contentErrors = validateContent(selected.content, input.profile);
  if (contentErrors.length) throw new Error(contentErrors.join(" "));
  const custom = builtInTemplates.some((t) => t.id === input.templateId)
    ? null
    : await getStore().get("resume_templates", input.templateId, input.userId);
  if (!builtInTemplates.some((t) => t.id === input.templateId) && !custom)
    throw new Error("Resume template not found.");
  const id = crypto.randomUUID();
  const maxPages = Math.min(3, Math.max(1, Number(process.env.RESUME_MAX_PAGES || 1)));
  let content = selected.content;
  let source = renderLatex(content, input.templateId, custom?.source);
  let compiled = await compileLatex(source, { custom: !!custom });
  let edits = 0;
  while (compiled.pages > maxPages && edits < 8) {
    const trimmed = trimResumeContent(content);
    if (!trimmed) break;
    content = trimmed;
    source = renderLatex(content, input.templateId, custom?.source);
    compiled = await compileLatex(source, { custom: !!custom });
    edits++;
  }
  const errors: string[] = [];
  errors.push(...compiled.layoutIssues);
  const normalized = (s: string) => s.normalize("NFKD").replace(/\s+/g, " ").trim().toLowerCase();
  const pdfText = normalized(compiled.text);
  if (!pdfText.includes(normalized(content.name)))
    errors.push("Candidate name could not be verified in the PDF text.");
  if (!pdfText.includes(normalized(content.email)))
    errors.push("Candidate email could not be verified in the PDF text.");
  const textExtractable = compiled.text.trim().length > 50;
  if (!textExtractable) errors.push("PDF text is not sufficiently extractable for ATS use.");
  if (compiled.pages > maxPages)
    errors.push(
      `Resume exceeds the ${maxPages}-page limit after editorial trimming. Shorten profile content.`,
    );
  if (compiled.warnings.some((x) => /Overfull|Missing character/.test(x)))
    errors.push(
      "Compiler reported text overflow or missing glyphs. Review and shorten the affected content.",
    );
  const texKey = await writeArtifact(
    input.userId,
    `resumes/${id}/resume.tex`,
    Buffer.from(source),
    "application/x-tex",
  );
  const pdfKey = await writeArtifact(
    input.userId,
    `resumes/${id}/resume.pdf`,
    compiled.pdf,
    "application/pdf",
  );
  const resume: GeneratedResume = {
    ...entity(input.userId, id),
    templateId: input.templateId,
    track: input.track,
    applicationId: input.applicationId ?? null,
    title: input.job
      ? `${input.job.company} · ${input.job.title}`
      : `${builtInTemplates.find((x) => x.id === input.templateId)?.name ?? custom?.name} resume`,
    content,
    texKey,
    pdfKey,
    validation: {
      valid: errors.length === 0,
      pages: compiled.pages,
      errors,
      warnings: edits
        ? [`Trimmed lower-ranked content in ${edits} editorial passes.`, ...compiled.warnings]
        : compiled.warnings,
      textExtractable,
    },
    sourceClaimIds: selected.sourceClaimIds,
  };
  await getStore().save("generated_resumes", resume);
  return resume;
}
