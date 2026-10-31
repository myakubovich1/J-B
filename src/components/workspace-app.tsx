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
  CircleHelp,
  Compass,
  FileText,
  Github,
  LayoutGrid,
  Link2,
  LoaderCircle,
  LogOut,
  Menu,
  MessageSquare,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
  Zap,
} from "lucide-react";
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
const nav: [View, string, typeof Compass][] = [
  ["agent", "Agent", Sparkles],
  ["profile", "Career Profile", UserRound],
  ["resumes", "Resumes", FileText],
  ["applications", "Applications", BriefcaseBusiness],
  ["discover", "Discover", Compass],
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
    tailoring: "Tailoring your story",
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
        <a href="#agent" onClick={() => go("agent")} className="brand">
          <span className="brand-icon">
            <Compass size={22} />
          </span>
          waypoint<span className="brand-period">.</span>
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
                <Compass size={16} />
              </span>
              <small>{complete}/5 complete</small>
            </div>
            <h4>Your story starts here</h4>
            <p>
              A little more about you.
              <br />A much better next move.
            </p>
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
            <ResumeLibrary data={data} act={act} busy={busy} preview={setPreview} />
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
            Your story. Your data. Your decision.
          </span>
          <span>
            Made for what’s next<span className="footer-star">✳</span>
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
                <div className="eyebrow">YOUR STORY, ON PAPER</div>
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
  const inMotion = data.applications.filter(
    (a) => !["withdrawn", "rejected", "offer", "failed"].includes(a.status),
  );
  const pending = data.approvals.filter((a) => a.status === "pending");
  return (
    <div className="agent-layout">
      <section className="agent-conversation">
        <div className="agent-heading">
          <div>
            <div className="eyebrow">
              <span className="tiny-line" />
              YOUR PERSONAL CAREER AGENT
            </div>
            <h1>
              A little direction.
              <br />
              <span>A world of possibility.</span>
            </h1>
          </div>
          <div className="agent-status">
            <span className="status-dot" />
            Ready when you are
          </div>
        </div>
        {data.messages.length === 0 ? (
          <div className="agent-welcome">
            <div className="greeting">
              <span className="agent-avatar">
                <Sparkles size={19} />
              </span>
              <div>
                <h3>Hey {name}, let’s make your next move.</h3>
                <p>
                  Bring your experience. I’ll help you find the words,
                  <br className="desktop-break" /> prepare your resume, and take the next step.
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
                  <BriefcaseBusiness size={20} />
                </span>
                <h3>Have a role in mind?</h3>
                <p>
                  Drop in a job link. Let’s see
                  <br />
                  where it could take you.
                </p>
                <ArrowRight size={18} />
              </button>
              <button className="starter-card" onClick={() => go("profile")}>
                <span className="starter-icon sage">
                  <UserRound size={20} />
                </span>
                <h3>First, a little about you.</h3>
                <p>
                  Build your career profile.
                  <br />
                  Make every application count.
                </p>
                <ArrowRight size={18} />
              </button>
              <button className="starter-card" onClick={() => go("resumes")}>
                <span className="starter-icon lavender">
                  <FileText size={20} />
                </span>
                <h3>Your story, well told.</h3>
                <p>
                  Choose a LaTeX template.
                  <br />
                  Put your best work on paper.
                </p>
                <ArrowRight size={18} />
              </button>
            </div>
            <div className="agent-note">
              <ShieldCheck size={16} />
              <span>I use the facts you confirm. You stay in control of every application.</span>
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
                  {m.role === "user" ? name.slice(0, 1) : <Sparkles size={17} />}
                </span>
                <div>
                  <div className="message-author">
                    {m.role === "user" ? "You" : "Waypoint"}
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
                placeholder="Paste a job link. Let’s take it from here."
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
                <Sparkles size={12} />A thoughtful next step
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
      <aside className="agent-context">
        <div className="context-title">
          A CLEARER PICTURE
          <span className="context-line" />
        </div>
        <Card className="profile-context">
          <div className="profile-context-art" aria-hidden="true">
            <div className="profile-art-ring" />
            <span className="profile-art-orbit" />
            <span className="profile-art-letter">{name[0]?.toUpperCase()}</span>
            <span className="profile-art-spark">✳</span>
          </div>
          <div className="flex-between">
            <span className="eyebrow">YOUR CAREER PROFILE</span>
            <span className="mini-status">
              {data.profileVersion ? "In progress" : "Let’s begin"}
            </span>
          </div>
          <h3>{data.profile.legalName || "Uniquely you."}</h3>
          <p>
            {data.profile.headline ||
              "Your experience, strengths, and ambitions. All in one place."}
          </p>
          <div className="profile-detail-row">
            <span>Career direction</span>
            <strong>{trackName(data.profile.preferences.tracks[0] ?? "general")}</strong>
          </div>
          <button className="text-link" onClick={() => go("profile")}>
            {data.profileVersion ? "Keep your profile current" : "Tell your story"}
            <ArrowRight size={14} />
          </button>
        </Card>
        <div className="context-heading">
          <h3>Your next moves</h3>
          <span>{inMotion.length}</span>
        </div>
        {inMotion.length ? (
          <div className="next-moves">
            {inMotion.slice(0, 3).map((a) => (
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
        ) : (
          <div className="next-move-empty">
            <span className="dotted-route">
              <i />
              <span />
              <i />
            </span>
            <h4>Something good is on its way.</h4>
            <p>
              Your applications and next steps
              <br />
              will find a home right here.
            </p>
          </div>
        )}
        <div className="quiet-tip">
          <span className="eyebrow">A SMALL REMINDER</span>
          <p>“You don’t have to see the whole staircase. Just take the first step.”</p>
          <span>One opportunity at a time.</span>
        </div>
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
            Room for a bigger next chapter
            <ArrowRight size={12} />
          </button>
        </div>
      </aside>
    </div>
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
