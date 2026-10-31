import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { entity, type Application, type Integration } from "./contracts";
import { getStore } from "./store";
import { getSecret, setSecret, deleteSecret } from "./secrets";
import { getPlanState } from "./billing";

export const providerSchema = z.enum(["github", "gmail", "outlook"]);
type Provider = z.infer<typeof providerSchema>;
type OAuthToken = { accessToken: string; refreshToken?: string; expiresAt: number | null };
const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  scope: z.string().optional(),
});
const cookieName = "jb_oauth";
function config(provider: Provider, privateRepos = false) {
  const tenant = process.env.MICROSOFT_TENANT_ID || "common";
  if (!/^[a-zA-Z0-9.-]+$/.test(tenant)) throw new Error("Invalid Microsoft tenant configuration.");
  const value =
    provider === "github"
      ? {
          id: process.env.GITHUB_CLIENT_ID,
          secret: process.env.GITHUB_CLIENT_SECRET,
          authorize: "https://github.com/login/oauth/authorize",
          token: "https://github.com/login/oauth/access_token",
          scopes: privateRepos ? ["read:user", "repo"] : ["read:user"],
        }
      : provider === "gmail"
        ? {
            id: process.env.GOOGLE_CLIENT_ID,
            secret: process.env.GOOGLE_CLIENT_SECRET,
            authorize: "https://accounts.google.com/o/oauth2/v2/auth",
            token: "https://oauth2.googleapis.com/token",
            scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
          }
        : {
            id: process.env.MICROSOFT_CLIENT_ID,
            secret: process.env.MICROSOFT_CLIENT_SECRET,
            authorize: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
            token: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
            scopes: ["offline_access", "User.Read", "Mail.ReadBasic"],
          };
  if (!value.id || !value.secret) throw new Error(`${provider} OAuth is not configured.`);
  if (provider === "gmail" && process.env.EMAIL_OAUTH_APPROVED !== "true")
    throw new Error(
      "Gmail access is disabled pending provider verification or an approved test audience.",
    );
  return {
    ...value,
    id: value.id,
    secret: value.secret,
    redirect: `${process.env.APP_URL || "http://127.0.0.1:3000"}/api/integrations/callback/${provider}`,
  };
}
export async function beginConnection(
  userId: string,
  provider: Provider,
  privateRepos = false,
): Promise<string> {
  if (provider !== "github" && !(await getPlanState(userId)).discovery)
    throw new Error("Email monitoring requires the Autonomous plan.");
  const c = config(provider, privateRepos),
    state = randomBytes(32).toString("base64url"),
    verifier = randomBytes(48).toString("base64url");
  const ref = await setSecret(
    userId,
    `oauth-state:${state}`,
    JSON.stringify({ state, verifier, provider, expiresAt: Date.now() + 600000, scopes: c.scopes }),
  );
  (await cookies()).set(cookieName, JSON.stringify({ state, ref, provider, userId }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/integrations",
    maxAge: 600,
  });
  const url = new URL(c.authorize);
  const query = {
    client_id: c.id,
    redirect_uri: c.redirect,
    response_type: "code",
    state,
    scope: c.scopes.join(" "),
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  };
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  if (provider === "gmail") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  }
  if (provider === "outlook") url.searchParams.set("response_mode", "query");
  return url.href;
}
async function tokenExchange(url: string, body: Record<string, string>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(20000),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error("The provider could not complete authorization. Reconnect your account.");
  const parsed = tokenResponse.safeParse(await response.json());
  if (!parsed.success) throw new Error("The provider did not return a valid access token.");
  return parsed.data;
}
async function authorizedJson(url: string, accessToken: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": "JB-career-agent (+https://jasteriskb.com)",
    },
    signal: AbortSignal.timeout(15000),
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      `Connected provider request failed (${response.status}). Reconnect if authorization expired.`,
    );
  return response.json() as Promise<unknown>;
}
export async function completeConnection(
  userId: string,
  provider: Provider,
  code: string,
  state: string,
): Promise<void> {
  const jar = await cookies(),
    raw = jar.get(cookieName)?.value;
  jar.delete({ name: cookieName, path: "/api/integrations" });
  if (!raw) throw new Error("Authorization expired. Start the connection again.");
  const entry = z
    .object({
      state: z.string(),
      ref: z.string().uuid(),
      provider: providerSchema,
      userId: z.string(),
    })
    .parse(JSON.parse(raw));
  if (
    entry.userId !== userId ||
    entry.provider !== provider ||
    state.length !== entry.state.length ||
    !timingSafeEqual(Buffer.from(state), Buffer.from(entry.state))
  )
    throw new Error("Authorization state did not match.");
  const secret = await getSecret(userId, entry.ref);
  await deleteSecret(userId, entry.ref);
  if (!secret) throw new Error("Authorization state has already been consumed.");
  const saved = z
    .object({ verifier: z.string(), expiresAt: z.number(), scopes: z.array(z.string()) })
    .parse(JSON.parse(secret));
  if (saved.expiresAt < Date.now()) throw new Error("Authorization expired.");
  const c = config(provider),
    token = await tokenExchange(c.token, {
      client_id: c.id,
      client_secret: c.secret,
      code,
      code_verifier: saved.verifier,
      redirect_uri: c.redirect,
      grant_type: "authorization_code",
    });
  const accountResponse =
    provider === "github"
      ? await authorizedJson("https://api.github.com/user", token.access_token)
      : provider === "gmail"
        ? await authorizedJson(
            "https://gmail.googleapis.com/gmail/v1/users/me/profile",
            token.access_token,
          )
        : await authorizedJson(
            "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName",
            token.access_token,
          );
  const info = accountResponse as Record<string, unknown>,
    account = String(
      info.login ?? info.emailAddress ?? info.mail ?? info.userPrincipalName ?? "Connected account",
    );
  const db = getStore(),
    previous = (await db.list("integration_connections", userId)).find(
      (i) => i.provider === provider,
    );
  const envelope: OAuthToken = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : null,
  };
  const value =
    provider === "github" && !token.refresh_token ? token.access_token : JSON.stringify(envelope);
  const ref = await setSecret(userId, `integration:${provider}`, value);
  await db.save("integration_connections", {
    ...(previous ?? entity(userId)),
    provider,
    status: "connected",
    account,
    scopes: token.scope ? token.scope.split(/[ ,]+/) : saved.scopes,
    secretRef: ref,
  });
  if (previous?.secretRef && previous.secretRef !== ref)
    await deleteSecret(userId, previous.secretRef);
  await db.save("agent_actions", {
    ...entity(userId),
    action: "integration.connected",
    applicationId: null,
    details: { provider, scopes: saved.scopes },
  });
  if (
    provider !== "github" &&
    (await getPlanState(userId)).discovery &&
    !(await db.list("agent_runs", userId)).some(
      (r) => r.kind === "email" && ["queued", "running"].includes(r.status),
    )
  )
    await db.save("agent_runs", {
      ...entity(userId),
      applicationId: "",
      kind: "email",
      status: "queued",
      stage: "reading_job",
      attempts: 0,
      maxAttempts: 3,
      leaseUntil: null,
      nextAttemptAt: new Date().toISOString(),
      error: null,
      approved: false,
      submitted: false,
    });
}
export async function integrationToken(userId: string, connection: Integration): Promise<string> {
  if (!connection.secretRef || connection.status !== "connected")
    throw new Error("This account is not connected.");
  const secret = await getSecret(userId, connection.secretRef);
  if (!secret) throw new Error("The connection credential is unavailable. Reconnect the account.");
  if (connection.provider === "github" && !secret.startsWith("{")) return secret;
  const saved = z
    .object({
      accessToken: z.string(),
      refreshToken: z.string().optional(),
      expiresAt: z.number().nullable(),
    })
    .parse(JSON.parse(secret));
  if (!saved.expiresAt || saved.expiresAt > Date.now() + 60000) return saved.accessToken;
  if (!saved.refreshToken) throw new Error("Authorization has expired. Reconnect your account.");
  const c = config(providerSchema.parse(connection.provider)),
    token = await tokenExchange(c.token, {
      client_id: c.id,
      client_secret: c.secret,
      grant_type: "refresh_token",
      refresh_token: saved.refreshToken,
      ...(connection.provider === "outlook" ? { scope: c.scopes.join(" ") } : {}),
    });
  const updated: OAuthToken = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? saved.refreshToken,
    expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : null,
  };
  const ref = await setSecret(
    userId,
    `integration:${connection.provider}`,
    JSON.stringify(updated),
  );
  await getStore().save("integration_connections", { ...connection, secretRef: ref });
  if (ref !== connection.secretRef) await deleteSecret(userId, connection.secretRef);
  return updated.accessToken;
}
export async function disconnectIntegration(userId: string, id: string) {
  const db = getStore(),
    connection = await db.get("integration_connections", id, userId);
  if (!connection) throw new Error("Connection not found.");
  if (connection.secretRef) await deleteSecret(userId, connection.secretRef);
  await db.save("integration_connections", {
    ...connection,
    status: "disconnected",
    secretRef: null,
  });
  await db.save("agent_actions", {
    ...entity(userId),
    action: "integration.disconnected",
    applicationId: null,
    details: { provider: connection.provider },
  });
}

export function emailSuggestion(
  subject: string,
): "interview" | "rejected" | "offer" | "confirmation" | "information" | null {
  const text = subject.toLowerCase();
  if (/(?:not moving forward|not selected|unsuccessful|application update.*regret)/.test(text))
    return "rejected";
  if (/\b(interview|schedule a conversation|next round)\b/.test(text)) return "interview";
  if (/\b(offer letter|employment offer)\b/.test(text)) return "offer";
  if (
    /\b(application received|thanks for applying|thank you for applying|application confirmation)\b/.test(
      text,
    )
  )
    return "confirmation";
  if (/\b(additional information|action required|more information)\b/.test(text))
    return "information";
  return null;
}
const cleanSearch = (v: string) =>
  v
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
export function matchesApplication(subject: string, app: Application): boolean {
  if (!app.job) return false;
  const text = cleanSearch(subject).toLowerCase(),
    company = cleanSearch(app.job.company).toLowerCase(),
    title = cleanSearch(app.job.title).toLowerCase();
  return company.length > 2 && title.length > 3 && text.includes(company) && text.includes(title);
}
export async function syncApplicationMail(
  userId: string,
): Promise<{ checked: number; updates: number }> {
  if (!(await getPlanState(userId)).discovery)
    throw new Error("Email monitoring requires the Autonomous plan.");
  const db = getStore(),
    connections = (await db.list("integration_connections", userId)).filter(
      (i) => i.status === "connected" && ["gmail", "outlook"].includes(i.provider),
    );
  const apps = (await db.list("applications", userId))
    .filter((a) => a.job && ["submitted", "submission_unverified", "interview"].includes(a.status))
    .slice(0, 20);
  let checked = 0,
    updates = 0;
  const existing = new Set(
    (await db.list("agent_actions", userId))
      .filter((a) => a.action === "email.observed")
      .map((a) => String(a.details.messageId)),
  );
  for (const connection of connections) {
    const access = await integrationToken(userId, connection);
    for (const app of apps) {
      const company = cleanSearch(app.job!.company);
      if (!company) continue;
      let messages: { id: string; subject: string; from: string; date: string }[] = [];
      if (connection.provider === "gmail") {
        if (process.env.EMAIL_OAUTH_APPROVED !== "true") continue;
        const query = `after:${Math.floor(new Date(app.createdAt).getTime() / 1000) - 86400} subject:("${company}" "${cleanSearch(app.job!.title)}")`;
        const list = (await authorizedJson(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&q=${encodeURIComponent(query)}`,
          access,
        )) as { messages?: { id: string }[] };
        for (const message of list.messages ?? []) {
          if (existing.has(`gmail:${message.id}`)) continue;
          const meta = (await authorizedJson(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(message.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
            access,
          )) as { payload?: { headers?: { name: string; value: string }[] } };
          const headers = meta.payload?.headers ?? [],
            header = (name: string) =>
              headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
          messages.push({
            id: `gmail:${message.id}`,
            subject: header("Subject"),
            from: header("From"),
            date: header("Date"),
          });
        }
      } else {
        const params = new URLSearchParams({
          $search: `"subject:${company}"`,
          $select: "id,subject,from,receivedDateTime",
          $top: "10",
        });
        const response = (await authorizedJson(
          `https://graph.microsoft.com/v1.0/me/messages?${params}`,
          access,
        )) as {
          value?: {
            id: string;
            subject: string;
            from?: { emailAddress?: { address: string } };
            receivedDateTime: string;
          }[];
        };
        messages = (response.value ?? []).map((m) => ({
          id: `outlook:${m.id}`,
          subject: m.subject,
          from: m.from?.emailAddress?.address ?? "",
          date: m.receivedDateTime,
        }));
      }
      for (const message of messages) {
        checked++;
        if (
          existing.has(message.id) ||
          !matchesApplication(message.subject, app) ||
          new Date(message.date).getTime() < new Date(app.createdAt).getTime() - 86400000
        )
          continue;
        const suggestion = emailSuggestion(message.subject);
        if (!suggestion) continue;
        await db.save("agent_actions", {
          ...entity(userId),
          action: "email.observed",
          applicationId: app.id,
          details: { messageId: message.id, provider: connection.provider, suggestion },
        });
        existing.add(message.id);
        await db.save("application_events", {
          ...entity(userId),
          applicationId: app.id,
          runId: app.runId,
          stage: "needs_input",
          message: `Application-related email: ${message.subject.slice(0, 250)}`,
          details: {
            provider: connection.provider,
            sender: message.from.slice(0, 250),
            suggestedStatus: suggestion,
            requiresReview: true,
          },
        });
        await db.save("notifications", {
          ...entity(userId),
          title: `Possible ${suggestion} update from ${app.job!.company}`,
          body: `${message.subject.slice(0, 250)} — review your email before changing the application status.`,
          read: false,
          applicationId: app.id,
        });
        updates++;
      }
    }
  }
  return { checked, updates };
}
