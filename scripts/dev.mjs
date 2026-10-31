import { spawn } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
if (!args.some((arg) => arg === "--port" || arg === "-p" || arg.startsWith("--port="))) {
  const configured = new URL(process.env.APP_URL || "http://127.0.0.1:3000");
  args.push("--port", process.env.PORT || configured.port || "3000");
}
const child = spawn(
  process.execPath,
  [path.resolve("node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", ...args],
  { stdio: "inherit", env: process.env },
);
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", () => process.exit(1));
