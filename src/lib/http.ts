import { z } from "zod";
import { currentUser } from "./auth";
import type { User } from "./contracts";

export class HttpError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new HttpError("Please sign in to continue.", 401);
  return user;
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(process.env.APP_URL || request.url).origin;
  if (origin && origin !== expected) throw new HttpError("Request origin is not allowed.", 403);
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site") throw new HttpError("Cross-site requests are not allowed.", 403);
}
export async function readJson(request: Request): Promise<unknown> {
  const text = (await readBoundedBody(request, 1_048_576)).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError("Please send valid JSON.");
  }
}
export async function readBoundedBody(request: Request, maxBytes: number): Promise<Buffer> {
  if (Number(request.headers.get("content-length") || 0) > maxBytes)
    throw new HttpError("Request is too large.", 413);
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new HttpError("Request is too large.", 413);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
export async function readForm(request: Request, maxBytes: number): Promise<FormData> {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data"))
    throw new HttpError("Send a multipart file upload.");
  return new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: new Uint8Array(await readBoundedBody(request, maxBytes)),
  }).formData();
}
export function errorResponse(error: unknown): Response {
  if (error instanceof z.ZodError)
    return Response.json(
      { error: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 },
    );
  if (error instanceof HttpError)
    return Response.json({ error: error.message }, { status: error.status });
  const message = error instanceof Error ? error.message : "Request failed.";
  // Integrations return actionable configuration/errors; never serialize stack traces or request data.
  return Response.json(
    { error: message.replace(/(?:sk-|sb_secret_)[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 500) },
    { status: message.startsWith("Too many") ? 429 : 400 },
  );
}
