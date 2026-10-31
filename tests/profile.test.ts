import { describe, it, expect, vi } from "vitest";
import { emptyProfile } from "../src/lib/contracts";
import { normalizeProfile } from "../src/lib/profile";
describe("canonical profile", () => {
  it("reserves external verification for system evidence rather than user payloads", () => {
    const p = emptyProfile("alex@example.com");
    p.claims = [
      {
        id: "claim",
        type: "achievement",
        text: "A user assertion",
        source: "Manual edit",
        verification: "verified",
        confirmed: true,
        updatedAt: new Date().toISOString(),
        track: "general",
      },
    ];
    expect(normalizeProfile(p).claims[0].verification).toBe("user_confirmed");
  });
  it("normalizes user input and retains imported confirmation boundaries", () => {
    const p = emptyProfile("Alex@Example.com", " Alex Morgan ");
    p.skills = [" TypeScript ", "TypeScript", ""];
    p.projects = [
      {
        id: "project1",
        name: "API",
        description: "Repository description",
        technologies: ["TypeScript"],
        url: "https://github.com/example/api",
        contribution: "",
        confirmed: false,
      },
    ];
    const normalized = normalizeProfile(p);
    expect(normalized.legalName).toBe("Alex Morgan");
    expect(normalized.email).toBe("alex@example.com");
    expect(normalized.skills).toEqual(["TypeScript"]);
    expect(normalized.claims.find((c) => c.type === "project")?.confirmed).toBe(false);
    expect(normalized.claims.find((c) => c.type === "skill")?.verification).toBe("user_confirmed");
  });
  it("does not duplicate claims across profile versions and drops removed records", () => {
    const p = emptyProfile("alex@example.com");
    p.skills = ["SQL"];
    const once = normalizeProfile(p),
      twice = normalizeProfile(once);
    expect(once.claims.map((c) => c.id)).toEqual(twice.claims.map((c) => c.id));
    twice.skills = [];
    expect(normalizeProfile(twice).claims).toEqual([]);
  });
  it("rejects wildcard standing authorization", () => {
    const p = emptyProfile("alex@example.com");
    p.autonomy.allowedDomains = ["*.example.com"];
    expect(() => normalizeProfile(p)).toThrow("exact public hostnames");
  });
  it("permits only the configured loopback fixture in local development and rejects it in production", () => {
    vi.stubEnv("APP_MODE", "local");
    vi.stubEnv("APP_URL", "http://127.0.0.1:3300");
    vi.stubEnv("ENABLE_TEST_EMPLOYER", "true");
    vi.stubEnv("NODE_ENV", "development");
    const p = emptyProfile("alex@example.test");
    try {
      p.autonomy.allowedDomains = ["127.0.0.1"];
      expect(normalizeProfile(p).autonomy.allowedDomains).toEqual(["127.0.0.1"]);
      p.autonomy.allowedDomains = ["127.0.0.2"];
      expect(() => normalizeProfile(p)).toThrow("exact public hostnames");
      p.autonomy.allowedDomains = ["127.0.0.1"];
      vi.stubEnv("NODE_ENV", "production");
      expect(() => normalizeProfile(p)).toThrow("exact public hostnames");
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("ENABLE_TEST_EMPLOYER", "false");
      expect(() => normalizeProfile(p)).toThrow("exact public hostnames");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
