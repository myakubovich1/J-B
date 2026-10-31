import { requireUser, errorResponse, HttpError } from "@/lib/http";
import { getStore } from "@/lib/store";
import { readArtifact } from "@/lib/storage";
export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(),
      application = await getStore().get("applications", (await context.params).id, user.id);
    if (!application?.receipt?.screenshotKey)
      throw new HttpError("Portal evidence not found.", 404);
    return new Response(
      new Uint8Array(await readArtifact(user.id, application.receipt.screenshotKey)),
      {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "private, no-store",
          "Content-Disposition": "inline; filename=portal-receipt.png",
        },
      },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
