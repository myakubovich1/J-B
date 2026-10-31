import { spawn } from "node:child_process";
import { mkdir, mkdtemp, cp, rm } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

const port = Number(process.env.E2E_PORT || 3100);
const origin = `http://127.0.0.1:${port}`;
try {
  await fetch(origin, { signal: AbortSignal.timeout(1000) });
  throw new Error(`Port ${port} is in use. Choose E2E_PORT instead of reusing a non-test server.`);
} catch (error) {
  if (error.message?.includes("is in use")) throw error;
}
const directory = path.resolve(".data", "e2e", crypto.randomUUID());
await mkdir(directory, { recursive: true });
// Separate build output avoids Next's development lock and leaves an open user preview running.
const checkout = await mkdtemp(path.join(os.tmpdir(), "jb-e2e-"));
for (const name of [
  "src",
  "scripts",
  "workers",
  "templates",
  "public",
  "e2e",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "next.config.ts",
  "postcss.config.mjs",
  "playwright.config.ts",
]) {
  await cp(path.resolve(name), path.join(checkout, name), { recursive: true });
}
// A copy-on-write dependency copy keeps Turbopack's hermetic resolver inside
// the test checkout. Symlinks outside that root cause resolution/HMR failures.
await cp(path.resolve("node_modules"), path.join(checkout, "node_modules"), {
  recursive: true,
  mode: constants.COPYFILE_FICLONE,
  verbatimSymlinks: true,
});
const env = {
  ...process.env,
  APP_MODE: "local",
  NODE_ENV: "development",
  APP_URL: origin,
  DATA_DIR: directory,
  ENABLE_TEST_EMPLOYER: "true",
  GLOBAL_EMERGENCY_STOP: "false",
  EMERGENCY_STOP: "false",
  OPENAI_API_KEY: "",
  BROWSERBASE_API_KEY: "",
  BROWSERBASE_PROJECT_ID: "",
  STRIPE_SECRET_KEY: "",
  BROWSER_ALLOWED_DOMAINS: "",
  WORKER_CONCURRENCY: "1",
};
const processes = [];
function run(command, args) {
  const child = spawn(command, args, {
    env,
    cwd: checkout,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  processes.push(child);
  return child;
}
function stop() {
  for (const child of processes) {
    if (!child.pid) continue;
    try {
      process.platform === "win32" ? child.kill("SIGTERM") : process.kill(-child.pid, "SIGTERM");
    } catch {
      /* Already stopped. */
    }
  }
}
let interrupted = false;
process.on("SIGINT", () => {
  interrupted = true;
  stop();
});
process.on("SIGTERM", () => {
  interrupted = true;
  stop();
});
let code = 1;
try {
  run("npm", ["run", "dev", "--", "--port", String(port)]);
  run("npm", ["run", "worker"]);
  const until = Date.now() + 60000;
  let ready = false;
  while (Date.now() < until && !interrupted) {
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("The isolated E2E server did not become ready.");
  const test = run(process.execPath, [
    path.join(checkout, "node_modules", "playwright", "cli.js"),
    "test",
    ...process.argv.slice(2),
  ]);
  code = await new Promise((resolve) => test.once("exit", (value) => resolve(value ?? 1)));
} finally {
  stop();
  for (const name of ["test-results", "playwright-report"]) {
    await cp(path.join(checkout, name), path.resolve(name), { recursive: true }).catch(() => {});
  }
  await cp(path.join(checkout, ".data", "qa"), path.join(directory, "qa"), {
    recursive: true,
  }).catch(() => {});
  await rm(checkout, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  console.info(`Test artifacts: ${directory}`);
}
process.exit(code);
