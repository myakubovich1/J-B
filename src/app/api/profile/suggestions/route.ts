import { z } from "zod";
import { checkOrigin, errorResponse, HttpError, readJson, requireUser } from "@/lib/http";
import { enforceRateLimit } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { extractImportRecords } from "@/lib/import-review";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(`import-review:${user.id}`, 20, 300);
    const { sourceId } = z.object({ sourceId: z.string().uuid() }).parse(await readJson(request));
    const source = await getStore().get("profile_sources", sourceId, user.id);
    if (!source) throw new HttpError("Source not found.", 404);
    if (source.status === "queued" || source.status === "failed")
      throw new HttpError("Wait for source extraction to finish successfully.");
    const structured = extractImportRecords(source.name, source.text);
    if (!structured)
      throw new HttpError(
        "Structured review supports CSV and JSON sources. Other source text can be added to the evidence bank.",
      );
    const updated = await getStore().save("profile_sources", { ...source, structured });
    return Response.json({ source: updated }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
