import { z } from "zod";
import { checkOrigin, errorResponse, HttpError, readJson, requireUser } from "@/lib/http";
import { enforceRateLimit } from "@/lib/auth";
import { getResumeSettings, resetResumeSettings, saveResumeSettings } from "@/lib/resume";
import { resumeSettingsSchema } from "@/lib/resume-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const templateId = z.enum(["jakes", "technical", "finance", "consulting", "product", "general"]);
const changeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), templateId, settings: resumeSettingsSchema }).strict(),
  z.object({ action: z.literal("reset"), templateId }).strict(),
]);
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const id = templateId.safeParse(new URL(request.url).searchParams.get("templateId"));
    if (!id.success) throw new HttpError("Choose a built-in resume template.");
    return Response.json(
      { settings: await getResumeSettings(user.id, id.data) },
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(`resume-settings:${user.id}`, 30, 60);
    const data = changeSchema.parse(await readJson(request));
    const settings =
      data.action === "reset"
        ? await resetResumeSettings(user.id, data.templateId)
        : await saveResumeSettings(user.id, data.templateId, data.settings);
    return Response.json({ settings }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
