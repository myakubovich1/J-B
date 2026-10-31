import { z } from "zod";
import { entity, profileSchema, type AgentRun } from "@/lib/contracts";
import { getStore } from "@/lib/store";
import { getWorkspace } from "@/lib/workspace";
import { checkOrigin, errorResponse, HttpError, readJson, requireUser } from "@/lib/http";
import { enqueueApplication, resolveApproval } from "@/lib/agent";
import { validateJobUrl } from "@/lib/jobs";
import { getPlanState } from "@/lib/billing";
import { normalizeProfile } from "@/lib/profile";
import { enforceRateLimit } from "@/lib/auth";
import { careerReply } from "@/lib/chat";
import { ensureDiscoveryScheduled } from "@/lib/discovery";
import { retryApplication } from "@/lib/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return Response.json(await getWorkspace(await requireUser()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_profile"), profile: profileSchema }),
  z.object({ action: z.literal("apply"), url: z.string().url().max(3000) }),
  z.object({ action: z.literal("chat"), message: z.string().min(1).max(5000) }),
  z.object({
    action: z.literal("generate_resume"),
    templateId: z.string().max(200),
    track: z.enum(["software", "finance", "consulting", "product", "general"]),
  }),
  z.object({
    action: z.literal("resolve_approval"),
    id: z.string().uuid(),
    decision: z.enum(["approve", "deny"]),
    answers: z.record(z.string(), z.string().max(4000)).default({}),
  }),
  z.object({
    action: z.literal("application_status"),
    id: z.string().uuid(),
    status: z.enum(["interview", "rejected", "offer", "withdrawn"]),
  }),
  z.object({ action: z.literal("retry_application"), id: z.string().uuid() }),
  z.object({
    action: z.literal("save_answer"),
    question: z.string().min(1).max(500),
    key: z.string().min(1).max(200),
    answer: z.string().min(1).max(4000),
    scope: z.string().max(500).default("global"),
    sensitive: z.boolean().default(false),
  }),
  z.object({ action: z.literal("delete_answer"), id: z.string().uuid() }),
  z.object({
    action: z.literal("save_source"),
    name: z.string().min(1).max(200),
    url: z.string().url().max(2000),
    kind: z.enum(["github", "greenhouse", "lever"]),
  }),
  z.object({ action: z.literal("toggle_source"), id: z.string().uuid(), enabled: z.boolean() }),
  z.object({ action: z.literal("read_notifications") }),
  z.object({ action: z.literal("restore_profile"), id: z.string().uuid() }),
]);
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(`workspace-write:${user.id}`, 60, 60);
    const data = actionSchema.parse(await readJson(request));
    const db = getStore();
    switch (data.action) {
      case "save_profile": {
        const old = (await db.list("candidate_profiles", user.id))[0];
        if (data.profile.autonomy.enabled) {
          const plan = await getPlanState(user.id);
          if (!plan.discovery)
            throw new HttpError("Standing authorization requires the Autonomous plan.", 403);
          if (!data.profile.autonomy.allowedDomains.length || !data.profile.autonomy.approvedAt)
            throw new HttpError(
              "Choose allowed employer domains and explicitly confirm standing authorization.",
            );
        }
        if (old) await db.save("profile_versions", { ...old, id: crypto.randomUUID() });
        await db.save("candidate_profiles", {
          ...entity(user.id, old?.id ?? user.id),
          createdAt: old?.createdAt ?? new Date().toISOString(),
          profile: normalizeProfile(data.profile),
          version: (old?.version ?? 0) + 1,
        });
        await db.save("agent_actions", {
          ...entity(user.id),
          action: "profile.saved",
          applicationId: null,
          details: { version: (old?.version ?? 0) + 1 },
        });
        await ensureDiscoveryScheduled(user.id);
        break;
      }
      case "apply":
        return Response.json(
          { application: await enqueueApplication(user.id, data.url) },
          { status: 202 },
        );
      case "chat": {
        const url = data.message.match(/https?:\/\/[^\s<>]+/)?.[0]?.replace(/[),.!?]+$/, "");
        if (url)
          return Response.json(
            { application: await enqueueApplication(user.id, url) },
            { status: 202 },
          );
        await db.save("messages", {
          ...entity(user.id),
          role: "user",
          content: data.message,
          applicationId: null,
        });
        await enforceRateLimit(`chat:${user.id}`, 15, 300);
        await db.save("messages", {
          ...entity(user.id),
          role: "assistant",
          content: await careerReply(user.id, data.message),
          applicationId: null,
        });
        break;
      }
      case "generate_resume": {
        const profile = (await db.list("candidate_profiles", user.id))[0]?.profile;
        if (
          !profile?.legalName ||
          !(
            profile.education.length ||
            profile.experiences.some((e) => e.confirmed) ||
            profile.projects.some((p) => p.confirmed)
          )
        )
          throw new HttpError(
            "Save your name and at least one education record, confirmed experience, or confirmed project first.",
          );
        const active = (await db.list("agent_runs", user.id)).filter(
          (r) => r.kind === "resume" && ["queued", "running"].includes(r.status),
        );
        if (active.length >= 2)
          throw new HttpError(
            "Two resumes are already being prepared. Please wait for a worker to finish.",
            429,
          );
        if (
          (await db.list("generated_resumes", user.id)).filter((r) =>
            r.createdAt.startsWith(new Date().toISOString().slice(0, 7)),
          ).length >= Number(process.env.MAX_RESUMES_PER_MONTH || 300)
        )
          throw new HttpError("Your configured monthly resume generation limit is reached.", 429);
        const run: AgentRun = {
          ...entity(user.id),
          applicationId: "",
          kind: "resume",
          status: "queued",
          stage: "selecting_resume",
          attempts: 0,
          maxAttempts: 2,
          leaseUntil: null,
          nextAttemptAt: new Date().toISOString(),
          error: null,
          approved: false,
          submitted: false,
          input: { templateId: data.templateId, track: data.track },
        };
        await db.save("agent_runs", run);
        return Response.json({ run }, { status: 202 });
      }
      case "resolve_approval":
        await resolveApproval(user.id, data.id, data.decision, data.answers);
        break;
      case "retry_application":
        await retryApplication(user.id, data.id);
        break;
      case "application_status": {
        const app = await db.get("applications", data.id, user.id);
        if (!app) throw new HttpError("Application not found.", 404);
        if (data.status === "withdrawn" && app.submissionStartedAt && !app.receipt)
          throw new HttpError(
            "Submission has already started. Verify the portal receipt before changing its status.",
          );
        if (data.status !== "withdrawn" && !app.receipt)
          throw new HttpError("This application has no verified receipt yet.");
        await db.save("applications", {
          ...app,
          status: data.status,
          updatedAt: new Date().toISOString(),
        });
        await db.save("application_events", {
          ...entity(user.id),
          applicationId: app.id,
          runId: app.runId,
          stage: "completed",
          message: `You updated the application status to ${data.status}.`,
        });
        if (data.status === "withdrawn" && !app.receipt) {
          const run = await db.get("agent_runs", app.runId, user.id);
          if (run)
            await db.save("agent_runs", {
              ...run,
              status: "failed",
              stage: "failed",
              error: "Withdrawn by user.",
              leaseUntil: null,
            });
        }
        break;
      }
      case "save_answer":
        await db.save("screening_answers", {
          ...entity(user.id),
          question: data.question,
          key: data.key,
          answer: data.answer,
          scope: data.scope,
          confirmed: true,
          effectiveFrom: new Date().toISOString(),
          effectiveUntil: null,
          sensitive: data.sensitive,
        });
        break;
      case "delete_answer":
        await db.remove("screening_answers", data.id, user.id);
        break;
      case "save_source": {
        await validateJobUrl(data.url);
        const host = new URL(data.url).hostname;
        if (data.kind === "github" && host !== "github.com")
          throw new HttpError("GitHub sources must use github.com repository URLs.");
        if ((await db.list("job_sources", user.id)).some((s) => s.url === data.url))
          throw new HttpError("This source is already being monitored.");
        await db.save("job_sources", {
          ...entity(user.id),
          name: data.name,
          url: data.url,
          kind: data.kind,
          enabled: true,
          lastCheckedAt: null,
          lastRevision: null,
          error: null,
        });
        await ensureDiscoveryScheduled(user.id);
        break;
      }
      case "toggle_source": {
        const source = await db.get("job_sources", data.id, user.id);
        if (!source) throw new HttpError("Source not found.", 404);
        await db.save("job_sources", { ...source, enabled: data.enabled });
        await ensureDiscoveryScheduled(user.id);
        break;
      }
      case "read_notifications":
        await Promise.all(
          (await db.list("notifications", user.id))
            .filter((n) => !n.read)
            .map((n) => db.save("notifications", { ...n, read: true })),
        );
        break;
      case "restore_profile": {
        const version = await db.get("profile_versions", data.id, user.id);
        if (!version) throw new HttpError("Profile version not found.", 404);
        const current = (await db.list("candidate_profiles", user.id))[0];
        if (current) await db.save("profile_versions", { ...current, id: crypto.randomUUID() });
        await db.save("candidate_profiles", {
          ...version,
          id: current?.id ?? user.id,
          version: (current?.version ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        });
        break;
      }
    }
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
