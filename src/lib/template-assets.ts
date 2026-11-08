import { createHash } from "node:crypto";
import { entity, type TemplateAsset } from "./contracts";
import { getStore } from "./store";
import { deleteArtifact, readArtifact, writeArtifact } from "./storage";
import { HttpError } from "./http";

export const MAX_TEMPLATE_ASSETS = 6;
export const MAX_TEMPLATE_ASSET_BYTES = 1_000_000;
export const MAX_TEMPLATE_BUNDLE_BYTES = 3_000_000;
export type CompileAsset = { name: string; bytes: Buffer };
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function bundleId(userId: string, templateId: string): string {
  const value = hash(Buffer.from(`template-assets:${userId}:${templateId}`));
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`;
}
export function validateTemplateAsset(name: string, bytes: Buffer): TemplateAsset["contentType"] {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\.(png|jpe?g)$/i.test(name))
    throw new HttpError(
      "Use flat PNG/JPEG filenames such as logo.png, without paths, spaces, or scripts.",
    );
  if (!bytes.length || bytes.length > MAX_TEMPLATE_ASSET_BYTES)
    throw new HttpError("Each supporting image must be nonempty and at most 1 MB.", 413);
  let width = 0,
    height = 0;
  const png = name.toLowerCase().endsWith(".png");
  if (png) {
    if (
      bytes.length < 24 ||
      !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.toString("ascii", 12, 16) !== "IHDR"
    )
      throw new HttpError("The supporting image does not contain a valid PNG header.");
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
      throw new HttpError("The supporting image does not contain a valid JPEG header.");
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        ) &&
        length >= 7
      ) {
        height = bytes.readUInt16BE(offset + 3);
        width = bytes.readUInt16BE(offset + 5);
        break;
      }
      offset += length;
    }
  }
  if (!width || !height || width > 4096 || height > 4096)
    throw new HttpError(
      "Supporting images must have readable dimensions of at most 4096 × 4096 pixels.",
    );
  return png ? "image/png" : "image/jpeg";
}
export function validateTemplateAssets(assets: CompileAsset[]): void {
  if (!assets.length || assets.length > MAX_TEMPLATE_ASSETS)
    throw new HttpError("Upload between one and six supporting images.");
  if (assets.reduce((sum, asset) => sum + asset.bytes.length, 0) > MAX_TEMPLATE_BUNDLE_BYTES)
    throw new HttpError("A supporting-image bundle must be at most 3 MB.", 413);
  if (new Set(assets.map((asset) => asset.name.toLowerCase())).size !== assets.length)
    throw new HttpError("Supporting images must have distinct filenames.");
  for (const asset of assets) validateTemplateAsset(asset.name, asset.bytes);
}
async function customTemplate(userId: string, templateId: string) {
  const template = await getStore().get("resume_templates", templateId, userId);
  if (!template?.custom) throw new HttpError("Custom template not found.", 404);
  return template;
}
export async function getTemplateAssets(
  userId: string,
  templateId: string,
): Promise<TemplateAsset[]> {
  await customTemplate(userId, templateId);
  return (
    (await getStore().get("resume_templates", bundleId(userId, templateId), userId))?.assets || []
  );
}
export async function saveTemplateAssets(
  userId: string,
  templateId: string,
  files: CompileAsset[],
): Promise<TemplateAsset[]> {
  const template = await customTemplate(userId, templateId);
  validateTemplateAssets(files);
  const id = bundleId(userId, templateId);
  if (await getStore().get("resume_templates", id, userId))
    throw new HttpError(
      "This template's supporting images are fixed. Upload a new template version to replace them.",
      409,
    );
  const bundles = (await getStore().list("resume_templates", userId)).filter(
    (row) => row.assetBundleFor,
  );
  // Conservative admission limits; a distributed storage ledger is needed for a hard global byte cap.
  if (
    bundles.length >= 20 ||
    bundles.reduce(
      (sum, row) => sum + (row.assets || []).reduce((n, asset) => n + asset.size, 0),
      0,
    ) +
      files.reduce((sum, file) => sum + file.bytes.length, 0) >
      15_000_000
  )
    throw new HttpError("The workspace supporting-image allowance is reached.", 429);
  const uploadId = crypto.randomUUID(),
    uploaded: TemplateAsset[] = [];
  let claimAttempted = false;
  try {
    for (const file of files) {
      const contentType = validateTemplateAsset(file.name, file.bytes);
      const storageKey = await writeArtifact(
        userId,
        `template-${templateId}-${file.name}`,
        file.bytes,
        contentType,
      );
      uploaded.push({
        name: file.name,
        storageKey,
        contentType,
        size: file.bytes.length,
        sha256: hash(file.bytes),
      });
    }
    claimAttempted = true;
    const claimed = await getStore().createIfAbsent("resume_templates", {
      ...entity(userId, id),
      name: `${template.name} supporting images`,
      track: template.track,
      source: "",
      custom: false,
      license: template.license,
      assetBundleFor: templateId,
      assetUploadId: uploadId,
      assets: uploaded,
    });
    if (claimed.assetUploadId !== uploadId)
      throw new HttpError(
        "Supporting images were already saved by another request. Upload a new template version to replace them.",
        409,
      );
    return uploaded;
  } catch (error) {
    let safeToDelete = !claimAttempted;
    if (claimAttempted) {
      try {
        const current = await getStore().get("resume_templates", id, userId);
        safeToDelete = current?.assetUploadId !== uploadId;
      } catch {
        // A lost database response may conceal a committed manifest. Preserve its objects for recovery.
        console.error(
          JSON.stringify({
            level: "error",
            event: "template_asset_cleanup_deferred",
            category: "unknown_manifest_commit",
          }),
        );
      }
    }
    if (safeToDelete) {
      const cleanup = await Promise.allSettled(
        uploaded.map((asset) => deleteArtifact(userId, asset.storageKey)),
      );
      if (cleanup.some((result) => result.status === "rejected"))
        console.error(
          JSON.stringify({
            level: "error",
            event: "template_asset_cleanup_failed",
            category: "storage",
          }),
        );
    }
    throw error;
  }
}
export async function readTemplateAssets(
  userId: string,
  templateId: string,
): Promise<CompileAsset[]> {
  const assets = await getTemplateAssets(userId, templateId);
  const files: CompileAsset[] = [];
  for (const asset of assets) {
    const bytes = await readArtifact(userId, asset.storageKey);
    if (bytes.length !== asset.size || hash(bytes) !== asset.sha256)
      throw new Error(
        "A template image failed its integrity check. Upload a new template version.",
      );
    files.push({ name: asset.name, bytes });
  }
  if (files.length) validateTemplateAssets(files);
  return files;
}
