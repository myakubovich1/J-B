import { checkOrigin, requireUser, errorResponse } from "@/lib/http";
import { getStore } from "@/lib/store";
import { entity } from "@/lib/contracts";
import { getPlanState } from "@/lib/billing";
import { enforceRateLimit } from "@/lib/auth";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(`email-sync:${user.id}`, 2, 300);
    if (!(await getPlanState(user.id)).discovery)
      throw new Error("Email monitoring requires the Autonomous plan.");
    const store = getStore();
    if (
      !(await store.list("integration_connections", user.id)).some(
        (c) => c.status === "connected" && ["gmail", "outlook"].includes(c.provider),
      )
    )
      throw new Error("Connect an inbox before checking correspondence.");
    if (
      !(await store.list("agent_runs", user.id)).some(
        (r) => r.kind === "email" && ["queued", "running"].includes(r.status),
      )
    )
      await store.save("agent_runs", {
        ...entity(user.id),
        applicationId: "",
        kind: "email",
        status: "queued",
        stage: "reading_job",
        attempts: 0,
        maxAttempts: 2,
        leaseUntil: null,
        nextAttemptAt: new Date().toISOString(),
        error: null,
        approved: false,
        submitted: false,
      });
    return Response.json({ queued: true }, { status: 202 });
  } catch (e) {
    return errorResponse(e);
  }
}
