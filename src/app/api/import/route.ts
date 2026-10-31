import { z } from "zod";
import { requireUser, checkOrigin, errorResponse, HttpError, readForm } from "@/lib/http";
import { getStore } from "@/lib/store";
import { writeArtifact } from "@/lib/storage";
import { entity } from "@/lib/contracts";
import { validateCustomTemplate } from "@/lib/resume";
import { enforceRateLimit } from "@/lib/auth";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(`document-import:${user.id}`, 10, 300);
    if (Number(request.headers.get("content-length") ?? 0) > 6_000_000)
      throw new HttpError("Please upload a file smaller than 5 MB.", 413);
    const form = await readForm(request, 6_000_000);
    const file = form.get("file");
    if (!(file instanceof File) || file.size > 5_000_000 || !file.size)
      throw new HttpError("Choose a nonempty document up to 5 MB.");
    const name = file.name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 150),
      bytes = Buffer.from(await file.arrayBuffer());
    if (form.get("kind") === "template") {
      if (!name.endsWith(".tex"))
        throw new HttpError("Custom templates must be .tex source files.");
      const source = bytes.toString("utf8");
      const errors = validateCustomTemplate(source);
      if (errors.length) throw new HttpError(errors.join(" "));
      const track = z
        .enum(["software", "finance", "consulting", "product", "general"])
        .parse(form.get("track") || "general");
      const template = await getStore().save("resume_templates", {
        ...entity(user.id),
        name: name.replace(/\.tex$/, ""),
        track,
        source,
        custom: true,
        license: "User supplied — you must hold appropriate rights",
      });
      return Response.json({ template });
    }
    if (!/\.(pdf|txt|md|json|tex|csv)$/i.test(name))
      throw new HttpError("Supported formats are PDF, TXT, MD, JSON, CSV, and TeX.");
    if ((await getStore().list("profile_sources", user.id)).length >= 100)
      throw new HttpError(
        "The workspace source limit is reached. Contact the operator to adjust it.",
        429,
      );
    const key = await writeArtifact(
      user.id,
      `imports/${crypto.randomUUID()}-${name}`,
      bytes,
      file.type || "application/octet-stream",
    );
    const source = await getStore().save("profile_sources", {
      ...entity(user.id),
      name,
      kind: name.split(".").pop() ?? "document",
      storageKey: key,
      url: null,
      text: "",
      status: "queued",
      importedAt: new Date().toISOString(),
    });
    await getStore().save("agent_runs", {
      ...entity(user.id),
      kind: "import",
      applicationId: "",
      status: "queued",
      stage: "reading_job",
      attempts: 0,
      maxAttempts: 2,
      leaseUntil: null,
      nextAttemptAt: new Date().toISOString(),
      error: null,
      approved: false,
      submitted: false,
      input: { sourceId: source.id },
    });
    await getStore().save("agent_actions", {
      ...entity(user.id),
      action: "document.imported",
      applicationId: null,
      details: { sourceId: source.id },
    });
    return Response.json({ source, reviewRequired: true }, { status: 202 });
  } catch (e) {
    return errorResponse(e);
  }
}
