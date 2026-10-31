import { beforeEach, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { setSecret, getSecret, deleteSecret } from "../src/lib/secrets";
beforeEach(() => {
  process.env.APP_MODE = "local";
  process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "career-secrets-"));
});
it("encrypts values and binds lookup and deletion to their owner", async () => {
  const ref = await setSecret("user-a", "github", "sensitive-test-token");
  expect(await getSecret("user-a", ref)).toBe("sensitive-test-token");
  expect(await getSecret("user-b", ref)).toBeNull();
  const stored = await readFile(path.join(process.env.DATA_DIR!, "secrets", `${ref}.json`), "utf8");
  expect(stored).not.toContain("sensitive-test-token");
  await deleteSecret("user-b", ref);
  expect(await getSecret("user-a", ref)).toBe("sensitive-test-token");
  await deleteSecret("user-a", ref);
  expect(await getSecret("user-a", ref)).toBeNull();
});
