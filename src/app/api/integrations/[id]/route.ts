import { checkOrigin, requireUser, errorResponse } from "@/lib/http";
import { disconnectIntegration } from "@/lib/integrations";
export const runtime = "nodejs";
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    await disconnectIntegration(user.id, (await context.params).id);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
