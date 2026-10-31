import { requireUser, errorResponse } from "@/lib/http";
import { providerSchema, completeConnection } from "@/lib/integrations";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  try {
    const user = await requireUser(),
      provider = providerSchema.parse((await context.params).provider),
      params = new URL(request.url).searchParams,
      code = params.get("code"),
      state = params.get("state");
    if (!code || !state) throw new Error("Authorization was declined or expired.");
    await completeConnection(user.id, provider, code, state);
    return Response.redirect(
      `${process.env.APP_URL || new URL(request.url).origin}/?integration=connected#integrations`,
      302,
    );
  } catch (e) {
    return errorResponse(e);
  }
}
