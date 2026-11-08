import { createHash } from "node:crypto";
import type { ImportedRecord, Source } from "./contracts";

const MAX_RECORDS = 100;
const key = (value: string) =>
  value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const string = (value: unknown) =>
  typeof value === "string"
    ? value.trim().slice(0, 4000)
    : typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : "";
const text = (value: unknown) =>
  Array.isArray(value) ? value.map(string).filter(Boolean).join("\n") : string(value);

/** Bounded RFC-style CSV reader. It never evaluates spreadsheet formulas or embedded content. */
export function parseImportCsv(input: string): string[][] {
  if (input.length > 100000) throw new Error("Source text exceeds the import review limit.");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    afterQuote = false;
  const pushCell = () => {
    row.push(cell);
    cell = "";
    afterQuote = false;
    if (row.length > 100) throw new Error("CSV has too many columns.");
  };
  const pushRow = () => {
    pushCell();
    if (row.some((value) => value.trim())) rows.push(row);
    row = [];
    if (rows.length > 1001)
      throw new Error("CSV has too many rows. Split the file before importing.");
  };
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
        afterQuote = true;
      } else cell += ch;
    } else if (ch === '"' && !cell && !afterQuote) quoted = true;
    else if (ch === ",") pushCell();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      pushRow();
    } else if (afterQuote && ch.trim()) throw new Error("CSV contains text after a closing quote.");
    else if (!afterQuote) cell += ch;
  }
  if (quoted) throw new Error("CSV has an unterminated quoted field.");
  if (cell || row.length || afterQuote) pushRow();
  return rows;
}

export function extractImportRecords(
  name: string,
  sourceText: string,
): Source["structured"] | undefined {
  const format = /\.csv$/i.test(name) ? "csv" : /\.json$/i.test(name) ? "json" : undefined;
  if (!format) return undefined;
  const records: ImportedRecord[] = [],
    issues: string[] = [];
  const append = (kind: ImportedRecord["kind"], fields: Record<string, string>) => {
    const cleaned = Object.fromEntries(
      Object.entries(fields).map(([k, value]) => [k, value.trim()]),
    );
    if (!Object.values(cleaned).some(Boolean)) return;
    const id = createHash("sha256")
      .update(JSON.stringify({ kind, fields: cleaned }))
      .digest("hex")
      .slice(0, 24);
    if (records.some((record) => record.id === id)) return;
    if (records.length < MAX_RECORDS) records.push({ id, kind, fields: cleaned });
    else if (!issues.includes("Only the first 100 distinct supported records are shown."))
      issues.push("Only the first 100 distinct supported records are shown.");
  };
  try {
    if (sourceText.length > 100000) throw new Error("Source text exceeds the import review limit.");
    if (format === "json") {
      const data = object(JSON.parse(sourceText));
      for (const item of Array.isArray(data.education) ? data.education : []) {
        const e = object(item);
        append("education", {
          school: string(e.school || e.institution),
          degree: string(e.degree),
          major: string(e.major || e.fieldOfStudy),
          startDate: string(e.startDate),
          endDate: string(e.endDate),
          gpa: string(e.gpa),
          coursework: text(e.coursework),
        });
      }
      for (const item of Array.isArray(data.experiences) ? data.experiences : []) {
        const e = object(item);
        append("experience", {
          company: string(e.company),
          title: string(e.title),
          location: string(e.location),
          startDate: string(e.startDate),
          endDate: string(e.endDate),
          bullets: text(e.bullets || e.description),
        });
      }
      for (const item of Array.isArray(data.projects) ? data.projects : []) {
        const p = object(item);
        append("project", {
          name: string(p.name),
          description: string(p.description),
          technologies: Array.isArray(p.technologies)
            ? p.technologies.map(string).filter(Boolean).join(", ")
            : string(p.technologies),
          url: string(p.url),
          contribution: string(p.contribution),
        });
      }
      for (const item of Array.isArray(data.skills) ? data.skills : [])
        append("skill", { name: string(item) });
      for (const item of Array.isArray(data.achievements) ? data.achievements : [])
        append("achievement", { text: string(item) });
    } else {
      const rows = parseImportCsv(sourceText.replace(/^\uFEFF/, ""));
      const headers = (rows.shift() || []).map(key);
      if (new Set(headers).size !== headers.length)
        throw new Error("CSV column headings must be distinct.");
      for (const row of rows) {
        if (row.length !== headers.length) {
          issues.push("A row with a different number of columns was skipped.");
          continue;
        }
        const values = Object.fromEntries(
          headers.map((header, index) => [header, row[index].trim().slice(0, 4000)]),
        );
        const get = (...names: string[]) => names.map((n) => values[n]).find(Boolean) || "";
        const type = get("type", "kind").toLowerCase();
        if (get("school name", "school", "university", "institution") || type === "education")
          append("education", {
            school: get("school name", "school", "university", "institution"),
            degree: get("degree name", "degree"),
            major: get("field of study", "major", "fieldofstudy"),
            startDate: get("start date", "started on", "startdate"),
            endDate: get("end date", "finished on", "enddate"),
            gpa: get("gpa"),
            coursework: get("coursework", "relevant coursework"),
          });
        else if (get("company name", "company", "employer") || type === "experience")
          append("experience", {
            company: get("company name", "company", "employer"),
            title: get("title", "position"),
            location: get("location"),
            startDate: get("start date", "started on", "startdate"),
            endDate: get("end date", "finished on", "enddate"),
            bullets: get("bullets", "description", "responsibilities"),
          });
        else if (get("project name") || type === "project" || /projects?\.csv$/i.test(name))
          append("project", {
            name: get("project name", "name", "title"),
            description: get("description"),
            technologies: get("technologies", "tech stack"),
            url: get("url", "project url"),
            contribution: get("contribution", "individual contribution"),
          });
        else if (get("skill") || type === "skill" || /skills?\.csv$/i.test(name))
          append("skill", { name: get("skill", "name") });
        else if (get("achievement") || type === "achievement")
          append("achievement", { text: get("achievement", "text", "description") });
      }
    }
    if (!records.length)
      issues.push(
        "No supported profile records were identified. Review the source text or use the documented CSV/JSON columns.",
      );
  } catch (error) {
    issues.push(error instanceof Error ? error.message : "Structured extraction failed.");
  }
  return { format, records, issues: [...new Set(issues)].slice(0, 10) };
}
