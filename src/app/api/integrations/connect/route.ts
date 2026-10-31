import { requireUser, errorResponse } from "@/lib/http";
import { providerSchema, beginConnection } from "@/lib/integrations";
import { enforceRateLimit } from "@/lib/auth";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    await enforceRateLimit(`oauth:${user.id}`, 10, 300);
    const params = new URL(request.url).searchParams;
    return Response.redirect(
      await beginConnection(
        user.id,
        providerSchema.parse(params.get("provider")),
        params.get("private") === "true",
      ),
      302,
    );
  } catch (e) {
    return errorResponse(e);
  }
}
