import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const run = promisify(execFile);
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
/** Extract text for user review. Imported assertions remain unconfirmed until explicitly accepted. */
export async function extractDocument(fileName: string, bytes: Buffer): Promise<string> {
  if (!bytes.length || bytes.length > MAX_IMPORT_BYTES)
    throw new Error("Import a nonempty file of at most 10 MB.");
  const extension = path.extname(fileName).toLowerCase();
  if ([".txt", ".md", ".json", ".csv", ".tex"].includes(extension)) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\u0000")) throw new Error("Binary content is not accepted as text.");
    if (extension === ".json") JSON.parse(text);
    return text.slice(0, 100000);
  }
  if (extension !== ".pdf")
    throw new Error(
      "Supported imports: PDF, TXT, Markdown, JSON, CSV, and LaTeX source. LinkedIn exports can be imported as CSV.",
    );
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
    throw new Error("The uploaded file is not a PDF.");
  const directory = await mkdtemp(path.join(os.tmpdir(), "career-import-"));
  try {
    const filename = path.join(directory, "document.pdf");
    await writeFile(filename, bytes, { mode: 0o600 });
    const info = await run("pdfinfo", [filename], { timeout: 10000, maxBuffer: 65536 });
    const pages = Number(info.stdout.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0);
    if (pages < 1 || pages > 30) throw new Error("Import PDFs with 1–30 pages.");
    const result = await run("pdftotext", ["-layout", filename, "-"], {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    const text = result.stdout.trim().slice(0, 100000);
    if (text.length < 20)
      throw new Error(
        "No readable text found. Upload a text-based PDF or paste the information manually; OCR is not configured.",
      );
    return text;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error("Document parsing unavailable: install Poppler in the worker environment.");
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
