import { getBrowserHandoff } from "@/lib/browser";
import { errorResponse, HttpError, requireUser } from "@/lib/http";
import { enforceRateLimit } from "@/lib/auth";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    await enforceRateLimit(`browser-handoff:${user.id}`, 20, 60);
    const { id } = await context.params;
    const url = await getBrowserHandoff(user.id, id);
    if (!url)
      throw new HttpError(
        "This run has no active secure browser handoff. Open the employer portal manually or configure Browserbase.",
        404,
      );
    return Response.json(
      { url },
      {
        headers: {
          "Cache-Control": "private, no-store",
          Pragma: "no-cache",
          "Referrer-Policy": "no-referrer",
        },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
