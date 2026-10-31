import { z } from "zod";

export const trackSchema = z.enum(["software", "finance", "consulting", "product", "general"]);
export type CareerTrack = z.infer<typeof trackSchema>;
export const verificationSchema = z.enum(["verified", "user_confirmed", "imported", "suggestion"]);
export const claimSchema = z.object({
  id: z.string(),
  type: z.enum(["experience", "project", "skill", "achievement", "education"]),
  text: z.string().min(1).max(2000),
  source: z.string().max(500),
  sourceUrl: z.string().max(2000).optional(),
  verification: verificationSchema,
  confirmed: z.boolean(),
  updatedAt: z.string(),
  track: trackSchema.default("general"),
});
export type Claim = z.infer<typeof claimSchema>;
export const educationSchema = z.object({
  id: z.string(),
  school: z.string(),
  degree: z.string(),
  major: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  gpa: z.string().optional(),
  coursework: z.string().optional(),
});
export const experienceSchema = z.object({
  id: z.string(),
  company: z.string(),
  title: z.string(),
  location: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  bullets: z.array(z.string().max(1500)).max(12),
  confirmed: z.boolean(),
});
export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  technologies: z.array(z.string()),
  url: z.string(),
  contribution: z.string(),
  confirmed: z.boolean(),
});
export const profileSchema = z.object({
  legalName: z.string().max(200),
  preferredName: z.string().max(200).default(""),
  email: z.string().email(),
  phone: z.string().max(50).default(""),
  location: z.string().max(200).default(""),
  headline: z.string().max(250).default(""),
  website: z.string().max(2000).default(""),
  linkedin: z.string().max(2000).default(""),
  github: z.string().max(200).default(""),
  devpost: z.string().max(2000).default(""),
  education: z.array(educationSchema).max(20).default([]),
  experiences: z.array(experienceSchema).max(50).default([]),
  projects: z.array(projectSchema).max(100).default([]),
  skills: z.array(z.string().max(100)).max(100).default([]),
  claims: z.array(claimSchema).max(500).default([]),
  preferences: z
    .object({
      tracks: z.array(trackSchema).default(["software"]),
      titles: z.array(z.string()).default([]),
      locations: z.array(z.string()).default([]),
      workplace: z.enum(["any", "remote", "hybrid", "onsite"]).default("any"),
      employment: z.enum(["any", "internship", "fulltime", "parttime", "contract"]).default("any"),
      season: z.string().default(""),
      minSalary: z.number().nonnegative().nullable().default(null),
      excludedCompanies: z.array(z.string()).default([]),
      targetCompanies: z.array(z.string()).default([]),
    })
    .default({
      tracks: ["software"],
      titles: [],
      locations: [],
      workplace: "any",
      employment: "any",
      season: "",
      minSalary: null,
      excludedCompanies: [],
      targetCompanies: [],
    }),
  eligibility: z
    .object({
      country: z.string().default(""),
      workAuthorization: z.enum(["yes", "no", "unknown"]).default("unknown"),
      sponsorship: z.enum(["yes", "no", "unknown"]).default("unknown"),
      confirmedAt: z.string().nullable().default(null),
    })
    .default({
      country: "",
      workAuthorization: "unknown",
      sponsorship: "unknown",
      confirmedAt: null,
    }),
  defaultTemplate: z.string().default("jakes"),
  trackTemplates: z.record(z.string(), z.string()).default({}),
  onboardingStep: z.number().int().min(0).max(4).default(0),
  autonomy: z
    .object({
      enabled: z.boolean().default(false),
      allowedDomains: z.array(z.string()).max(30).default([]),
      maxPerDay: z.number().int().min(1).max(20).default(3),
      minScore: z.number().min(0).max(100).default(80),
      approvedAt: z.string().nullable().default(null),
    })
    .default({ enabled: false, allowedDomains: [], maxPerDay: 3, minScore: 80, approvedAt: null }),
});
export type CandidateProfile = z.infer<typeof profileSchema>;
export type Entity = { id: string; userId: string; createdAt: string; updatedAt: string };
export type ProfileRecord = Entity & { profile: CandidateProfile; version: number };
export const applicationStatusSchema = z.enum([
  "discovered",
  "evaluating",
  "resume_preparing",
  "ready",
  "applying",
  "needs_input",
  "submitted",
  "submission_unverified",
  "failed",
  "interview",
  "rejected",
  "offer",
  "withdrawn",
]);
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;
export type Job = {
  url: string;
  canonicalUrl: string;
  externalId: string;
  ats: "fixture" | "greenhouse" | "lever" | "generic" | "workday";
  company: string;
  title: string;
  location: string;
  description: string;
  requirements: string[];
  salary: string;
  track: CareerTrack;
};
export type Application = Entity & {
  jobUrl: string;
  job: Job | null;
  status: ApplicationStatus;
  runId: string;
  resumeId: string | null;
  matchScore: number | null;
  matchReasons: string[];
  answers: Record<string, string>;
  answerContexts?: Record<string, string>;
  eligibilityContext?: string;
  formSnapshotHash?: string;
  preparedFields?: Record<string, string>;
  receipt: { confirmation: string; url: string; screenshotKey?: string; verifiedAt: string } | null;
  error: string | null;
  submittedAt: string | null;
  submissionStartedAt: string | null;
  approvalId: string | null;
};
export const stages = [
  "reading_job",
  "evaluating",
  "selecting_resume",
  "tailoring",
  "generating_pdf",
  "validating_resume",
  "opening_application",
  "authenticating",
  "completing_questions",
  "uploading",
  "awaiting_approval",
  "submitting",
  "verifying",
  "completed",
  "needs_input",
  "failed",
] as const;
export type Stage = (typeof stages)[number];
export type AgentRun = Entity & {
  applicationId: string;
  kind: "application" | "resume" | "discovery" | "email" | "import";
  status: "queued" | "running" | "waiting" | "completed" | "failed";
  stage: Stage;
  attempts: number;
  maxAttempts: number;
  leaseUntil: string | null;
  nextAttemptAt: string;
  error: string | null;
  approved: boolean;
  submitted: boolean;
  resumeId?: string;
  input?: Record<string, string>;
  startedAt?: string;
  finishedAt?: string;
};
export type AppEvent = Entity & {
  applicationId: string;
  runId: string;
  stage: Stage;
  message: string;
  details?: Record<string, unknown>;
};
export type Approval = Entity & {
  applicationId: string;
  runId: string;
  kind: "submission" | "question" | "login" | "account_creation";
  status: "pending" | "approved" | "denied";
  title: string;
  description: string;
  questions: { key: string; label: string; options?: string[] }[];
  response: Record<string, string>;
  resolvedAt: string | null;
  snapshotHash?: string;
};
export type ScreeningAnswer = Entity & {
  question: string;
  key: string;
  answer: string;
  scope: string;
  confirmed: boolean;
  effectiveFrom: string;
  effectiveUntil: string | null;
  sensitive: boolean;
};
export type GeneratedResume = Entity & {
  templateId: string;
  track: CareerTrack;
  applicationId: string | null;
  title: string;
  content: ResumeContent;
  texKey: string;
  pdfKey: string | null;
  validation: {
    valid: boolean;
    pages: number;
    errors: string[];
    warnings: string[];
    textExtractable: boolean;
  };
  sourceClaimIds: string[];
};
export type ResumeContent = {
  name: string;
  email: string;
  phone: string;
  location: string;
  links: { label: string; url: string }[];
  summary: string;
  education: { school: string; degree: string; dates: string; detail: string }[];
  experience: {
    title: string;
    company: string;
    dates: string;
    location: string;
    bullets: string[];
  }[];
  projects: { name: string; detail: string; url: string; bullets: string[] }[];
  skills: string[];
};
export type ResumeTemplate = Entity & {
  name: string;
  track: CareerTrack;
  source: string;
  custom: boolean;
  license: string;
};
export type Message = Entity & {
  role: "user" | "assistant";
  content: string;
  applicationId: string | null;
};
export type Subscription = Entity & {
  plan: "free" | "pro" | "autonomous";
  status: string;
  customerId: string | null;
  subscriptionId: string | null;
  periodEnd: string | null;
};
export type UsageEvent = Entity & {
  kind: "attempt" | "verified_submission" | "model" | "browser" | "retry" | "reservation";
  applicationId: string | null;
  quantity: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd: number;
};
export type Integration = Entity & {
  provider: string;
  status: "connected" | "disconnected" | "needs_configuration";
  account: string;
  scopes: string[];
  secretRef: string | null;
};
export type JobSource = Entity & {
  name: string;
  url: string;
  kind: "github" | "greenhouse" | "lever";
  enabled: boolean;
  lastCheckedAt: string | null;
  lastRevision: string | null;
  error: string | null;
};
export type Notification = Entity & {
  title: string;
  body: string;
  read: boolean;
  applicationId: string | null;
};
export type Source = Entity & {
  name: string;
  kind: string;
  storageKey: string | null;
  url: string | null;
  text: string;
  importedAt: string;
  status?: "queued" | "ready" | "failed";
  error?: string;
};
export type AuditAction = Entity & {
  action: string;
  applicationId: string | null;
  details: Record<string, unknown>;
};
export interface Records {
  candidate_profiles: ProfileRecord;
  profile_versions: ProfileRecord;
  applications: Application;
  agent_runs: AgentRun;
  application_events: AppEvent;
  approval_requests: Approval;
  screening_answers: ScreeningAnswer;
  generated_resumes: GeneratedResume;
  resume_templates: ResumeTemplate;
  messages: Message;
  subscriptions: Subscription;
  usage_events: UsageEvent;
  integration_connections: Integration;
  job_sources: JobSource;
  notifications: Notification;
  profile_sources: Source;
  agent_actions: AuditAction;
}
export type Collection = keyof Records;
export const collections: Collection[] = [
  "candidate_profiles",
  "profile_versions",
  "applications",
  "agent_runs",
  "application_events",
  "approval_requests",
  "screening_answers",
  "generated_resumes",
  "resume_templates",
  "messages",
  "subscriptions",
  "usage_events",
  "integration_connections",
  "job_sources",
  "notifications",
  "profile_sources",
  "agent_actions",
];
export type User = { id: string; email: string; name: string };
export function entity(userId: string, id = crypto.randomUUID()): Entity {
  const now = new Date().toISOString();
  return { id, userId, createdAt: now, updatedAt: now };
}
export function emptyProfile(email: string, name = ""): CandidateProfile {
  return profileSchema.parse({ email, legalName: name });
}
