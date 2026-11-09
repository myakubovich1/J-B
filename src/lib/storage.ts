import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { appMode, dataDirectory, supabaseService } from "./store";

const bucket = () => process.env.SUPABASE_STORAGE_BUCKET || "jb-artifacts";
function validUser(userId: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(userId)) throw new Error("Invalid artifact owner");
}
function safeKey(userId: string, key: string): void {
  validUser(userId);
  if (
    !key.startsWith(userId + "/") ||
    key.includes("\\") ||
    key.split("/").some((x) => !x || x === ".." || x === ".")
  )
    throw new Error("Artifact access denied");
}
export async function writeArtifact(
  userId: string,
  name: string,
  bytes: Buffer,
  contentType: string,
): Promise<string> {
  validUser(userId);
  if (bytes.length > 15 * 1024 * 1024) throw new Error("Artifact exceeds 15 MB limit");
  const filename = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150) || "artifact";
  const key = `${userId}/${crypto.randomUUID()}-${filename}`;
  if (appMode() === "supabase") {
    const { error } = await supabaseService()
      .storage.from(bucket())
      .upload(key, bytes, { contentType, upsert: false });
    if (error) throw error;
    return key;
  }
  const target = path.join(dataDirectory(), "artifacts", key);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, bytes, { mode: 0o600 });
  return key;
}
export async function readArtifact(userId: string, key: string): Promise<Buffer> {
  safeKey(userId, key);
  if (appMode() === "supabase") {
    const { data, error } = await supabaseService().storage.from(bucket()).download(key);
    if (error || !data) throw new Error("Artifact not found");
    return Buffer.from(await data.arrayBuffer());
  }
  return readFile(path.join(dataDirectory(), "artifacts", key));
}
/** Delete one owner-scoped private object, never a directory or another owner's key. */
export async function deleteArtifact(userId: string, key: string): Promise<void> {
  safeKey(userId, key);
  if (appMode() === "supabase") {
    const { error } = await supabaseService().storage.from(bucket()).remove([key]);
    if (error) throw error;
    return;
  }
  try {
    await unlink(path.join(dataDirectory(), "artifacts", key));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
