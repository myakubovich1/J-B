import { z } from "zod";
import { enforceRateLimit } from "@/lib/auth";
import { checkOrigin, errorResponse, readJson, requireUser } from "@/lib/http";
import { deleteAccount, exportAccount, signOutEverywhere } from "@/lib/account";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Download every record the account owns as JSON. */
export async function GET() {
  try {
    const user = await requireUser();
    await enforceRateLimit(`account-export:${user.id}`, 5, 3600);
    return new Response(JSON.stringify(await exportAccount(user), null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename=waypoint-export-${new Date().toISOString().slice(0, 10)}.json`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    z.object({ action: z.literal("signout-all") }).parse(await readJson(request));
    await signOutEverywhere(user);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(`account-delete:${user.id}`, 5, 3600);
    const { confirmEmail } = z
      .object({ confirmEmail: z.string().max(254) })
      .parse(await readJson(request));
    return Response.json({ ok: true, ...(await deleteAccount(user, confirmEmail)) });
  } catch (error) {
    return errorResponse(error);
  }
}
