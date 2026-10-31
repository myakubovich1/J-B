import { runOnce } from "../src/lib/agent";

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
const concurrency = Math.min(4, Math.max(1, Number(process.env.WORKER_CONCURRENCY || 1)));
const pollMs = Math.min(10000, Math.max(250, Number(process.env.WORKER_POLL_MS || 1500)));
async function lane(): Promise<void> {
  while (!stopping) {
    try {
      if (!(await runOnce())) await new Promise((resolve) => setTimeout(resolve, pollMs));
    } catch (error) {
      // Avoid logging records, URLs, browser tokens, prompts, or candidate data.
      console.error(
        JSON.stringify({
          level: "error",
          event: "worker_iteration_failed",
          category: error instanceof Error ? error.name : "unknown",
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}
console.info(JSON.stringify({ level: "info", event: "worker_started", concurrency }));
void Promise.all(Array.from({ length: concurrency }, () => lane())).then(() => {
  console.info(JSON.stringify({ level: "info", event: "worker_stopped" }));
});
