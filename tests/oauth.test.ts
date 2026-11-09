import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string | { name: string }) =>
      jar.delete(typeof name === "string" ? name : name.name),
  }),
}));
import {
  beginConnection,
  completeConnection,
  disconnectIntegration,
  missingScopes,
} from "../src/lib/integrations";
import { setSecret } from "../src/lib/secrets";
import { entity } from "../src/lib/contracts";
import { getSecret } from "../src/lib/secrets";
import { getStore } from "../src/lib/store";
beforeEach(() => {
  jar.clear();
  process.env.APP_MODE = "local";
  process.env.APP_URL = "http://127.0.0.1:3000";
  process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "career-oauth-"));
  process.env.GITHUB_CLIENT_ID = "fixture-client";
  process.env.GITHUB_CLIENT_SECRET = "fixture-secret";
});
afterEach(() => {
  vi.unstubAllGlobals();
});
describe("OAuth protocol boundaries (provider HTTP fixture)", () => {
  it("binds state and PKCE to a user, consumes state once, and stores only encrypted token references", async () => {
    const user = crypto.randomUUID(),
      url = new URL(await beginConnection(user, "github", true)),
      state = url.searchParams.get("state")!;
    expect(url.origin).toBe("https://github.com");
    expect(url.searchParams.get("scope")).toContain("repo");
    const cookie = JSON.parse(jar.get("jb_oauth")!),
      saved = JSON.parse((await getSecret(user, cookie.ref))!);
    expect(url.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(saved.verifier).digest("base64url"),
    );
    await expect(completeConnection("another-user", "github", "code", state)).rejects.toThrow(
      "state did not match",
    );
    // A rejected callback clears its browser state; start a new authorized flow.
    const next = new URL(await beginConnection(user, "github", true)),
      nextState = next.searchParams.get("state")!;
    const exchange = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      const endpoint = String(input);
      if (endpoint.endsWith("/login/oauth/access_token")) {
        const body = new URLSearchParams(String(options?.body));
        expect(body.get("code_verifier")).toBeTruthy();
        return Response.json({ access_token: "fixture-private-token", scope: "read:user repo" });
      }
      return Response.json({ login: "fixture-account" });
    });
    vi.stubGlobal("fetch", exchange);
    await completeConnection(user, "github", "fixture-code", nextState);
    const connection = (await getStore().list("integration_connections", user))[0];
    expect(connection.account).toBe("fixture-account");
    expect(connection.secretRef).not.toContain("fixture-private-token");
    expect(JSON.stringify(connection)).not.toContain("fixture-private-token");
    expect(await getSecret(user, connection.secretRef!)).toBe("fixture-private-token");
    await expect(completeConnection(user, "github", "fixture-code", nextState)).rejects.toThrow(
      "expired",
    );
    expect(exchange).toHaveBeenCalledTimes(2);
  });
  it("rejects a grant that omits a requested permission and revokes it", async () => {
    const user = crypto.randomUUID(),
      state = new URL(await beginConnection(user, "github", true)).searchParams.get("state")!;
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
        calls.push(`${options?.method || "GET"} ${String(input)}`);
        if (String(input).endsWith("/login/oauth/access_token"))
          return Response.json({ access_token: "under-scoped", scope: "read:user" });
        return new Response(null, { status: 204 });
      }),
    );
    await expect(completeConnection(user, "github", "code", state)).rejects.toThrow(
      "not granted (repo)",
    );
    expect(calls).toContain("DELETE https://api.github.com/applications/fixture-client/grant");
    expect(await getStore().list("integration_connections", user)).toEqual([]);
    expect(missingScopes(["offline_access", "User.Read", "Mail.ReadBasic"], undefined)).toEqual([]);
    expect(
      missingScopes(
        ["offline_access", "User.Read", "Mail.ReadBasic"],
        "https://graph.microsoft.com/Mail.ReadBasic https://graph.microsoft.com/User.Read",
      ),
    ).toEqual([]);
  });
  it("revokes the provider grant on disconnect and always deletes the local credential", async () => {
    process.env.GOOGLE_CLIENT_ID = "fixture-google";
    process.env.GOOGLE_CLIENT_SECRET = "fixture-google-secret";
    const user = crypto.randomUUID(),
      store = getStore();
    const connect = async (provider: "gmail" | "outlook" | "github", value: string) => {
      const secretRef = await setSecret(user, `integration:${provider}`, value);
      return store.save("integration_connections", {
        ...entity(user),
        provider,
        status: "connected",
        account: "fixture",
        scopes: [],
        secretRef,
      });
    };
    const requests: { url: string; body: string }[] = [];
    let status = 200;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
        requests.push({ url: String(input), body: String(options?.body) });
        return new Response(null, { status });
      }),
    );
    const gmail = await connect(
      "gmail",
      JSON.stringify({ accessToken: "a", refreshToken: "refresh-1", expiresAt: 1 }),
    );
    expect(await disconnectIntegration(user, gmail.id)).toBe("revoked");
    expect(requests[0].url).toBe("https://oauth2.googleapis.com/revoke");
    // Revoking the refresh token ends the whole grant, not just one access token.
    expect(new URLSearchParams(requests[0].body).get("token")).toBe("refresh-1");
    expect(await getSecret(user, gmail.secretRef!)).toBeNull();

    status = 503;
    const github = await connect("github", "gho_fixture");
    expect(await disconnectIntegration(user, github.id)).toBe("failed");
    expect(JSON.parse(requests[1].body)).toEqual({ access_token: "gho_fixture" });
    expect(await getSecret(user, github.secretRef!)).toBeNull();
    expect((await store.get("integration_connections", github.id, user))?.status).toBe(
      "disconnected",
    );

    const outlook = await connect("outlook", JSON.stringify({ accessToken: "o", expiresAt: 1 }));
    expect(await disconnectIntegration(user, outlook.id)).toBe("unsupported");
    expect(requests).toHaveLength(2);
    expect(await getSecret(user, outlook.secretRef!)).toBeNull();
    await expect(disconnectIntegration(crypto.randomUUID(), gmail.id)).rejects.toThrow("not found");
  });
  it("does not allow email monitoring consent on a free plan", async () => {
    await expect(beginConnection(crypto.randomUUID(), "gmail")).rejects.toThrow("Autonomous plan");
  });
});
