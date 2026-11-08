import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { crc32, deflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyProfile, type CandidateProfile } from "../src/lib/contracts";
import {
  buildResumeContent,
  builtInTemplates,
  compileLatex,
  renderLatex,
  sandboxRunArgs,
  SANDBOX_MAX_FILE_BYTES,
} from "../src/lib/resume";
import { defaultResumeSettings } from "../src/lib/resume-settings";

// Executes the real Docker compiler. Build the image first:
//   docker build -f workers/latex/Dockerfile -t career-latex:local .
// then run RUN_DOCKER_TESTS=1 npx vitest run tests/latex-sandbox.test.ts
const run = promisify(execFile);
const image = () => process.env.LATEX_DOCKER_IMAGE || "career-latex:local";
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
/** A decodable 2×2 RGB PNG; the image decoder inside the sandbox verifies every CRC. */
const png = (() => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(2, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.from([0, 255, 0, 0, 0, 0, 255, 0, 0, 255, 0, 255, 255, 255]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
})();
const document = (body: string, preamble = "") =>
  `\\documentclass{article}\n${preamble}\n\\begin{document}\n${body}\n\\end{document}\n`;

function profile(): CandidateProfile {
  const value = emptyProfile("zoe@example.test", "Zoë García");
  value.location = "New York, NY";
  value.education = [
    {
      id: "edu",
      school: "State University",
      degree: "B.S.",
      field: "Computer Science",
      start: "2022",
      end: "2026",
      gpa: "",
      coursework: [],
    } as never,
  ];
  value.skills = ["TypeScript", "React", "PostgreSQL"];
  return value;
}
async function sandboxProbe(script: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "career-probe-"));
  try {
    const args = sandboxRunArgs({
      name: `career-probe-${crypto.randomUUID()}`,
      directory,
      uid: process.getuid?.() ?? 65532,
      gid: process.getgid?.() ?? 65532,
    });
    const result = await run(
      "docker",
      [...args, "--entrypoint", "/bin/sh", image(), "-c", script],
      { timeout: 30000, env: { PATH: process.env.PATH, HOME: os.homedir(), NODE_ENV: "test" } },
    ).catch((error: { stdout?: string }) => ({ stdout: error.stdout || "" }));
    return result.stdout.trim();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
async function leftoverContainers(): Promise<string> {
  const { stdout } = await run("docker", [
    "ps",
    "-a",
    "--filter",
    "name=career-latex-",
    "--format",
    "{{.Names}}",
  ]);
  return stdout.trim();
}
async function compileDirectories(): Promise<string[]> {
  return (await readdir(os.tmpdir())).filter((name) => name.startsWith("career-latex-"));
}

describe.skipIf(process.env.RUN_DOCKER_TESTS !== "1")("isolated LaTeX compiler", () => {
  const secret = "sentinel-service-role-secret";
  let before: string[];
  beforeAll(async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = secret;
    process.env.STRIPE_SECRET_KEY = secret;
    process.env.LATEX_TIMEOUT_MS = "10000";
    before = await compileDirectories();
  });
  afterAll(() => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.LATEX_TIMEOUT_MS;
  });

  it("runs unprivileged, offline, read-only, and without application secrets", async () => {
    const report = await sandboxProbe(
      [
        "echo uid=$(id -u)",
        "grep -E '^(CapEff|NoNewPrivs)' /proc/self/status",
        "echo routes=$(tail -n +2 /proc/net/route | wc -l)",
        "getent hosts example.com >/dev/null 2>&1 && echo dns=resolved || echo dns=failed",
        "touch /etc/probe 2>/dev/null && echo rootfs=writable || echo rootfs=readonly",
        "cp /bin/true /tmp/t && (/tmp/t 2>/dev/null && echo tmp=exec || echo tmp=noexec)",
        "test -e /var/run/docker.sock && echo socket=present || echo socket=absent",
        "test -e /Users -o -e /home/node -o -e /root/.ssh && echo host=visible || echo host=hidden",
        "echo fsize=$(ulimit -f)",
        "env",
      ].join("; "),
    );
    expect(report).toMatch(/^uid=(\d+)$/m);
    expect(report).not.toMatch(/^uid=0$/m);
    expect(report).toMatch(/^CapEff:\s+0+$/m);
    expect(report).toMatch(/^NoNewPrivs:\s+1$/m);
    expect(report).toContain("routes=0");
    expect(report).toContain("dns=failed");
    expect(report).toContain("rootfs=readonly");
    expect(report).toContain("tmp=noexec");
    expect(report).toContain("socket=absent");
    expect(report).toContain("host=hidden");
    // POSIX sh reports the file-size limit in 512-byte blocks.
    expect(report).toContain(`fsize=${SANDBOX_MAX_FILE_BYTES / 512}`);
    expect(report).not.toContain(secret);
    expect(report).not.toMatch(/SUPABASE|STRIPE|OPENAI|BROWSERBASE|GITHUB_CLIENT/);
  });

  it("enforces process and memory limits", async () => {
    // The forking child dies once the PID limit refuses a fork, before reporting success.
    const report = await sandboxProbe(
      "cat /sys/fs/cgroup/pids.max; sh -c 'for i in $(seq 1 120); do sleep 2 & done; echo all-spawned' 2>/dev/null",
    );
    expect(report).toMatch(/^64$/m);
    expect(report).not.toContain("all-spawned");
    const memory = await sandboxProbe(
      "cat /sys/fs/cgroup/memory.max 2>/dev/null || cat /sys/fs/cgroup/memory/memory.limit_in_bytes",
    );
    expect(Number(memory)).toBe(384 * 1024 * 1024);
  });

  it.each(builtInTemplates)(
    "compiles $name offline from the image cache",
    async (template) => {
      process.env.LATEX_MODE = "docker";
      try {
        const content = buildResumeContent(profile(), template.track).content;
        const result = await compileLatex(renderLatex(content, template.id));
        expect(result.pdf.subarray(0, 5).toString()).toBe("%PDF-");
        expect(result.pages).toBe(1);
        expect(result.text).toContain("Zoë García");
        expect(result.text).toContain("zoe@example.test");
        expect(result.warnings).toEqual([]);
        expect(result.layoutIssues).toEqual([]);
      } finally {
        delete process.env.LATEX_MODE;
      }
    },
    60000,
  );

  // Each font size loads different math/text font files, and the sandbox cannot fetch any
  // file the image build did not cache. Smallest and largest sizes cover the size commands.
  it.each(builtInTemplates)(
    "compiles $name with every font family at 10pt and 12pt offline",
    async (template) => {
      process.env.LATEX_MODE = "docker";
      try {
        const content = buildResumeContent(profile(), template.track).content;
        for (const font of ["template", "serif", "sans"] as const)
          for (const fontSize of [10, 12] as const) {
            const settings = { ...defaultResumeSettings, font, fontSize, paper: "a4" as const };
            const result = await compileLatex(
              renderLatex(content, template.id, undefined, settings),
            );
            expect(result.pages).toBe(1);
            expect(result.warnings).toEqual([]);
          }
      } finally {
        delete process.env.LATEX_MODE;
      }
    },
    120000,
  );

  it("compiles the documented custom template with a supporting image", async () => {
    const source = (await import("node:fs")).readFileSync("templates/custom-example.tex", "utf8");
    const content = buildResumeContent(profile(), "software").content;
    const tex = renderLatex(content, "custom", source).replace(
      "\\begin{document}",
      "\\usepackage{graphicx}\n\\begin{document}\n\\includegraphics[width=1cm]{assets/logo.png}",
    );
    const result = await compileLatex(tex, {
      custom: true,
      assets: [{ name: "logo.png", bytes: png }],
    });
    expect(result.pages).toBe(1);
    expect(result.text).toContain("Zoë García");
  }, 60000);

  it("does not execute shell escapes or piped input", async () => {
    await expect(
      compileLatex(document('\\input|"echo SHELL-RAN"'), { custom: true }),
    ).rejects.toThrow(/Isolated LaTeX compilation failed/);
    const result = await compileLatex(
      document("Safe \\immediate\\write18{echo SHELL-RAN > /work/ran.txt}text"),
      { custom: true },
    ).catch((error: Error) => error);
    if (!(result instanceof Error)) expect(result.text).not.toContain("SHELL-RAN");
  }, 60000);

  it("keeps file writes and traversal inside the per-job directory", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "career-outside-"));
    const marker = path.join(outside, "escaped.txt");
    try {
      const source = document(
        [
          "\\newwrite\\f",
          `\\immediate\\openout\\f=${marker}\\immediate\\write\\f{x}\\immediate\\closeout\\f`,
          "\\immediate\\openout\\f=../../escaped.txt\\immediate\\write\\f{x}\\immediate\\closeout\\f",
          "\\input{/etc/hostname} Text",
        ].join("\n"),
      );
      await compileLatex(source, { custom: true }).catch(() => null);
      await expect(readdir(outside)).resolves.toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  }, 60000);

  it("rejects output floods with the per-file size limit", async () => {
    const line = "0123456789".repeat(100);
    const flood = document(
      "x",
      `\\newcount\\n\\loop\\message{${line}}\\advance\\n by 1 \\ifnum\\n<30000 \\repeat`,
    );
    await expect(compileLatex(flood, { custom: true })).rejects.toThrow();
  }, 60000);

  it("kills runaway compiles at the deadline and removes the container", async () => {
    const started = Date.now();
    await expect(
      compileLatex(document("\\def\\spin{\\spin}\\spin"), { custom: true }),
    ).rejects.toThrow(/time limit/);
    expect(Date.now() - started).toBeLessThan(25000);
    expect(await leftoverContainers()).toBe("");
  }, 60000);

  it("fails closed on memory exhaustion", async () => {
    await expect(
      compileLatex(
        document("x", "\\def\\a{aaaaaaaaaaaaaaaaaaaaaaaa}\\loop\\edef\\a{\\a\\a}\\iftrue\\repeat"),
        { custom: true },
      ),
    ).rejects.toThrow();
    expect(await leftoverContainers()).toBe("");
  }, 60000);

  it("rejects malformed images inside the sandbox and oversized inputs before it", async () => {
    const corrupt = Buffer.concat([png.subarray(0, 33), Buffer.alloc(200, 7)]);
    await expect(
      compileLatex(document("\\includegraphics{assets/bad.png}", "\\usepackage{graphicx}"), {
        custom: true,
        assets: [{ name: "bad.png", bytes: corrupt }],
      }),
    ).rejects.toThrow();
    const huge = Buffer.concat([png, Buffer.alloc(1_100_000)]);
    await expect(
      compileLatex(document("x"), { custom: true, assets: [{ name: "big.png", bytes: huge }] }),
    ).rejects.toThrow(/at most 1 MB/);
    await expect(
      compileLatex(document("x"), {
        custom: true,
        assets: [{ name: "../escape.png", bytes: png }],
      }),
    ).rejects.toThrow(/flat PNG\/JPEG/);
  }, 60000);

  it("cleans up every per-job directory", async () => {
    expect((await compileDirectories()).filter((name) => !before.includes(name))).toEqual([]);
    const probe = path.join(os.tmpdir(), "career-latex-probe-check");
    await writeFile(probe, "").then(() => rm(probe));
  });
});
