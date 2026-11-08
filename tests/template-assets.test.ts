import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { entity, type User } from "../src/lib/contracts";
import { getStore } from "../src/lib/store";
import * as storage from "../src/lib/storage";
import {
  getTemplateAssets,
  readTemplateAssets,
  saveTemplateAssets,
  validateTemplateAsset,
  validateTemplateAssets,
} from "../src/lib/template-assets";
import { compileLatex } from "../src/lib/resume";

const current = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("../src/lib/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/http")>();
  return {
    ...actual,
    requireUser: async () => {
      if (!current.user) throw new actual.HttpError("Please sign in to continue.", 401);
      return current.user;
    },
  };
});
import { GET, POST } from "../src/app/api/template-assets/route";
import { GET as getSettings, POST as postSettings } from "../src/app/api/resume-settings/route";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV2kAAAAASUVORK5CYII=",
  "base64",
);
const owner: User = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "owner@example.test",
  name: "Owner",
};
let directory: string;
beforeEach(() => {
  process.env.APP_MODE = "local";
  process.env.APP_URL = "http://127.0.0.1:3300";
  directory = mkdtempSync(path.join(os.tmpdir(), "career-template-assets-"));
  process.env.DATA_DIR = directory;
  current.user = owner;
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});
async function template() {
  const record = {
    ...entity(owner.id),
    name: "Asset fixture",
    track: "general" as const,
    source: "unused source",
    custom: true,
    license: "Test fixture",
  };
  await getStore().save("resume_templates", record);
  return record;
}
function uploadRequest(id: string, origin?: string) {
  const form = new FormData();
  form.append("templateId", id);
  form.append("files", new File([new Uint8Array(png)], "logo.png", { type: "image/png" }));
  return new Request(`${process.env.APP_URL}/api/template-assets`, {
    method: "POST",
    body: form,
    ...(origin ? { headers: { origin } } : {}),
  });
}
describe("supporting image boundaries", () => {
  it("accepts bounded image headers and rejects paths, scripts, oversized dimensions, and bundles", () => {
    expect(validateTemplateAsset("logo.png", png)).toBe("image/png");
    for (const name of [
      "../logo.png",
      "assets/logo.png",
      "logo.svg",
      "logo.png.tex",
      "logo with spaces.png",
    ])
      expect(() => validateTemplateAsset(name, png)).toThrow();
    expect(() => validateTemplateAsset("logo.png", Buffer.from("not png"))).toThrow("PNG header");
    const huge = Buffer.from(png);
    huge.writeUInt32BE(5000, 16);
    expect(() => validateTemplateAsset("huge.png", huge)).toThrow("4096");
    expect(() =>
      validateTemplateAssets([
        { name: "logo.png", bytes: png },
        { name: "LOGO.PNG", bytes: png },
      ]),
    ).toThrow("distinct");
    expect(() =>
      validateTemplateAssets(
        Array.from({ length: 7 }, (_, index) => ({ name: `logo${index}.png`, bytes: png })),
      ),
    ).toThrow("six");
    expect(() => validateTemplateAsset("large.png", Buffer.alloc(1_000_001))).toThrow("1 MB");
  });
  it("never lets supporting images execute through trusted host compiler mode", async () => {
    await expect(
      compileLatex("unused", { assets: [{ name: "logo.png", bytes: png }] }),
    ).rejects.toThrow("isolated custom-template");
    await expect(
      compileLatex("unused", { custom: true, assets: [{ name: "../escape.png", bytes: png }] }),
    ).rejects.toThrow("flat");
  });
  it("claims a single immutable bundle and deletes the losing concurrent upload", async () => {
    const custom = await template();
    let writes = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = storage.writeArtifact;
    vi.spyOn(storage, "writeArtifact").mockImplementation(async (...args) => {
      const key = await original(...args);
      if (++writes === 2) release();
      await barrier;
      return key;
    });
    const cleanup = vi.spyOn(storage, "deleteArtifact");
    const results = await Promise.allSettled([
      saveTemplateAssets(owner.id, custom.id, [{ name: "first.png", bytes: png }]),
      saveTemplateAssets(owner.id, custom.id, [{ name: "second.png", bytes: png }]),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(readdirSync(path.join(directory, "artifacts", owner.id))).toHaveLength(1);
    expect(await readTemplateAssets(owner.id, custom.id)).toHaveLength(1);
    await expect(
      saveTemplateAssets(owner.id, custom.id, [{ name: "replacement.png", bytes: png }]),
    ).rejects.toMatchObject({ status: 409 });
    await expect(getTemplateAssets("another-owner", custom.id)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("cleans partial failed uploads and rejects modified stored bytes", async () => {
    const custom = await template();
    const original = storage.writeArtifact;
    let writes = 0;
    vi.spyOn(storage, "writeArtifact").mockImplementation(async (...args) => {
      if (++writes === 2) throw new Error("fixture storage failure");
      return original(...args);
    });
    await expect(
      saveTemplateAssets(owner.id, custom.id, [
        { name: "one.png", bytes: png },
        { name: "two.png", bytes: png },
      ]),
    ).rejects.toThrow("fixture storage failure");
    expect(readdirSync(path.join(directory, "artifacts", owner.id))).toHaveLength(0);
    vi.restoreAllMocks();
    const [asset] = await saveTemplateAssets(owner.id, custom.id, [
      { name: "logo.png", bytes: png },
    ]);
    const changed = Buffer.from(png);
    changed[0] = 0;
    writeFileSync(path.join(directory, "artifacts", asset.storageKey), changed);
    await expect(readTemplateAssets(owner.id, custom.id)).rejects.toThrow("integrity");
  });
});

describe("resume management route ownership", () => {
  it("authenticates asset reads/writes, blocks cross-origin writes, and withholds another tenant's files", async () => {
    const custom = await template();
    const url = `${process.env.APP_URL}/api/template-assets?templateId=${custom.id}`;
    current.user = null;
    expect((await GET(new Request(url))).status).toBe(401);
    expect((await POST(uploadRequest(custom.id))).status).toBe(401);
    current.user = owner;
    expect((await POST(uploadRequest(custom.id, "https://evil.example"))).status).toBe(403);
    expect((await POST(uploadRequest(custom.id))).status).toBe(201);
    const metadata = await GET(new Request(url));
    const body = await metadata.json();
    expect(body.assets).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("storageKey");
    const download = await GET(new Request(`${url}&name=logo.png`));
    expect(download.headers.get("content-type")).toBe("image/png");
    expect(download.headers.get("cache-control")).toContain("no-store");
    expect(Buffer.from(await download.arrayBuffer()).equals(png)).toBe(true);
    current.user = { ...owner, id: "22222222-2222-4222-8222-222222222222" };
    expect((await GET(new Request(`${url}&name=logo.png`))).status).toBe(404);
    expect((await POST(uploadRequest(custom.id))).status).toBe(404);
  });
  it("derives layout ownership from the session and rejects an explicit owner override", async () => {
    const url = `${process.env.APP_URL}/api/resume-settings`;
    const change = (extra = {}) =>
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "save",
          templateId: "jakes",
          settings: { fontSize: 12 },
          ...extra,
        }),
      });
    expect((await postSettings(change({ userId: "another-owner" }))).status).toBe(400);
    expect((await postSettings(change())).status).toBe(200);
    current.user = { ...owner, id: "22222222-2222-4222-8222-222222222222" };
    expect(
      (await (await getSettings(new Request(`${url}?templateId=jakes`))).json()).settings.fontSize,
    ).toBe(11);
    current.user = null;
    expect((await getSettings(new Request(`${url}?templateId=jakes`))).status).toBe(401);
  });
});
