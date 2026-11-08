import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyProfile, entity } from "../src/lib/contracts";
import { getStore } from "../src/lib/store";
import { readArtifact } from "../src/lib/storage";
import {
  buildResumeContent,
  generateResume,
  getResumeSettings,
  listTemplates,
  renderLatex,
  resetResumeSettings,
  saveResumeSettings,
} from "../src/lib/resume";
import { defaultResumeSettings, resumeSettingsSchema } from "../src/lib/resume-settings";

let directory: string;
beforeEach(() => {
  process.env.APP_MODE = "local";
  directory = mkdtempSync(path.join(os.tmpdir(), "career-resume-settings-"));
  process.env.DATA_DIR = directory;
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});
function profile() {
  const value = emptyProfile("layout@example.test", "Layout Fixture");
  value.education = [
    {
      id: "education",
      school: "Example University",
      degree: "B.S.",
      major: "Computer Science",
      startDate: "2023",
      endDate: "2027",
    },
  ];
  value.skills = ["TypeScript", "Python"];
  return value;
}
describe("bounded resume layout settings", () => {
  it("rejects arbitrary TeX, small fonts, extreme margins, and extra layout keys", () => {
    expect(resumeSettingsSchema.parse({})).toEqual(defaultResumeSettings);
    for (const settings of [
      { font: "\\input{/etc/passwd}" },
      { fontSize: 8 },
      { marginInches: 0.1 },
      { spacing: "\\write18{}" },
      { paper: "custom" },
      { shell: true },
    ])
      expect(resumeSettingsSchema.safeParse(settings).success).toBe(false);
  });
  it("persists settings by owner and template without creating duplicate template cards", async () => {
    const selected = {
      ...defaultResumeSettings,
      fontSize: 12 as const,
      marginInches: 0.75 as const,
      paper: "a4" as const,
    };
    await saveResumeSettings("owner-a", "jakes", selected);
    expect(await getResumeSettings("owner-a", "jakes")).toEqual(selected);
    expect(await getResumeSettings("owner-b", "jakes")).toEqual(defaultResumeSettings);
    expect(await getResumeSettings("owner-a", "technical")).toEqual(defaultResumeSettings);
    await saveResumeSettings("owner-a", "jakes", { ...selected, font: "sans" });
    expect(await getStore().list("resume_templates", "owner-a")).toHaveLength(1);
    expect(await listTemplates("owner-a")).toHaveLength(6);
    expect(
      (await listTemplates("owner-a")).find((template) => template.id === "jakes")?.settings?.font,
    ).toBe("sans");
    await resetResumeSettings("owner-a", "jakes");
    expect(await getResumeSettings("owner-a", "jakes")).toEqual(defaultResumeSettings);
    expect(await getStore().list("resume_templates", "owner-a")).toHaveLength(0);
  });
  it("keeps custom templates distinct and changes only bounded built-in layout instructions", async () => {
    const custom = {
      ...entity("owner-a"),
      name: "Custom",
      track: "general" as const,
      source:
        "\\documentclass{article}\n\\begin{document}{{NAME}} {{CONTACT}} {{RESUME_BODY}}\\end{document}",
      custom: true,
      license: "User supplied",
    };
    await getStore().save("resume_templates", custom);
    expect(await listTemplates("owner-a")).toHaveLength(7);
    expect(await listTemplates("owner-b")).toHaveLength(6);
    await expect(saveResumeSettings("owner-a", custom.id, {})).rejects.toThrow("built-in");
    const content = buildResumeContent(profile(), "general").content;
    const settings = {
      ...defaultResumeSettings,
      font: "sans" as const,
      fontSize: 12 as const,
      marginInches: 0.75 as const,
      spacing: "comfortable" as const,
      paper: "a4" as const,
    };
    const tex = renderLatex(content, "jakes", undefined, settings);
    expect(tex).toContain("\\documentclass[a4paper,12pt]");
    expect(tex).toContain("\\usepackage[margin=0.75in]");
    expect(tex).toContain("itemsep=3pt");
    expect(tex).toContain("\\renewcommand{\\familydefault}{\\sfdefault}");
    expect(tex).toContain("Layout Fixture");
    expect(tex).not.toContain("fontSize");
    expect(renderLatex(content, custom.id, custom.source, settings)).not.toContain("a4paper");
  });
  it("records an actual failed generation without changing the source error", async () => {
    await expect(
      generateResume({
        userId: "owner-a",
        profile: emptyProfile("empty@example.test"),
        templateId: "jakes",
        track: "general",
      }),
    ).rejects.toThrow("legal name");
    const actions = await getStore().list("agent_actions", "owner-a");
    expect(
      actions.some(
        (action) =>
          action.action === "resume_generation_measured" && action.details.outcome === "failed",
      ),
    ).toBe(true);
    expect(await getStore().list("generated_resumes", "owner-a")).toEqual([]);
  });
});

describe.skipIf(process.env.RUN_LATEX_TESTS !== "1")("saved layout PDF integration", () => {
  it("compiles saved settings and preserves the earlier source and settings snapshot after edits", async () => {
    const firstSettings = {
      ...defaultResumeSettings,
      fontSize: 12 as const,
      marginInches: 0.75 as const,
      paper: "a4" as const,
      spacing: "comfortable" as const,
    };
    await saveResumeSettings("owner-a", "jakes", firstSettings);
    const first = await generateResume({
      userId: "owner-a",
      profile: profile(),
      templateId: "jakes",
      track: "general",
    });
    expect(first.validation.valid).toBe(true);
    expect(first.templateSettings).toEqual(firstSettings);
    const source = await readArtifact("owner-a", first.texKey);
    expect(source.toString()).toContain("a4paper,12pt");
    await saveResumeSettings("owner-a", "jakes", defaultResumeSettings);
    const second = await generateResume({
      userId: "owner-a",
      profile: profile(),
      templateId: "jakes",
      track: "general",
    });
    expect(second.validation.valid).toBe(true);
    expect(second.templateSettings).toEqual(defaultResumeSettings);
    expect((await readArtifact("owner-a", first.texKey)).equals(source)).toBe(true);
    expect(
      (await getStore().get("generated_resumes", first.id, "owner-a"))?.templateSettings,
    ).toEqual(firstSettings);
  }, 60000);
});
