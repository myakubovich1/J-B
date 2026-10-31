import { getStore } from "@/lib/store";
import { requireUser, errorResponse } from "@/lib/http";
export async function GET() {
  try {
    const user = await requireUser();
    return Response.json(
      {
        versions: await getStore().list("profile_versions", user.id),
        sources: await getStore().list("profile_sources", user.id),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
