import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { appMode, dataDirectory, supabaseService } from "./store";

type Envelope = {
  userId: string;
  name: string;
  iv: string;
  tag: string;
  ciphertext: string;
};
function validId(value: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error("Invalid secret owner");
}
function validRef(ref: string) {
  if (!/^[a-f0-9-]{36}$/.test(ref)) throw new Error("Invalid secret reference");
}
async function key(): Promise<Buffer> {
  const root = dataDirectory();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const target = path.join(root, ".secrets.key");
  try {
    return await readFile(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const generated = randomBytes(32);
    try {
      await writeFile(target, generated, { flag: "wx", mode: 0o600 });
      return generated;
    } catch (conflict) {
      if ((conflict as NodeJS.ErrnoException).code !== "EEXIST") throw conflict;
      return readFile(target);
    }
  }
}
export async function setSecret(userId: string, name: string, value: string): Promise<string> {
  validId(userId);
  if (!value || value.length > 100000)
    throw new Error("Secret must contain between 1 and 100000 characters");
  if (appMode() === "supabase") {
    const { data, error } = await supabaseService().rpc("set_integration_secret", {
      p_user_id: userId,
      p_name: name.slice(0, 200),
      p_value: value,
    });
    if (error) throw new Error("Managed secret storage failed");
    return data as string;
  }
  const ref = crypto.randomUUID();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await key(), iv);
  cipher.setAAD(Buffer.from(`${userId}:${ref}`));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const envelope: Envelope = {
    userId,
    name: name.slice(0, 200),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  const root = path.join(dataDirectory(), "secrets");
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(path.join(root, `${ref}.json`), JSON.stringify(envelope), {
    mode: 0o600,
    flag: "wx",
  });
  return ref;
}
export async function getSecret(userId: string, ref: string): Promise<string | null> {
  validId(userId);
  validRef(ref);
  if (appMode() === "supabase") {
    const { data, error } = await supabaseService().rpc("get_integration_secret", {
      p_user_id: userId,
      p_reference: ref,
    });
    if (error) throw new Error("Managed secret lookup failed");
    return typeof data === "string" ? data : null;
  }
  let envelope: Envelope;
  try {
    envelope = JSON.parse(
      await readFile(path.join(dataDirectory(), "secrets", `${ref}.json`), "utf8"),
    ) as Envelope;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (envelope.userId !== userId) return null;
  const decipher = createDecipheriv("aes-256-gcm", await key(), Buffer.from(envelope.iv, "base64"));
  decipher.setAAD(Buffer.from(`${userId}:${ref}`));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
export async function deleteSecret(userId: string, ref: string): Promise<void> {
  validId(userId);
  validRef(ref);
  if (appMode() === "supabase") {
    const { error } = await supabaseService().rpc("delete_integration_secret", {
      p_user_id: userId,
      p_reference: ref,
    });
    if (error) throw new Error("Managed secret deletion failed");
    return;
  }
  if ((await getSecret(userId, ref)) !== null)
    await unlink(path.join(dataDirectory(), "secrets", `${ref}.json`));
}
