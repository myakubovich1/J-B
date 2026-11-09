"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Bell,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  LayoutGrid,
  Link2,
  ListChecks,
  LoaderCircle,
  Menu,
  MessageSquare,
  Plus,
  Radar,
  Settings,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { Asterisk, Logo } from "./brand";
import type { Workspace } from "@/lib/workspace";
import type {
  Application,
  Approval,
  CandidateProfile,
  CareerTrack,
  GeneratedResume,
} from "@/lib/contracts";
import { Badge, Button, Card, Empty, Field, Input, cn } from "./ui";
import { ProfileEditor } from "./profile-editor";
import {
  ResumeLibrary,
  ApplicationList,
  DiscoverView,
  IntegrationsView,
  SettingsView,
} from "./workspace-views";
import { useModalFocus } from "./modal-focus";

export type View =
  "agent" | "profile" | "resumes" | "applications" | "discover" | "integrations" | "settings";
export type Action = (data: Record<string, unknown>, success?: string) => Promise<boolean>;
const nav: [View, string, typeof Radar][] = [
  ["agent", "Agent", MessageSquare],
  ["profile", "Career Profile", UserRound],
  ["resumes", "Resumes", FileText],
  ["applications", "Applications", BriefcaseBusiness],
  ["discover", "Discover", Radar],
];
export const statusLabel = (s: string) =>
  ({
    ready: "Ready for review",
    needs_input: "Needs your input",
    resume_preparing: "Preparing resume",
    submission_unverified: "Receipt unverified",
    submitted: "Submitted",
    applying: "Applying",
    evaluating: "Reading job",
    discovered: "Discovered",
    interview: "Interview",
    rejected: "Rejected",
    offer: "Offer",
    withdrawn: "Withdrawn",
    failed: "Needs attention",
  })[s] ?? s.replaceAll("_", " ");
export const stageLabel = (s: string) =>
  ({
    reading_job: "Reading the job",
    evaluating: "Checking your fit",
    selecting_resume: "Choosing a template",
    tailoring: "Tailoring your resume",
    generating_pdf: "Generating your PDF",
    validating_resume: "Checking the details",
    opening_application: "Opening the application",
    authenticating: "Waiting for sign in",
    completing_questions: "Completing the questions",
    uploading: "Uploading your resume",
    awaiting_approval: "Ready for your review",
    submitting: "Submitting application",
    verifying: "Verifying the receipt",
    completed: "All done",
    needs_input: "A quick question for you",
    failed: "Needs attention",
  })[s] ?? s.replaceAll("_", " ");
export const date = (s: string) =>
  new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
export function WorkspaceApp({ initial }: { initial: Workspace }) {
  useModalFocus();
  const [data, setData] = useState(initial),
    [view, setView] = useState<View>("agent"),
    [menu, setMenu] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [showNotifications, setShowNotifications] = useState(false),
    [selectedApp, setSelectedApp] = useState<string | null>(null),
    [preview, setPreview] = useState<GeneratedResume | null>(null);
  const refreshing = useRef(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width:760px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const r = await fetch("/api/workspace", { cache: "no-store" });
      if (r.status === 401) {
        window.location.reload();
        return;
      }
      if (r.ok) setData(await r.json());
    } finally {
      refreshing.current = false;
    }
  }, []);
  useEffect(() => {
    const hash = window.location.hash.slice(1) as View;
    if ([...nav.map((n) => n[0]), "integrations", "settings"].includes(hash)) setView(hash);
  }, []);
  const active = data.runs.some((r) => ["queued", "running"].includes(r.status));
  useEffect(() => {
    const id = setInterval(
      () => {
        if (document.visibilityState === "visible") void refresh();
      },
      active ? 2200 : 12000,
    );
    return () => clearInterval(id);
  }, [active, refresh]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 5500);
    return () => clearTimeout(id);
  }, [notice]);
  const go = (next: View) => {
    setView(next);
    setMenu(false);
    window.history.replaceState(null, "", `#${next}`);
  };
  const act: Action = async (body, success) => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error ?? "Something went wrong.");
      await refresh();
      if (success) setNotice(success);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach your workspace.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const pending = data.approvals.filter((a) => a.status === "pending");
  const unread = data.notifications.filter((n) => !n.read).length;
  const complete = [
    Boolean(data.profile.legalName && data.profile.phone && data.profile.location),
    Boolean(data.profile.education.length || data.profile.experiences.some((e) => e.confirmed)),
    Boolean(data.profile.skills.length || data.profile.projects.some((p) => p.confirmed)),
    Boolean(data.profile.eligibility.confirmedAt),
    Boolean(data.resumes.some((r) => r.validation.valid)),
  ].filter(Boolean).length;
  const name =
    data.profile.preferredName ||
    data.profile.legalName.split(" ")[0] ||
    data.user.name.split(" ")[0] ||
    "there";
  return (
    <div className="app-shell" data-ready={ready}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {menu && mobile && (
        <button
          className="mobile-nav-backdrop"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <aside inert={mobile && !menu} className={cn("sidebar", menu && "sidebar-open")}>
        <a href="#agent" onClick={() => go("agent")} className="brand" aria-label="J*B agent">
          <Logo size={26} />
        </a>
        <Button
          variant="secondary"
          className="new-application"
          onClick={() => {
            go("agent");
            document.getElementById("agent-message")?.focus();
          }}
        >
          <Plus size={17} />
          New application<span className="key-hint">↗</span>
        </Button>
        <div className="nav-section-label">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              className={cn("nav-item", view === id && "nav-active")}
              onClick={() => go(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {id === "applications" && pending.length > 0 && (
                <span className="nav-count">{pending.length}</span>
              )}
              {id === "discover" && <span className="nav-pro">AUTO</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="journey-card">
            <div className="flex-between">
              <span className="mini-icon">
                <ListChecks size={16} />
              </span>
              <small>{complete}/5 complete</small>
            </div>
            <h4>Set up your agent</h4>
            <p>The more J*B knows, the better every application gets.</p>
            <div className="progress-track">
              <span style={{ width: `${complete * 20}%` }} />
            </div>
            <button onClick={() => go("profile")}>
              Build your profile
              <ArrowRight size={14} />
            </button>
          </div>
          <nav aria-label="Account navigation">
            <button
              className={cn("nav-item", view === "integrations" && "nav-active")}
              onClick={() => go("integrations")}
            >
              <LayoutGrid size={18} />
              Integrations
            </button>
            <button
              className={cn("nav-item", view === "settings" && "nav-active")}
              onClick={() => go("settings")}
            >
              <Settings size={18} />
              Settings & Billing
            </button>
          </nav>
          <button className="user-menu" onClick={() => go("settings")}>
            <span className="avatar">{name.slice(0, 1).toUpperCase()}</span>
            <span>
              <strong>{data.user.name || data.profile.legalName || "Your workspace"}</strong>
              <small>
                {data.billing.plan === "free" ? "Free workspace" : `${data.billing.plan} member`}
              </small>
            </span>
            <ChevronDown size={15} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="mobile-menu"
              onClick={() => setMenu(!menu)}
              aria-label="Toggle navigation"
              aria-expanded={menu}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {
                [...nav, ["integrations", "Integrations"], ["settings", "Settings & Billing"]].find(
                  (n) => n[0] === view,
                )?.[1] as string
              }
            </strong>
          </div>
          <div className="topbar-actions">
            <span className="workspace-mode">
              <span className="status-dot" />
              {data.capabilities.mode === "local" ? "Local workspace" : "Private workspace"}
            </span>
            <span className="topbar-divider" />
            <button
              className="icon-button"
              aria-label="View notifications"
              onClick={() => {
                setShowNotifications(!showNotifications);
                if (unread) void act({ action: "read_notifications" });
              }}
            >
              <Bell size={18} />
              {unread > 0 && <i className="notification-dot" />}
            </button>
            <span className="avatar avatar-small">{name.slice(0, 1).toUpperCase()}</span>
          </div>
        </header>
        {showNotifications && (
          <div className="notification-panel">
            <div className="flex-between">
              <h3>Your updates</h3>
              <button
                className="icon-button"
                aria-label="Close notifications"
                onClick={() => setShowNotifications(false)}
              >
                <X size={16} />
              </button>
            </div>
            {data.notifications.length ? (
              data.notifications
                .slice()
                .reverse()
                .map((n) => (
                  <div key={n.id} className="notification-row">
                    <strong>{n.title}</strong>
                    <p>{n.body}</p>
                    <small>{date(n.createdAt)}</small>
                  </div>
                ))
            ) : (
              <p className="muted">You’re all caught up. Updates will appear here.</p>
            )}
          </div>
        )}
        <main id="main" className={cn("main-content", view === "agent" && "agent-main")}>
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {data.capabilities.emergencyStop && (
            <div className="error-banner">
              Applications are paused by the workspace administrator.
            </div>
          )}
          {view === "agent" && (
            <AgentView
              data={data}
              name={name}
              go={go}
              act={act}
              busy={busy}
              openApp={setSelectedApp}
              preview={setPreview}
            />
          )}
          {view === "profile" && (
            <ProfileEditor
              key={data.profileVersion}
              data={data}
              act={act}
              refresh={refresh}
              busy={busy}
            />
          )}
          {view === "resumes" && (
            <ResumeLibrary
              data={data}
              act={act}
              busy={busy}
              preview={setPreview}
              refresh={refresh}
            />
          )}
          {view === "applications" && (
            <ApplicationList data={data} openApp={setSelectedApp} act={act} />
          )}
          {view === "discover" && <DiscoverView data={data} act={act} busy={busy} go={go} />}
          {view === "integrations" && (
            <IntegrationsView data={data} act={act} refresh={refresh} go={go} />
          )}
          {view === "settings" && <SettingsView data={data} act={act} refresh={refresh} />}
        </main>
        <footer className="workspace-footer">
          <span>
            <ShieldCheck size={12} />
            Private by default. You approve every submission.
          </span>
          <span>
            <Asterisk size={11} className="footer-star" />
            J*B · jasteriskb.com
          </span>
        </footer>
      </div>
      {notice && (
        <div className="toast" role="status">
          <span className="toast-check">
            <Check size={14} />
          </span>
          {notice}
        </div>
      )}
      {selectedApp && (
        <ApplicationDetail
          application={data.applications.find((a) => a.id === selectedApp)!}
          data={data}
          close={() => setSelectedApp(null)}
          act={act}
          preview={setPreview}
        />
      )}{" "}
      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <section
            className="modal resume-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Resume preview"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <div className="eyebrow">RESUME PREVIEW</div>
                <h2>{preview.title}</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close preview"
                onClick={() => setPreview(null)}
              >
                <X size={20} />
              </button>
            </div>
            {preview.pdfKey ? (
              <iframe title="Generated resume PDF" src={`/api/artifacts/${preview.id}`} />
            ) : (
              <div className="notice">
                {preview.validation.errors.join(" ") || "PDF compilation is pending."}
              </div>
            )}
            <div className="modal-footer">
              <a
                className="button button-secondary"
                href={`/api/artifacts/${preview.id}?format=tex`}
              >
                <FileText size={15} />
                LaTeX source
              </a>
              {preview.pdfKey && (
                <a
                  className="button button-primary"
                  href={`/api/artifacts/${preview.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ArrowDownToLine size={15} />
                  Open PDF
                </a>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function AgentView({
  data,
  name,
  go,
  act,
  busy,
  openApp,
  preview,
}: {
  data: Workspace;
  name: string;
  go: (v: View) => void;
  act: Action;
  busy: boolean;
  openApp: (id: string) => void;
  preview: (r: GeneratedResume) => void;
}) {
  const [message, setMessage] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [clientTime, setClientTime] = useState(false);
  useEffect(() => setClientTime(true), []);
  useEffect(() => {
    if (started) end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [data.messages.length, started]);
  async function send(text = message) {
    if (!text.trim() || busy) return;
    setStarted(true);
    if (await act({ action: "chat", message: text })) setMessage("");
  }
  const pending = data.approvals.filter((a) => a.status === "pending");
  return (
    <div className="agent-layout">
      <section className="agent-conversation">
        <div className="agent-heading">
          <div>
            <div className="eyebrow">
              <Asterisk size={11} className="eyebrow-star" />
              YOUR PERSONAL AI CAREER AGENT
            </div>
            <h1>
              Hi {name}.
              <br />
              <span>What should we apply to next?</span>
            </h1>
          </div>
          <div className="agent-status">
            <span className="status-dot" />
            Agent ready
          </div>
        </div>
        {data.messages.length === 0 ? (
          <div className="agent-welcome">
            <div className="greeting">
              <span className="agent-avatar">
                <Asterisk size={16} color="#fff" />
              </span>
              <div>
                <h3>Paste a job link and I’ll take it from there.</h3>
                <p>
                  I read the role, tailor your resume from facts you’ve confirmed, and prepare the
                  application. Nothing is submitted until you approve it.
                </p>
              </div>
            </div>
            <div className="starter-grid">
              <button
                className="starter-card"
                onClick={() => {
                  setMessage("");
                  document.getElementById("agent-message")?.focus();
                }}
              >
                <span className="starter-icon peach">
                  <Link2 size={20} />
                </span>
                <h3>Apply to a job</h3>
                <p>Paste a Greenhouse or Lever link. I’ll prepare everything for your review.</p>
                <ArrowRight size={18} />
              </button>
              <button className="starter-card" onClick={() => go("profile")}>
                <span className="starter-icon sage">
                  <UserRound size={20} />
                </span>
                <h3>Build your profile</h3>
                <p>Import a resume or GitHub repositories, then confirm what’s true.</p>
                <ArrowRight size={18} />
              </button>
              <button className="starter-card" onClick={() => go("resumes")}>
                <span className="starter-icon lavender">
                  <FileText size={20} />
                </span>
                <h3>Pick a resume template</h3>
                <p>Jake’s Resume and five more LaTeX templates, by career track.</p>
                <ArrowRight size={18} />
              </button>
            </div>
            <div className="agent-note">
              <ShieldCheck size={16} />
              <span>I only use facts you confirm. You stay in control of every application.</span>
            </div>
          </div>
        ) : (
          <div className="chat-history" aria-live="polite">
            {data.messages.map((m) => (
              <div
                key={m.id}
                className={cn("chat-message", m.role === "user" ? "message-user" : "message-agent")}
              >
                <span className={m.role === "user" ? "avatar avatar-small" : "agent-avatar"}>
                  {m.role === "user" ? name.slice(0, 1) : <Asterisk size={14} color="#fff" />}
                </span>
                <div>
                  <div className="message-author">
                    {m.role === "user" ? "You" : "J*B"}
                    <span>
                      {clientTime
                        ? new Date(m.createdAt).toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                          })
                        : ""}
                    </span>
                  </div>
                  <p>{m.content}</p>
                  {m.applicationId && m.role === "assistant" && (
                    <button className="text-link" onClick={() => openApp(m.applicationId!)}>
                      View application
                      <ArrowRight size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {data.applications
              .slice(0, 3)
              .filter((a) => !["withdrawn", "rejected", "offer"].includes(a.status))
              .map((a) => (
                <ApplicationProgress
                  key={a.id}
                  app={a}
                  data={data}
                  openApp={openApp}
                  preview={preview}
                />
              ))}
            {pending.map((a) => (
              <ApprovalCard key={a.id} approval={a} act={act} data={data} preview={preview} />
            ))}
            <div ref={end} />
          </div>
        )}
        <div className="composer-region">
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <div className="composer-top">
              <span className="composer-plus">
                <Link2 size={18} />
              </span>
              <textarea
                id="agent-message"
                aria-label="Message your career agent"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="Paste a job link, or ask your agent anything…"
                rows={2}
                maxLength={5000}
              />
              <button
                className="send-button"
                type="submit"
                disabled={!message.trim() || busy}
                aria-label="Send message"
              >
                {busy ? <LoaderCircle size={18} className="spin" /> : <ArrowRight size={20} />}
              </button>
            </div>
            <div className="composer-bottom">
              <span>
                <Asterisk size={11} />
                J*B agent
              </span>
              <span>↵ to send</span>
            </div>
          </form>
          <div className="composer-disclaimer">
            {data.capabilities.ai
              ? "AI assisted · Review your details before submitting."
              : "Using confirmed profile facts · AI tailoring is not configured."}
          </div>
          {data.capabilities.testEmployer && (
            <button
              className="fixture-shortcut"
              disabled={busy}
              onClick={() =>
                void send(`Apply to ${window.location.origin}/fixture/employer/software-intern`)
              }
            >
              Try the local test employer
              <ArrowRight size={12} />
            </button>
          )}
        </div>
      </section>
      <AgentContext data={data} name={name} go={go} openApp={openApp} preview={preview} />
    </div>
  );
}

const flow: { label: string; done: (app: Application, stage: string) => boolean }[] = [
  { label: "Job read", done: (a) => Boolean(a.job) },
  { label: "Resume tailored", done: (a) => Boolean(a.resumeId) },
  {
    label: "Application filled",
    done: (a, s) =>
      Boolean(a.preparedFields && Object.keys(a.preparedFields).length) ||
      ["awaiting_approval", "submitting", "verifying", "completed"].includes(s),
  },
  {
    label: "Your approval",
    done: (a) => Boolean(a.submissionStartedAt || a.receipt),
  },
  { label: "Submitted & verified", done: (a) => Boolean(a.receipt) },
];

/** Right panel: the application in focus, or the profile when nothing is in motion. */
function AgentContext({
  data,
  name,
  go,
  openApp,
  preview,
}: {
  data: Workspace;
  name: string;
  go: (v: View) => void;
  openApp: (id: string) => void;
  preview: (r: GeneratedResume) => void;
}) {
  const inMotion = data.applications.filter(
    (a) => !["withdrawn", "rejected", "offer", "failed"].includes(a.status),
  );
  const pendingApp = data.approvals.find((a) => a.status === "pending")?.applicationId;
  const focus =
    data.applications.find((a) => a.id === pendingApp) ?? inMotion[0] ?? data.applications[0];
  const resume = focus && data.resumes.find((r) => r.id === focus.resumeId);
  const run = focus && data.runs.find((r) => r.id === focus.runId);
  const template = resume && data.templates.find((t) => t.id === resume.templateId);
  const firstOpen = focus ? flow.findIndex((f) => !f.done(focus, run?.stage ?? "")) : -1;
  return (
    <aside className="agent-context" aria-label="Application context">
      {focus ? (
        <>
          <div className="context-title">
            {focus.id === pendingApp ? "NEEDS YOUR REVIEW" : "CURRENT APPLICATION"}
            <span className="context-line" />
          </div>
          <Card className="context-job">
            <div className="flex-between">
              <span className="company-monogram">{focus.job?.company[0] ?? "↗"}</span>
              <Badge tone={focus.receipt ? "green" : focus.status === "failed" ? "red" : "orange"}>
                {statusLabel(focus.status)}
              </Badge>
            </div>
            <h3>{focus.job?.title ?? "Reading your job link"}</h3>
            <p>
              {focus.job?.company ?? new URL(focus.jobUrl).hostname}
              {focus.job?.location ? ` · ${focus.job.location}` : ""}
            </p>
            <a className="text-link" href={focus.jobUrl} target="_blank" rel="noreferrer">
              Original posting
              <ExternalLink size={12} />
            </a>
          </Card>
          {focus.matchScore !== null && (
            <Card className="context-match">
              <div className="flex-between">
                <span className="context-label">Candidate match</span>
                <strong>{focus.matchScore}%</strong>
              </div>
              <div className="progress-track">
                <span style={{ width: `${Math.max(4, Math.min(100, focus.matchScore))}%` }} />
              </div>
              {focus.matchReasons.length > 0 && (
                <ul className="reason-list">
                  {focus.matchReasons.slice(0, 3).map((r, i) => (
                    <li key={i}>
                      <Check size={13} />
                      {r}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          <Card className="context-resume">
            <span className="context-label">Tailored resume</span>
            {resume ? (
              <button className="context-resume-button" onClick={() => preview(resume)}>
                <span className="context-paper" aria-hidden="true">
                  {template && !template.custom ? (
                    <img src={`/templates/${template.id}.png`} alt="" />
                  ) : (
                    <FileText size={22} />
                  )}
                </span>
                <span>
                  <strong>{resume.title}</strong>
                  <small>
                    {template?.name ?? "Custom template"} · {resume.validation.pages} page ·{" "}
                    {resume.validation.valid ? "Validated" : "Needs review"}
                  </small>
                  <em>Open the exact PDF</em>
                </span>
              </button>
            ) : (
              <p className="muted">Your resume appears here once it’s tailored.</p>
            )}
          </Card>
          <Card className="context-steps">
            <span className="context-label">Submission status</span>
            <ol>
              {flow.map((f, i) => {
                const done = f.done(focus, run?.stage ?? "");
                return (
                  <li
                    key={f.label}
                    className={done ? "step-done" : i === firstOpen ? "step-current" : ""}
                  >
                    <span>{done ? <Check size={11} /> : i + 1}</span>
                    {f.label}
                  </li>
                );
              })}
            </ol>
            {focus.receipt && <p className="context-receipt">{focus.receipt.confirmation}</p>}
            <button className="text-link" onClick={() => openApp(focus.id)}>
              Full application details
              <ArrowRight size={13} />
            </button>
          </Card>
          {inMotion.length > 1 && (
            <>
              <div className="context-heading">
                <h3>Also in motion</h3>
                <span>{inMotion.length - 1}</span>
              </div>
              <div className="next-moves">
                {inMotion
                  .filter((a) => a.id !== focus.id)
                  .slice(0, 3)
                  .map((a) => (
                    <button key={a.id} onClick={() => openApp(a.id)}>
                      <span className="company-monogram">{a.job?.company[0] ?? "↗"}</span>
                      <span>
                        <strong>{a.job?.title ?? "Reading your job link"}</strong>
                        <small>
                          {a.job?.company ?? new URL(a.jobUrl).hostname} · {statusLabel(a.status)}
                        </small>
                      </span>
                      <ChevronRight size={14} />
                    </button>
                  ))}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="context-title">
            YOUR CAREER PROFILE
            <span className="context-line" />
          </div>
          <Card className="profile-context">
            <div className="profile-context-art" aria-hidden="true">
              <span className="profile-art-letter">{name[0]?.toUpperCase()}</span>
              <Asterisk size={18} className="profile-art-spark" />
            </div>
            <div className="flex-between">
              <span className="eyebrow">CAREER PROFILE</span>
              <span className="mini-status">
                {data.profileVersion ? "In progress" : "Not started"}
              </span>
            </div>
            <h3>{data.profile.legalName || "Tell J*B about you"}</h3>
            <p>
              {data.profile.headline ||
                "Your experience, skills, and preferences. The source of truth for every application."}
            </p>
            <div className="profile-detail-row">
              <span>Career track</span>
              <strong>{trackName(data.profile.preferences.tracks[0] ?? "general")}</strong>
            </div>
            <button className="text-link" onClick={() => go("profile")}>
              {data.profileVersion ? "Update your profile" : "Build your profile"}
              <ArrowRight size={14} />
            </button>
          </Card>
          <div className="next-move-empty">
            <span className="dotted-route">
              <i />
              <span />
              <i />
            </span>
            <h4>No applications yet</h4>
            <p>Paste a job link in the chat. Job details, your match, and status will show here.</p>
          </div>
        </>
      )}
      <div className="context-usage">
        <div className="flex-between">
          <span>
            {data.billing.used} of {data.billing.limit} applications
          </span>
          <small>This month</small>
        </div>
        <div className="progress-track">
          <span
            style={{ width: `${Math.min(100, (data.billing.used / data.billing.limit) * 100)}%` }}
          />
        </div>
        <button className="text-link" onClick={() => go("settings")}>
          Plans & usage
          <ArrowRight size={12} />
        </button>
      </div>
    </aside>
  );
}
export function trackName(t: string) {
  return (
    {
      software: "Software engineering",
      finance: "Finance",
      consulting: "Consulting",
      product: "Product management",
      general: "General",
    }[t] ?? t
  );
}
function ApplicationProgress({
  app,
  data,
  openApp,
  preview,
}: {
  app: Application;
  data: Workspace;
  openApp: (id: string) => void;
  preview: (r: GeneratedResume) => void;
}) {
  const run = data.runs.find((r) => r.id === app.runId),
    resume = data.resumes.find((r) => r.id === app.resumeId);
  return (
    <Card className="application-progress">
      <div className="flex-between">
        <div className="application-identity">
          <span className="company-monogram">{app.job?.company[0] ?? "↗"}</span>
          <div>
            <strong>{app.job?.title ?? "Reading your job link"}</strong>
            <small>{app.job?.company ?? new URL(app.jobUrl).hostname}</small>
          </div>
        </div>
        <Badge
          tone={app.status === "submitted" ? "green" : app.status === "failed" ? "red" : "orange"}
        >
          {statusLabel(app.status)}
        </Badge>
      </div>
      <div className="run-stage">
        {run?.status === "running" ? (
          <LoaderCircle className="spin" size={15} />
        ) : app.status === "submitted" ? (
          <Check size={15} />
        ) : (
          <span className="stage-dot" />
        )}
        {stageLabel(run?.stage ?? "reading_job")}
        {app.matchScore !== null && <span>{app.matchScore}% relevance</span>}
      </div>
      {app.error && <p className="error-text">{app.error}</p>}
      <div className="flex-between progress-actions">
        {resume ? (
          <button className="text-link" onClick={() => preview(resume)}>
            <FileText size={14} />
            View tailored resume
          </button>
        ) : (
          <span />
        )}
        <button className="text-link" onClick={() => openApp(app.id)}>
          See details
          <ArrowRight size={13} />
        </button>
      </div>
    </Card>
  );
}
export function ApprovalCard({
  approval,
  act,
  data,
  preview,
}: {
  approval: Approval;
  act: Action;
  data: Workspace;
  preview: (r: GeneratedResume) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [handoff, setHandoff] = useState<string | null>(null),
    [handoffError, setHandoffError] = useState("");
  const app = data.applications.find((a) => a.id === approval.applicationId),
    resume = data.resumes.find((r) => r.id === app?.resumeId);
  return (
    <Card className="approval-card">
      <div className="eyebrow">
        <ShieldCheck size={14} />
        {approval.kind === "submission" ? "YOUR REVIEW, YOUR CALL" : "A LITTLE HELP FROM YOU"}
      </div>
      <h3>{approval.title}</h3>
      <p>{approval.description}</p>
      {approval.kind === "submission" && resume && (
        <>
          <button className="review-resume-button" onClick={() => preview(resume)}>
            <FileText size={21} />
            <span>
              <strong>{resume.title}</strong>
              <small>View the exact resume for this application</small>
            </span>
            <ArrowRight size={17} />
          </button>
          {app && Object.keys(app.preparedFields ?? app.answers).length > 0 && (
            <details className="answers-review">
              <summary>Review the answers to be submitted</summary>
              {Object.entries(app.preparedFields ?? app.answers).map(([k, v]) => (
                <div key={k}>
                  <strong>{k.replaceAll("_", " ")}</strong>
                  <span>{v}</span>
                </div>
              ))}
            </details>
          )}
        </>
      )}
      {approval.kind === "login" && (
        <div className="login-handoff">
          {handoff ? (
            <a className="button button-secondary" href={handoff} target="_blank" rel="noreferrer">
              Continue in secure browser
              <ArrowRight size={14} />
            </a>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                setHandoffError("");
                try {
                  const response = await fetch(`/api/browser-handoff/${approval.runId}`, {
                    cache: "no-store",
                  });
                  const result = await response.json();
                  if (!response.ok) throw new Error(result.error);
                  setHandoff(result.url);
                } catch (e) {
                  setHandoffError(e instanceof Error ? e.message : "Secure browser unavailable.");
                }
              }}
            >
              Get secure sign-in link
            </Button>
          )}
          {handoffError && <p className="error-text">{handoffError}</p>}
          <p className="helper-text">
            Enter passwords and verification codes directly in that browser, then confirm below.
            Codes are never saved in your answer memory.
          </p>
        </div>
      )}
      {approval.questions.map((q) => (
        <Field key={q.key} label={q.label}>
          {q.options ? (
            <select
              className="input"
              required
              value={answers[q.key] ?? ""}
              onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })}
            >
              <option value="">Choose your answer</option>
              {q.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <Input
              value={answers[q.key] ?? ""}
              onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })}
              autoComplete="off"
            />
          )}
        </Field>
      ))}
      <div className="approval-actions">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await act({
              action: "resolve_approval",
              id: approval.id,
              decision: "deny",
              answers: {},
            });
            setBusy(false);
          }}
        >
          Cancel application
        </Button>
        <Button
          disabled={busy || approval.questions.some((q) => !answers[q.key]?.trim())}
          onClick={async () => {
            setBusy(true);
            await act(
              { action: "resolve_approval", id: approval.id, decision: "approve", answers },
              approval.kind === "submission"
                ? "Approved. Your agent will continue."
                : "Answer saved. Your agent will continue.",
            );
            setBusy(false);
          }}
        >
          {busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}{" "}
          {approval.kind === "submission" ? "Approve & submit" : "Confirm & continue"}
        </Button>
      </div>
    </Card>
  );
}
function ApplicationDetail({
  application: app,
  data,
  close,
  act,
  preview,
}: {
  application: Application;
  data: Workspace;
  close: () => void;
  act: Action;
  preview: (r: GeneratedResume) => void;
}) {
  if (!app) return null;
  const resume = data.resumes.find((r) => r.id === app.resumeId),
    events = data.events.filter((e) => e.applicationId === app.id),
    pending = data.approvals.filter((a) => a.applicationId === app.id && a.status === "pending");
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        className="modal application-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Application details"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <div className="eyebrow">EVERY STEP, ACCOUNTED FOR</div>
            <h2>{app.job?.title ?? "Your application"}</h2>
            <p>
              {app.job?.company ?? "Reading job"} {app.job?.location && `· ${app.job.location}`}
            </p>
          </div>
          <button className="icon-button" onClick={close} aria-label="Close details">
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">
          <div className="flex-between">
            <Badge tone={app.receipt ? "green" : "orange"}>{statusLabel(app.status)}</Badge>
            <a className="text-link" href={app.jobUrl} target="_blank" rel="noreferrer">
              Original job
              <ArrowRight size={13} />
            </a>
          </div>
          {app.matchReasons.length > 0 && (
            <div className="detail-section">
              <h3>How this role fits</h3>
              <ul className="reason-list">
                {app.matchReasons.map((r, i) => (
                  <li key={i}>
                    <Check size={14} />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {resume && (
            <div className="detail-section">
              <h3>The exact resume</h3>
              <button className="review-resume-button" onClick={() => preview(resume)}>
                <FileText size={22} />
                <span>
                  <strong>{resume.title}</strong>
                  <small>
                    {resume.validation.pages} page ·{" "}
                    {resume.validation.valid ? "Validated" : "Needs review"}
                  </small>
                </span>
                <ArrowRight size={16} />
              </button>
            </div>
          )}
          {app.receipt && (
            <div className="receipt-box">
              <ShieldCheck size={20} />
              <div>
                <strong>Submission verified</strong>
                <p>{app.receipt.confirmation}</p>
                <small>{new Date(app.receipt.verifiedAt).toLocaleString()}</small>
                {app.receipt.screenshotKey && (
                  <a
                    className="text-link"
                    href={`/api/evidence/${app.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View portal evidence
                    <ArrowRight size={12} />
                  </a>
                )}
              </div>
            </div>
          )}
          {app.receipt && (
            <div className="detail-section">
              <Field label="Update tracked status">
                <select
                  className="input"
                  value={app.status}
                  onChange={(e) =>
                    void act(
                      { action: "application_status", id: app.id, status: e.target.value },
                      "Tracking status updated.",
                    )
                  }
                >
                  <option value="submitted">Submitted</option>
                  <option value="interview">Interview</option>
                  <option value="rejected">Rejected</option>
                  <option value="offer">Offer</option>
                  <option value="withdrawn">Withdrawn (tracking only)</option>
                </select>
              </Field>
            </div>
          )}
          {app.status === "failed" && !app.submissionStartedAt && (
            <Button
              variant="secondary"
              onClick={() =>
                void act(
                  { action: "retry_application", id: app.id },
                  "Application preparation queued for a fresh review.",
                )
              }
            >
              Retry preparation
            </Button>
          )}
          {pending.map((a) => (
            <ApprovalCard key={a.id} approval={a} act={act} data={data} preview={preview} />
          ))}
          <div className="detail-section">
            <h3>Application timeline</h3>
            <div className="timeline">
              {events.map((e) => (
                <div key={e.id}>
                  <span className="timeline-dot" />
                  <div>
                    <strong>{stageLabel(e.stage)}</strong>
                    <p>{e.message}</p>
                    <small>{new Date(e.createdAt).toLocaleString()}</small>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {Object.keys(app.preparedFields ?? app.answers).length > 0 && (
            <div className="detail-section">
              <h3>Answers provided</h3>
              {Object.entries(app.preparedFields ?? app.answers).map(([k, v]) => (
                <div className="answer-row" key={k}>
                  <span>{k.replaceAll("_", " ")}</span>
                  <strong>{v}</strong>
                </div>
              ))}
            </div>
          )}
          {app.error && <div className="error-banner">{app.error}</div>}
        </div>
      </section>
    </div>
  );
}
