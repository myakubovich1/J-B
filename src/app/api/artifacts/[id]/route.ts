import { getStore } from "@/lib/store";
import { readArtifact } from "@/lib/storage";
import { errorResponse, HttpError, requireUser } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const resume = await getStore().get("generated_resumes", id, user.id);
    if (!resume) throw new HttpError("Resume not found.", 404);
    const tex = new URL(request.url).searchParams.get("format") === "tex";
    const key = tex ? resume.texKey : resume.pdfKey;
    if (!key)
      throw new HttpError("The PDF is unavailable. Check the resume validation details.", 404);
    const bytes = await readArtifact(user.id, key);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": tex ? "text/plain; charset=utf-8" : "application/pdf",
        "Content-Disposition": `${tex ? "attachment" : "inline"}; filename="resume-${id.slice(0, 8)}.${tex ? "tex" : "pdf"}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
