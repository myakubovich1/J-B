import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { appMode, localDb, supabaseService } from "./store";
import type { User } from "./contracts";

const deriveKey = promisify(scrypt);
const SESSION_COOKIE = "career_session";
const SESSION_DAYS = 7;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = (await deriveKey(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${key.toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [scheme, salt, value] = encoded.split("$");
  if (scheme !== "scrypt" || !salt || !value) return false;
  const expected = Buffer.from(value, "hex");
  const actual = (await deriveKey(password, salt, 64)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function supabaseAuth() {
  const jar = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase authentication is not configured");
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return jar.getAll();
      },
      setAll(items) {
        try {
          for (const item of items)
            jar.set(item.name, item.value, {
              ...item.options,
              httpOnly: true,
              sameSite: "lax",
              secure: process.env.NODE_ENV === "production",
            });
        } catch {
          /* Server components cannot refresh cookies; API routes refresh on the next request. */
        }
      },
    },
  });
}
async function setLocalSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  localDb()
    .prepare("INSERT INTO local_sessions(token_hash,user_id,expires_at)VALUES(?,?,?)")
    .run(sha256(token), userId, expires.toISOString());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    expires,
  });
}
export async function currentUser(): Promise<User | null> {
  if (appMode() === "supabase") {
    const client = await supabaseAuth();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user?.email) return null;
    return {
      id: data.user.id,
      email: data.user.email,
      name: typeof data.user.user_metadata?.name === "string" ? data.user.user_metadata.name : "",
    };
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = localDb()
    .prepare(
      "SELECT u.id,u.email,u.name FROM local_users u JOIN local_sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?",
    )
    .get(sha256(token), new Date().toISOString()) as User | undefined;
  return row ? { id: row.id, email: row.email, name: row.name } : null;
}
export async function signUp(email: string, password: string, name: string): Promise<User | null> {
  const normalized = email.trim().toLowerCase();
  if (appMode() === "supabase") {
    const client = await supabaseAuth();
    const { data, error } = await client.auth.signUp({
      email: normalized,
      password,
      options: {
        data: { name },
        emailRedirectTo: `${process.env.APP_URL || "http://127.0.0.1:3000"}/api/auth/callback`,
      },
    });
    if (error) throw new Error(error.message);
    if (!data.session || !data.user?.email) return null;
    return { id: data.user.id, email: data.user.email, name };
  }
  const db = localDb();
  if (db.prepare("SELECT id FROM local_users WHERE email=?").get(normalized))
    throw new Error("Unable to create account. Try signing in or use another email.");
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  db.prepare(
    "INSERT INTO local_users(id,email,name,password_hash,created_at)VALUES(?,?,?,?,?)",
  ).run(id, normalized, name, passwordHash, new Date().toISOString());
  await setLocalSession(id);
  return { id, email: normalized, name };
}
export async function signIn(email: string, password: string): Promise<User> {
  if (appMode() === "supabase") {
    const client = await supabaseAuth();
    const { data, error } = await client.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error || !data.user.email) throw new Error("Invalid email or password");
    return {
      id: data.user.id,
      email: data.user.email,
      name: typeof data.user.user_metadata?.name === "string" ? data.user.user_metadata.name : "",
    };
  }
  const row = localDb()
    .prepare("SELECT id,email,name,password_hash FROM local_users WHERE email=?")
    .get(email.trim().toLowerCase()) as (User & { password_hash: string }) | undefined;
  const valid = await verifyPassword(
    password,
    row?.password_hash || "scrypt$00000000000000000000000000000000$" + "00".repeat(64),
  );
  if (!row || !valid) throw new Error("Invalid email or password");
  await setLocalSession(row.id);
  return { id: row.id, email: row.email, name: row.name };
}
export async function signOut(): Promise<void> {
  if (appMode() === "supabase") {
    const client = await supabaseAuth();
    await client.auth.signOut();
    return;
  }
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) localDb().prepare("DELETE FROM local_sessions WHERE token_hash=?").run(sha256(token));
  jar.delete(SESSION_COOKIE);
}
export async function enforceRateLimit(key: string, limit = 20, windowSeconds = 60): Promise<void> {
  const digest = sha256(key);
  const now = Date.now();
  if (appMode() === "supabase") {
    const { data, error } = await supabaseService().rpc("consume_rate_limit", {
      p_key: digest,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) throw error;
    if (data !== true) throw new Error("Too many requests. Please try again later.");
    return;
  }
  const db = localDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT hits,expires_at FROM rate_limits WHERE key=?").get(digest) as
      { hits: number; expires_at: number } | undefined;
    if (row && row.expires_at > now && row.hits >= limit)
      throw new Error("Too many requests. Please try again later.");
    if (!row || row.expires_at <= now)
      db.prepare(
        "INSERT INTO rate_limits VALUES(?,1,?) ON CONFLICT(key)DO UPDATE SET hits=1,expires_at=excluded.expires_at",
      ).run(digest, now + windowSeconds * 1000);
    else db.prepare("UPDATE rate_limits SET hits=hits+1 WHERE key=?").run(digest);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const expected = new URL(process.env.APP_URL || request.url).origin;
  if ((origin && origin !== expected) || request.headers.get("sec-fetch-site") === "cross-site")
    throw new Error("Request origin is not allowed");
}
