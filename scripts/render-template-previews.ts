/**
 * Renders each built-in LaTeX template with fictional sample content and writes
 * public/templates/<id>.pdf and <id>.png (first page) for the template gallery.
 * Requires Tectonic and Poppler (pdftoppm). Run: npx tsx scripts/render-template-previews.ts
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { builtInTemplates, compileLatex, renderLatex } from "../src/lib/resume";
import type { ResumeContent } from "../src/lib/contracts";

const run = promisify(execFile);

const sample: ResumeContent = {
  name: "Jordan Rivera",
  email: "jordan@example.com",
  phone: "(555) 010-0199",
  location: "Austin, TX",
  links: [
    { label: "github.com/jordan-sample", url: "https://github.com/jordan-sample" },
    { label: "linkedin.com/in/jordan-sample", url: "https://linkedin.com/in/jordan-sample" },
  ],
  summary:
    "Computer science student focused on reliable backend systems and thoughtful product engineering.",
  education: [
    {
      school: "Sample State University",
      degree: "B.S. Computer Science, Minor in Economics",
      dates: "Aug 2023 – May 2027",
      detail: "Coursework: Data Structures, Operating Systems, Databases, Machine Learning",
    },
  ],
  experience: [
    {
      title: "Software Engineering Intern",
      company: "Example Logistics Co.",
      dates: "May 2025 – Aug 2025",
      location: "Remote",
      bullets: [
        "Built a TypeScript service that batches shipment status updates and retries failed webhooks",
        "Added integration tests and dashboards that made on-call debugging faster for the team",
        "Wrote a design document comparing queue options and presented the trade-offs to engineers",
      ],
    },
    {
      title: "Undergraduate Research Assistant",
      company: "Sample State Systems Lab",
      dates: "Jan 2025 – May 2025",
      location: "Austin, TX",
      bullets: [
        "Profiled storage workloads in Python and summarized results for a weekly research meeting",
        "Automated experiment setup with shell scripts, reducing manual configuration steps",
      ],
    },
  ],
  projects: [
    {
      name: "Course Planner",
      detail: "Next.js, PostgreSQL",
      url: "",
      bullets: [
        "Designed a schedule builder that checks prerequisites and section conflicts",
        "Deployed with automated migrations and end-to-end tests in CI",
      ],
    },
    {
      name: "Transit Alerts Bot",
      detail: "Python, GTFS",
      url: "",
      bullets: ["Parsed public transit feeds and sent delay notifications to subscribers"],
    },
  ],
  skills: [
    "TypeScript",
    "Python",
    "Java",
    "SQL",
    "React",
    "Node.js",
    "PostgreSQL",
    "Docker",
    "Git",
  ],
};

async function main() {
  const out = path.resolve("public/templates");
  await mkdir(out, { recursive: true });
  for (const template of builtInTemplates) {
    const result = await compileLatex(renderLatex(sample, template.id));
    const work = await mkdtemp(path.join(os.tmpdir(), "jb-preview-"));
    try {
      const pdf = path.join(work, "preview.pdf");
      await writeFile(pdf, result.pdf);
      await run("pdftoppm", [
        "-png",
        "-r",
        "96",
        "-f",
        "1",
        "-l",
        "1",
        "-singlefile",
        pdf,
        path.join(work, "page"),
      ]);
      await rename(path.join(work, "page.png"), path.join(out, `${template.id}.png`));
      await writeFile(path.join(out, `${template.id}.pdf`), result.pdf);
      console.info(
        `${template.id}: ${result.pages} page(s)${result.layoutIssues.length ? ` · ${result.layoutIssues.join("; ")}` : ""}`,
      );
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
