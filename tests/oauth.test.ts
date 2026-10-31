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
import { beginConnection, completeConnection } from "../src/lib/integrations";
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
    const cookie = JSON.parse(jar.get("waypoint_oauth")!),
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
  it("does not allow email monitoring consent on a free plan", async () => {
    await expect(beginConnection(crypto.randomUUID(), "gmail")).rejects.toThrow("Autonomous plan");
  });
});
