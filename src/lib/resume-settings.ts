import { z } from "zod";

/** Closed choices keep layout customization separate from executable TeX. */
export const resumeSettingsSchema = z
  .object({
    font: z.enum(["template", "serif", "sans"]).default("template"),
    fontSize: z.union([z.literal(10), z.literal(11), z.literal(12)]).default(11),
    marginInches: z.union([z.literal(0.65), z.literal(0.75), z.literal(0.9)]).default(0.65),
    spacing: z.enum(["compact", "comfortable"]).default("compact"),
    paper: z.enum(["letter", "a4"]).default("letter"),
  })
  .strict();
export type ResumeSettings = z.infer<typeof resumeSettingsSchema>;
export const defaultResumeSettings: ResumeSettings = resumeSettingsSchema.parse({});
