import { z } from "zod";
import { requireUser, checkOrigin, errorResponse, readJson } from "@/lib/http";
import { listGithubRepos, importGithubRepos } from "@/lib/github";
import { getStore } from "@/lib/store";
import { integrationToken } from "@/lib/integrations";
import { enforceRateLimit } from "@/lib/auth";
export const runtime = "nodejs";
async function connection(userId: string) {
  const connected = (await getStore().list("integration_connections", userId)).find(
    (i) => i.provider === "github" && i.status === "connected",
  );
  return connected
    ? { account: connected.account, token: await integrationToken(userId, connected) }
    : null;
}
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    await enforceRateLimit(`github-read:${user.id}`, 15, 300);
    const connected = await connection(user.id),
      username = connected?.account || new URL(request.url).searchParams.get("username") || "";
    return Response.json(
      { repositories: await listGithubRepos(username, connected?.token) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(`github-import:${user.id}`, 5, 300);
    const data = z
      .object({ repositories: z.array(z.string()).min(1).max(20) })
      .parse(await readJson(request));
    const connected = await connection(user.id);
    return Response.json({
      imported: await importGithubRepos(user.id, data.repositories, connected?.token),
      reviewRequired: true,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
