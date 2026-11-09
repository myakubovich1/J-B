import { readdir, readFile, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { cookies } from "next/headers";
import { collections, type Collection, type Records, type User } from "./contracts";
import { appMode, dataDirectory, getStore, localDb, supabaseService } from "./store";
import { supabaseAuth } from "./auth";
import { disconnectIntegration } from "./integrations";
import { customerRef } from "./alerts";
import { HttpError } from "./http";

const bucket = () => process.env.SUPABASE_STORAGE_BUCKET || "career-artifacts";
/** Subscription states in which Stripe may still charge the customer. */
const BILLABLE = ["active", "trialing", "past_due", "unpaid"];

export type AccountExport = {
  format: "jb-account-export";
  version: 1;
  exportedAt: string;
  account: User;
  /** Private files (resumes, evidence) can be downloaded by key while signed in. */
  artifacts: string[];
  records: Partial<Record<Collection, unknown[]>>;
};
/** Every tenant record, minus credential references. Contains only this user's data. */
export async function exportAccount(user: User): Promise<AccountExport> {
  const store = getStore();
  const records: AccountExport["records"] = {};
  for (const collection of collections) {
    const rows = await store.list(collection, user.id);
    records[collection] =
      collection === "integration_connections"
        ? rows.map((row) => ({ ...(row as Records["integration_connections"]), secretRef: null }))
        : rows;
  }
  return {
    format: "jb-account-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    account: { id: user.id, email: user.email, name: user.name },
    artifacts: await listArtifactKeys(user.id),
    records,
  };
}

async function listArtifactKeys(userId: string): Promise<string[]> {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(userId)) throw new Error("Invalid artifact owner");
  if (appMode() === "supabase") {
    const keys: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabaseService()
        .storage.from(bucket())
        .list(userId, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw error;
      keys.push(...(data || []).filter((item) => item.id).map((item) => `${userId}/${item.name}`));
      if (!data || data.length < 1000) return keys;
    }
  }
  try {
    return (await readdir(path.join(dataDirectory(), "artifacts", userId))).map(
      (name) => `${userId}/${name}`,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** End every session for this account, on every device, including the current one. */
export async function signOutEverywhere(user: User): Promise<void> {
  if (appMode() === "supabase") {
    const { error } = await (await supabaseAuth()).auth.signOut({ scope: "global" });
    if (error) throw new Error("Unable to end other sessions. Try again.");
    return;
  }
  localDb().prepare("DELETE FROM local_sessions WHERE user_id=?").run(user.id);
  (await cookies()).delete("career_session");
}

export type DeletionReport = {
  integrations: { provider: string; revocation: string }[];
  artifacts: number;
};
/**
 * Permanently delete the account and its data. Safe to repeat after a partial failure.
 * Stripe keeps its own invoice and customer records under the operator's billing obligations.
 */
export async function deleteAccount(user: User, confirmEmail: string): Promise<DeletionReport> {
  if (confirmEmail.trim().toLowerCase() !== user.email.toLowerCase())
    throw new HttpError("Type your account email exactly to confirm deletion.");
  const store = getStore();
  const subscription = (await store.list("subscriptions", user.id))[0];
  if (subscription?.subscriptionId && BILLABLE.includes(subscription.status))
    throw new HttpError(
      "Cancel your subscription in Billing before deleting your account, so you are not charged again.",
      409,
    );
  const runs = await store.list("agent_runs", user.id);
  const now = Date.now();
  if (
    runs.some(
      (run) => run.status === "running" && run.leaseUntil && Date.parse(run.leaseUntil) > now,
    )
  )
    throw new HttpError(
      "An application step is running. Stop it or wait for it to finish, then delete your account.",
      409,
    );
  // Stop queued work first so a worker cannot claim it while data is being removed.
  for (const run of runs)
    if (["queued", "waiting"].includes(run.status))
      await store.save("agent_runs", {
        ...run,
        status: "failed",
        stage: "failed",
        leaseUntil: null,
        error: "Account deletion requested.",
        finishedAt: new Date().toISOString(),
      });
  const integrations: DeletionReport["integrations"] = [];
  for (const connection of await store.list("integration_connections", user.id))
    if (connection.status === "connected")
      integrations.push({
        provider: connection.provider,
        revocation: await disconnectIntegration(user.id, connection.id),
      });
  const keys = await listArtifactKeys(user.id);
  if (appMode() === "supabase") {
    for (let index = 0; index < keys.length; index += 100) {
      const { error } = await supabaseService()
        .storage.from(bucket())
        .remove(keys.slice(index, index + 100));
      if (error) throw error;
    }
    // Cascades through public.users to every tenant table and the Vault secret mapping,
    // whose delete trigger purges the encrypted Vault values.
    const { error } = await supabaseService().auth.admin.deleteUser(user.id);
    if (error && !/not found/i.test(error.message)) throw error;
  } else {
    await rm(path.join(dataDirectory(), "artifacts", user.id), { recursive: true, force: true });
    await deleteLocalSecrets(user.id);
    const db = localDb();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM records WHERE user_id=?").run(user.id);
      db.prepare("DELETE FROM local_sessions WHERE user_id=?").run(user.id);
      db.prepare("DELETE FROM local_users WHERE id=?").run(user.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    (await cookies()).delete("career_session");
  }
  console.info(
    JSON.stringify({
      level: "info",
      event: "account_deleted",
      customer: customerRef(user.id),
      artifacts: keys.length,
      integrations: integrations.length,
    }),
  );
  return { integrations, artifacts: keys.length };
}

/** Local envelopes record their owner in plaintext beside the ciphertext. */
async function deleteLocalSecrets(userId: string): Promise<void> {
  const root = path.join(dataDirectory(), "secrets");
  let names: string[];
  try {
    names = await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const name of names.filter((entry) => /^[a-f0-9-]{36}\.json$/.test(entry))) {
    const file = path.join(root, name);
    try {
      if ((JSON.parse(await readFile(file, "utf8")) as { userId?: string }).userId === userId)
        await unlink(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
