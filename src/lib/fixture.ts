import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { dataDirectory } from "./store";
import { extractDocument } from "./imports";

export function fixtureEnabled(): boolean {
  return (
    process.env.ENABLE_TEST_EMPLOYER === "true" &&
    (process.env.APP_MODE || "local") === "local" &&
    process.env.NODE_ENV !== "production"
  );
}
export const fixtureJob = {
  title: "Software Engineering Intern",
  company: "Northstar Labs (test employer)",
  location: "New York, United States",
  description:
    "<p>This is a local test employer for application workflow verification. No application is sent to a real company.</p><p>Build thoughtful developer tools alongside a small engineering team.</p><ul><li>Experience with TypeScript, Python, or React through coursework or projects.</li><li>Interest in building accessible web applications and reliable APIs.</li><li>Currently enrolled in a relevant degree program or equivalent experience.</li></ul><p>Summer internship. Location: New York, United States. Confirm work authorization and sponsorship requirements directly in the application.</p>",
};
export function fixturePosting() {
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    identifier: {
      "@type": "PropertyValue",
      name: "Northstar test employer",
      value: "software-intern",
    },
    title: fixtureJob.title,
    description: fixtureJob.description,
    hiringOrganization: { "@type": "Organization", name: fixtureJob.company },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: "New York",
        addressCountry: "United States",
      },
    },
    employmentType: "INTERN",
    directApply: true,
  };
}
export interface FixtureReceipt {
  id: string;
  applicationId: string;
  createdAt: string;
  pdfHash: string;
  pdfBytes: number;
  fieldNames: string[];
}
const databases = new Map<string, DatabaseSync>();
function fixtureDb(): DatabaseSync {
  if (!fixtureEnabled()) throw new Error("The test employer is disabled.");
  const filename = path.join(dataDirectory(), "fixture.db");
  const cached = databases.get(filename);
  if (cached) return cached;
  mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000; CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, application_id TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL, pdf_hash TEXT NOT NULL, pdf_bytes INTEGER NOT NULL, field_names TEXT NOT NULL);",
  );
  databases.set(filename, db);
  return db;
}
function receipt(row: Record<string, unknown> | undefined): FixtureReceipt | null {
  return row
    ? {
        id: String(row.id),
        applicationId: String(row.application_id),
        createdAt: String(row.created_at),
        pdfHash: String(row.pdf_hash),
        pdfBytes: Number(row.pdf_bytes),
        fieldNames: JSON.parse(String(row.field_names)) as string[],
      }
    : null;
}
export function getFixtureReceipt(id: string): FixtureReceipt | null {
  if (!z.string().uuid().safeParse(id).success) return null;
  return receipt(
    fixtureDb().prepare("SELECT * FROM receipts WHERE id=?").get(id) as
      Record<string, unknown> | undefined,
  );
}
export function getFixtureReceiptForApplication(applicationId: string): FixtureReceipt | null {
  return receipt(
    fixtureDb().prepare("SELECT * FROM receipts WHERE application_id=?").get(applicationId) as
      Record<string, unknown> | undefined,
  );
}
const formSchema = z
  .object({
    first_name: z.string().trim().min(1).max(100),
    last_name: z.string().trim().min(1).max(150),
    email: z.string().email().max(254),
    phone: z.string().trim().min(3).max(50),
    location: z.string().trim().min(2).max(250),
    work_authorization: z.enum(["yes", "no"]),
    sponsorship: z.enum(["yes", "no"]),
    sponsorship_details: z.string().max(4000).optional(),
    portfolio: z.string().max(2000).optional(),
    external_application_id: z.string().uuid(),
  })
  .refine((data) => data.sponsorship !== "yes" || Boolean(data.sponsorship_details?.trim()), {
    path: ["sponsorship_details"],
    message: "Describe the sponsorship you would need; do not infer or invent an answer.",
  });

export async function acceptFixtureApplication(form: FormData): Promise<FixtureReceipt> {
  if (!fixtureEnabled()) throw new Error("The test employer is disabled.");
  const submitted = formSchema.parse(
    Object.fromEntries([...form.entries()].filter(([key]) => key !== "resume")),
  );
  const file = form.get("resume");
  if (!(file instanceof File) || !file.size || file.size > 5 * 1024 * 1024)
    throw new Error("Upload a nonempty PDF resume of at most 5 MB.");
  if (file.type !== "application/pdf") throw new Error("The resume must be a PDF.");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
    throw new Error("The uploaded resume does not contain a PDF.");
  await extractDocument("resume.pdf", bytes);
  const pdfHash = createHash("sha256").update(bytes).digest("hex");
  const existing = getFixtureReceiptForApplication(submitted.external_application_id);
  if (existing) {
    if (existing.pdfHash !== pdfHash)
      throw new Error(
        "This application was already received with a different resume. It will not be resubmitted.",
      );
    return existing;
  }
  const result: FixtureReceipt = {
    id: crypto.randomUUID(),
    applicationId: submitted.external_application_id,
    createdAt: new Date().toISOString(),
    pdfHash,
    pdfBytes: bytes.length,
    fieldNames: [...form.keys()].filter((key) => key !== "external_application_id"),
  };
  // Keep receipt evidence only. Candidate values and uploaded PDF bytes are not retained by the test employer.
  fixtureDb()
    .prepare(
      "INSERT INTO receipts(id,application_id,created_at,pdf_hash,pdf_bytes,field_names) VALUES(?,?,?,?,?,?) ON CONFLICT(application_id) DO NOTHING",
    )
    .run(
      result.id,
      result.applicationId,
      result.createdAt,
      result.pdfHash,
      result.pdfBytes,
      JSON.stringify(result.fieldNames),
    );
  const saved = getFixtureReceiptForApplication(result.applicationId);
  if (!saved || saved.pdfHash !== pdfHash)
    throw new Error("A conflicting test application already exists.");
  return saved;
}

/** Read multipart bodies with a hard bound, including requests without Content-Length. */
export async function readFixtureForm(request: Request): Promise<FormData> {
  const maxBytes = 5 * 1024 * 1024 + 65536;
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data"))
    throw new Error("Submit the employer application form with a PDF upload.");
  if (Number(request.headers.get("content-length") || 0) > maxBytes)
    throw new Error("The application upload is too large.");
  if (!request.body) throw new Error("Application form is empty.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new Error("The application upload is too large.");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: new Uint8Array(Buffer.concat(chunks)),
  }).formData();
}
