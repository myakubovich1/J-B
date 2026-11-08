import { z } from "zod";
import { checkOrigin, errorResponse, HttpError, readForm, requireUser } from "@/lib/http";
import { enforceRateLimit } from "@/lib/auth";
import {
  getTemplateAssets,
  MAX_TEMPLATE_ASSET_BYTES,
  MAX_TEMPLATE_ASSETS,
  MAX_TEMPLATE_BUNDLE_BYTES,
  readTemplateAssets,
  saveTemplateAssets,
} from "@/lib/template-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const templateId = z.string().uuid().parse(url.searchParams.get("templateId"));
    const assets = await getTemplateAssets(user.id, templateId);
    const name = url.searchParams.get("name");
    if (name) {
      const asset = assets.find((item) => item.name === name);
      if (!asset) throw new HttpError("Supporting image not found.", 404);
      const file = (await readTemplateAssets(user.id, templateId)).find(
        (item) => item.name === name,
      )!;
      return new Response(new Uint8Array(file.bytes), {
        headers: {
          "Content-Type": asset.contentType,
          "Content-Disposition": `attachment; filename="${asset.name}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    return Response.json(
      { assets: assets.map(({ name, size, sha256 }) => ({ name, size, sha256 })) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(`template-assets:${user.id}`, 10, 300);
    const form = await readForm(request, MAX_TEMPLATE_BUNDLE_BYTES + 65536);
    const templateId = z.string().uuid().parse(form.get("templateId"));
    const files = form.getAll("files");
    if (!files.length || files.length > MAX_TEMPLATE_ASSETS)
      throw new HttpError("Upload between one and six supporting images.");
    if (files.some((file) => !(file instanceof File) || file.size > MAX_TEMPLATE_ASSET_BYTES))
      throw new HttpError("Choose PNG/JPEG supporting images of at most 1 MB each.", 413);
    const assets = await saveTemplateAssets(
      user.id,
      templateId,
      await Promise.all(
        files.map(async (file) => ({
          name: (file as File).name,
          bytes: Buffer.from(await (file as File).arrayBuffer()),
        })),
      ),
    );
    return Response.json(
      { assets: assets.map(({ name, size, sha256 }) => ({ name, size, sha256 })) },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
