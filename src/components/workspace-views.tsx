"use client";
import { useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Bell,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  Compass,
  CreditCard,
  ExternalLink,
  FileText,
  Github,
  Globe,
  Link2,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  Zap,
} from "lucide-react";
import type { Workspace } from "@/lib/workspace";
import type { GeneratedResume } from "@/lib/contracts";
import type { GithubRepo } from "@/lib/github";
import type { Action, View } from "./workspace-app";
import { date, statusLabel, trackName } from "./workspace-app";
import { Badge, Button, Card, Empty, Field, Input } from "./ui";
import { TemplateSettings } from "./template-settings";
import { TemplateAssets } from "./template-assets";

export function ResumeLibrary({
  data,
  act,
  busy,
  preview,
  refresh,
}: {
  data: Workspace;
  act: Action;
  busy: boolean;
  preview: (r: GeneratedResume) => void;
  refresh: () => Promise<void>;
}) {
  const [uploadError, setUploadError] = useState("");
  const runs = data.runs.filter(
    (r) => r.kind === "resume" && ["queued", "running"].includes(r.status),
  );
  async function upload(file: File) {
    setUploadError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", "template");
      form.append("track", "general");
      const r = await fetch("/api/import", { method: "POST", body: form });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      await act(
        { action: "save_profile", profile: data.profile },
        "Your custom template is saved.",
      );
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Template upload failed.");
    }
  }
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR STORY, WELL TOLD</div>
          <h1>Make a lasting first impression.</h1>
          <p>Beautiful LaTeX templates. Your experience, in the right light.</p>
        </div>
        <label className="button button-secondary upload-button">
          <Upload size={15} />
          Upload LaTeX template
          <input
            type="file"
            accept=".tex"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {uploadError && (
        <p role="alert" className="error-text">
          {uploadError}
        </p>
      )}
      <div className="view-intro">
        <ShieldCheck size={16} />
        <span>
          Every generated resume uses your confirmed facts, with a saved source and validation
          report.
        </span>
      </div>
      {runs.map((r) => (
        <div className="run-notice" key={r.id}>
          <LoaderCircle size={15} className="spin" />
          {r.status === "queued"
            ? "Your resume is queued for the worker."
            : "Your resume is being compiled and checked."}
        </div>
      ))}
      <div className="template-grid">
        {data.templates.map((t) => (
          <Card key={t.id} className="template-card">
            <div className="template-preview" aria-hidden="true">
              <div className="template-paper">
                <strong>{data.profile.legalName || "Your story"}</strong>
                <small>EXPERIENCE · IDEAS · POSSIBILITY</small>
                {["Education", "Experience", "Projects", "Skills"].map((s) => (
                  <div key={s}>
                    <h5>{s}</h5>
                    <div className="paper-line medium" />
                    <div className="paper-line" />
                    <div className="paper-line short" />
                  </div>
                ))}
              </div>
              {data.profile.defaultTemplate === t.id && (
                <span className="template-default">
                  <Badge tone="green">
                    <Check size={10} />
                    Your default
                  </Badge>
                </span>
              )}
            </div>
            <div className="template-info">
              <div className="flex-between">
                <strong>{t.name}</strong>
                <Badge>{t.custom ? "Custom" : "LaTeX"}</Badge>
              </div>
              <p>{t.description}</p>
              {!t.custom && (
                <TemplateSettings
                  template={t}
                  onSaved={refresh}
                  onGenerate={async () => {
                    if (
                      !(await act(
                        { action: "generate_resume", templateId: t.id, track: t.track },
                        "Your resume is queued.",
                      ))
                    )
                      throw new Error(
                        "The resume could not be queued. Review your saved profile and try again.",
                      );
                  }}
                />
              )}
              <div className="template-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy || data.profile.defaultTemplate === t.id}
                  onClick={() =>
                    void act(
                      {
                        action: "save_profile",
                        profile: {
                          ...data.profile,
                          defaultTemplate: t.id,
                          trackTemplates: { ...data.profile.trackTemplates, [t.track]: t.id },
                        },
                      },
                      `Default for ${trackName(t.track)} updated.`,
                    )
                  }
                >
                  {data.profile.defaultTemplate === t.id ? "Selected" : "Set default"}
                </Button>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      { action: "generate_resume", templateId: t.id, track: t.track },
                      "Your resume is queued.",
                    )
                  }
                >
                  <Sparkles size={12} />
                  Generate
                </Button>
              </div>
              {t.custom && <TemplateAssets template={t} onSaved={refresh} />}
            </div>
          </Card>
        ))}
      </div>
      <div className="section-heading">
        <h2>Your resume library.</h2>
        <span>
          {data.resumes.length} version{data.resumes.length === 1 ? "" : "s"}
        </span>
      </div>
      <Card>
        {data.resumes.length ? (
          data.resumes.map((r) => (
            <div key={r.id} className="resume-history-row">
              <FileText size={23} />
              <div>
                <strong>{r.title}</strong>
                <small>
                  {date(r.createdAt)} · {trackName(r.track)} · {r.validation.pages} page
                  {r.validation.pages === 1 ? "" : "s"}
                </small>
                {!r.validation.valid && (
                  <p className="error-text">{r.validation.errors.join(" ")}</p>
                )}
                {r.validation.warnings.length > 0 && (
                  <small>{r.validation.warnings.join(" ")}</small>
                )}
              </div>
              <Badge tone={r.validation.valid ? "green" : "orange"}>
                {r.validation.valid ? "Validated" : "Needs attention"}
              </Badge>
              <Button variant="secondary" size="sm" onClick={() => preview(r)}>
                Preview
                <ArrowRight size={12} />
              </Button>
            </div>
          ))
        ) : (
          <Empty icon={<FileText size={23} />} title="Your first impression starts here.">
            Add your profile, pick a template, and generate your first resume. Each version stays
            here for you.
          </Empty>
        )}
      </Card>
      <p className="helper-text">
        Custom templates use the documented placeholder contract. They compile only in an isolated
        worker. Jake’s Resume is adapted under the MIT license; source downloads preserve
        attribution.
      </p>
    </div>
  );
}

export function ApplicationList({
  data,
  openApp,
  act,
}: {
  data: Workspace;
  openApp: (id: string) => void;
  act: Action;
}) {
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all");
  const apps = data.applications.filter(
    (a) =>
      `${a.job?.company} ${a.job?.title} ${a.jobUrl}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "all" ||
        (filter === "in_progress" &&
          ["discovered", "evaluating", "resume_preparing", "ready", "applying"].includes(
            a.status,
          )) ||
        (filter === "needs_input" && ["ready", "needs_input"].includes(a.status)) ||
        a.status === filter),
  );
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ONE OPPORTUNITY AT A TIME</div>
          <h1>Every step, a little closer.</h1>
          <p>Your applications, the exact documents, and what happens next.</p>
        </div>
        <a className="button button-secondary" href="/api/export">
          <ArrowDownToLine size={15} />
          Export CSV
        </a>
      </div>
      <div className="stats-inline">
        {[
          [data.applications.length, "Total applications"],
          [data.applications.filter((a) => a.receipt).length, "Verified submissions"],
          [data.approvals.filter((a) => a.status === "pending").length, "Waiting on you"],
          [data.applications.filter((a) => a.status === "interview").length, "Interviews"],
        ].map(([n, l]) => (
          <div className="stat-item" key={l}>
            <strong>{n}</strong>
            <span>{l}</span>
          </div>
        ))}
      </div>
      <div className="toolbar">
        <label className="search-box">
          <Search size={15} />
          <input
            aria-label="Search applications"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a role or company"
          />
        </label>
        <div className="filter-chips">
          {[
            ["all", "All applications"],
            ["in_progress", "In progress"],
            ["needs_input", "Needs you"],
            ["submitted", "Submitted"],
            ["interview", "Interview"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={filter === id ? "selected" : ""}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <Card className="table-scroll">
        {apps.length ? (
          <table className="application-table">
            <thead>
              <tr>
                <th>OPPORTUNITY</th>
                <th>LOCATION</th>
                <th>STATUS</th>
                <th>ADDED</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => (
                <tr key={a.id} onClick={() => openApp(a.id)}>
                  <td>
                    <button className="application-identity" onClick={() => openApp(a.id)}>
                      <span className="company-monogram">{a.job?.company[0] ?? "↗"}</span>
                      <span>
                        <strong>{a.job?.title ?? "Reading job"}</strong>
                        <small>{a.job?.company ?? new URL(a.jobUrl).hostname}</small>
                      </span>
                    </button>
                  </td>
                  <td>{a.job?.location || "—"}</td>
                  <td>
                    <Badge tone={a.receipt ? "green" : a.status === "failed" ? "red" : "orange"}>
                      {statusLabel(a.status)}
                    </Badge>
                  </td>
                  <td>{date(a.createdAt)}</td>
                  <td>
                    <ChevronRight size={15} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty
            icon={<BriefcaseBusiness size={23} />}
            title={
              search || filter !== "all"
                ? "No matches just yet."
                : "Your next chapter is an open page."
            }
          >
            {search || filter !== "all"
              ? "Try another search or filter."
              : "Send your agent a job link. Your applications and their complete history will appear here."}
          </Empty>
        )}
      </Card>
    </div>
  );
}

export function DiscoverView({
  data,
  act,
  busy,
  go,
}: {
  data: Workspace;
  act: Action;
  busy: boolean;
  go: (v: View) => void;
}) {
  const [showAdd, setShowAdd] = useState(false),
    [name, setName] = useState(""),
    [url, setUrl] = useState(""),
    [kind, setKind] = useState("github"),
    [domains, setDomains] = useState(data.profile.autonomy.allowedDomains.join(", ")),
    [limit, setLimit] = useState(data.profile.autonomy.maxPerDay),
    [score, setScore] = useState(data.profile.autonomy.minScore),
    [consent, setConsent] = useState(false);
  async function enable() {
    await act(
      {
        action: "save_profile",
        profile: {
          ...data.profile,
          autonomy: {
            enabled: true,
            allowedDomains: domains
              .split(",")
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean),
            maxPerDay: limit,
            minScore: score,
            approvedAt: new Date().toISOString(),
          },
        },
      },
      "Standing authorization saved. Discovery is enabled.",
    );
  }
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">A LITTLE LESS SEARCHING</div>
          <h1>Let opportunity find you.</h1>
          <p>Watch trusted sources. Make thoughtful moves, within your rules.</p>
        </div>
        <Badge tone={data.profile.autonomy.enabled ? "green" : "neutral"}>
          {data.profile.autonomy.enabled ? "Discovery enabled" : "Discovery paused"}
        </Badge>
      </div>
      <Card className="discovery-banner">
        <div>
          <h3>Your direction. A little more momentum.</h3>
          <p>
            Autonomous discovery reads supported GitHub and employer feeds, verifies each job, and
            applies only within your explicit authorization.
          </p>
        </div>
        {!data.billing.discovery ? (
          <Button onClick={() => go("settings")}>
            <Zap size={15} />
            Explore Autonomous
          </Button>
        ) : data.profile.autonomy.enabled ? (
          <Button
            variant="secondary"
            onClick={() =>
              void act(
                {
                  action: "save_profile",
                  profile: {
                    ...data.profile,
                    autonomy: { ...data.profile.autonomy, enabled: false },
                  },
                },
                "Autonomous applications are paused.",
              )
            }
          >
            Pause immediately
          </Button>
        ) : (
          <Badge tone="orange">Ready to configure</Badge>
        )}
      </Card>
      <div className="section-heading">
        <h2>Your opportunity sources.</h2>
        <Button variant="secondary" size="sm" onClick={() => setShowAdd(!showAdd)}>
          <Plus size={14} />
          Add a source
        </Button>
      </div>
      {showAdd && (
        <Card className="form-card">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act({ action: "save_source", name, url, kind }, "Source saved.")) {
                setName("");
                setUrl("");
                setShowAdd(false);
              }
            }}
          >
            <div className="form-grid">
              <Field label="Source name">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Summer internship list"
                />
              </Field>
              <Field label="Source type">
                <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="github">GitHub repository / Markdown file</option>
                  <option value="greenhouse">Greenhouse board</option>
                  <option value="lever">Lever employer feed</option>
                </select>
              </Field>
            </div>
            <Field label="Source URL">
              <Input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                placeholder="https://github.com/owner/repository"
              />
            </Field>
            <Button type="submit" disabled={busy}>
              Save source
              <ArrowRight size={14} />
            </Button>
          </form>
        </Card>
      )}
      <Card>
        {data.sources.length ? (
          data.sources.map((s) => (
            <div className="source-row" key={s.id}>
              <span className="company-monogram">
                {s.kind === "github" ? <Github size={17} /> : <Globe size={17} />}
              </span>
              <div>
                <strong>{s.name}</strong>
                <small>{s.url}</small>
                <small>
                  {s.lastCheckedAt
                    ? `Last checked ${new Date(s.lastCheckedAt).toLocaleString()}`
                    : "Waiting for authorized discovery"}
                </small>
                {s.error && <p className="error-text">{s.error}</p>}
                {s.lastScan && (
                  <div className="source-lifecycle">
                    <small>
                      {s.lastScan.listed} listed · {s.lastScan.added} added · {s.lastScan.updated}{" "}
                      updated · {s.lastScan.removed} removed from source
                    </small>
                    <small>
                      {s.lastScan.verifiedOpen} employer-verified open · {s.lastScan.closed}{" "}
                      employer-verified closed · {s.lastScan.unavailable} unavailable ·{" "}
                      {s.lastScan.queued} queued
                    </small>
                    {!s.lastScan.complete && (
                      <p className="helper-text">
                        This scan reached its listing limit. Missing entries are not treated as
                        removed.
                      </p>
                    )}
                    {!!s.changes?.length && (
                      <details>
                        <summary>Recent listing changes</summary>
                        <ul>
                          {s.changes
                            .slice(-10)
                            .reverse()
                            .map((change, index) => (
                              <li key={`${change.url}:${change.observedAt}:${index}`}>
                                <span>
                                  {change.kind === "removed"
                                    ? "Removed from source"
                                    : change.kind === "closed"
                                      ? "Employer-verified closed"
                                      : change.kind.charAt(0).toUpperCase() + change.kind.slice(1)}
                                </span>
                                <a href={change.url} target="_blank" rel="noreferrer">
                                  {s.listingSnapshot?.find((listing) => listing.url === change.url)
                                    ?.title || new URL(change.url).hostname}
                                </a>
                                <small>{new Date(change.observedAt).toLocaleDateString()}</small>
                              </li>
                            ))}
                        </ul>
                      </details>
                    )}
                  </div>
                )}
              </div>
              <Badge
                tone={
                  !s.enabled
                    ? "neutral"
                    : s.health === "error"
                      ? "red"
                      : s.health === "partial"
                        ? "orange"
                        : "green"
                }
              >
                {!s.enabled
                  ? "Paused"
                  : s.health === "error"
                    ? "Needs attention"
                    : s.health === "partial"
                      ? "Partial scan"
                      : "Watching"}
              </Badge>
              <button
                className={`toggle ${s.enabled ? "on" : ""}`}
                aria-label={`${s.enabled ? "Pause" : "Enable"} ${s.name}`}
                role="switch"
                aria-checked={s.enabled}
                onClick={() => void act({ action: "toggle_source", id: s.id, enabled: !s.enabled })}
              >
                <span />
              </button>
            </div>
          ))
        ) : (
          <Empty icon={<Compass size={24} />} title="A wider view of what’s possible.">
            Add a supported repository or employer board to start building your opportunity sources.
          </Empty>
        )}
      </Card>
      <div className="section-heading">
        <h2>You set the boundaries.</h2>
        <ShieldCheck size={18} className="muted" />
      </div>
      <Card className="form-card">
        <div className="form-grid">
          <Field
            label="Allowed employer domains"
            hint="Exact domains only. For example: jobs.lever.co, job-boards.greenhouse.io"
          >
            <Input
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder="jobs.lever.co"
              disabled={!data.billing.discovery}
            />
          </Field>
          <Field label="Maximum applications per day">
            <Input
              type="number"
              min={1}
              max={20}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              disabled={!data.billing.discovery}
            />
          </Field>
          <Field label="Minimum relevance score (0–100)">
            <Input
              type="number"
              min={0}
              max={100}
              value={score}
              onChange={(e) => setScore(Number(e.target.value))}
              disabled={!data.billing.discovery}
            />
          </Field>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            disabled={!data.billing.discovery}
          />
          I authorize my agent to submit applications within these domains, limits, preferences, and
          my confirmed eligibility.
        </label>
        <Button
          disabled={!data.billing.discovery || !consent || !domains.trim() || busy}
          onClick={() => void enable()}
        >
          <Check size={15} />
          Save & enable discovery
        </Button>
        <p className="helper-text">
          Missing answers, ambiguous eligibility, login, and platform restrictions always pause
          execution. Pause discovery at any time above.
        </p>
      </Card>
    </div>
  );
}

export function IntegrationsView({
  data,
  act,
  refresh,
  go,
}: {
  data: Workspace;
  act: Action;
  refresh: () => Promise<void>;
  go: (v: View) => void;
}) {
  const [githubOpen, setGithubOpen] = useState(false),
    [username, setUsername] = useState(data.profile.github),
    [repos, setRepos] = useState<GithubRepo[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function load() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/github?username=${encodeURIComponent(username)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setRepos(d.repositories);
    } catch (e) {
      setError(e instanceof Error ? e.message : "GitHub is unavailable.");
    } finally {
      setBusy(false);
    }
  }
  async function importRepos() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositories: selected }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setNotice(
        `${d.imported} project${d.imported === 1 ? "" : "s"} imported. Review and confirm your contribution in Career Profile.`,
      );
      setSelected([]);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }
  const connected = (p: string) =>
    data.integrations.find((i) => i.provider === p && i.status === "connected");
  async function disconnect(id: string) {
    setError("");
    const r = await fetch(`/api/integrations/${id}`, { method: "DELETE" });
    const d = await r.json();
    if (!r.ok) return setError(d.error);
    setNotice(
      d.revocation === "revoked"
        ? "Disconnected. The provider authorization was revoked and the stored credential deleted."
        : d.revocation === "unsupported"
          ? "Disconnected and the stored credential deleted. Microsoft does not let apps revoke consent: remove Waypoint under your Microsoft account's app permissions."
          : "Disconnected and the stored credential deleted, but the provider could not confirm revocation. Remove Waypoint from the provider's authorized apps.",
    );
    await refresh();
  }
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">A MORE COMPLETE PICTURE</div>
          <h1>Bring your world together.</h1>
          <p>Connect the sources that help your agent understand your story.</p>
        </div>
        <Badge>
          <LockKeyhole size={10} />
          Permission comes first
        </Badge>
      </div>
      <div className="integration-grid">
        <Card className="integration-card">
          <div className="flex-between">
            <span className="integration-icon">
              <Github size={23} />
            </span>
            <Badge tone="green">Public import available</Badge>
          </div>
          <h3>GitHub</h3>
          <p>
            Choose repositories to import descriptions, languages, and READMEs. You confirm your
            individual contribution.
          </p>
          <div className="flex-between">
            <Button variant="secondary" size="sm" onClick={() => setGithubOpen(!githubOpen)}>
              Choose repositories
              <ArrowRight size={13} />
            </Button>
            {connected("github") ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void disconnect(connected("github")!.id)}
              >
                Disconnect private access
              </Button>
            ) : (
              data.capabilities.githubOAuth && (
                <a
                  className="text-link"
                  href="/api/integrations/connect?provider=github&private=true"
                >
                  Authorize private repositories
                </a>
              )
            )}
          </div>
        </Card>
        {[
          {
            id: "gmail",
            name: "Gmail",
            icon: <Mail size={23} />,
            ready: data.capabilities.gmail,
            description:
              "Read application confirmations and interview updates with your explicit authorization. Restricted-scope access requires Google approval.",
          },
          {
            id: "outlook",
            name: "Microsoft Outlook",
            icon: <span>▦</span>,
            ready: data.capabilities.outlook,
            description:
              "Connect Microsoft Graph for application correspondence. Messages are scoped to your saved applications.",
          },
        ].map((i) => (
          <Card className="integration-card" key={i.id}>
            <div className="flex-between">
              <span className="integration-icon">{i.icon}</span>
              <Badge tone={connected(i.id) ? "green" : "neutral"}>
                {connected(i.id) ? "Connected" : i.ready ? "Available" : "Configuration required"}
              </Badge>
            </div>
            <h3>{i.name}</h3>
            <p>{i.description}</p>
            <div className="flex-between">
              {connected(i.id) ? (
                <div className="inline-actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void disconnect(connected(i.id)!.id)}
                  >
                    Disconnect
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!data.billing.discovery || busy}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        const response = await fetch("/api/integrations/sync", { method: "POST" });
                        const result = await response.json();
                        if (!response.ok) throw new Error(result.error);
                        setNotice("Your correspondence check is queued for the worker.");
                        await refresh();
                      } catch (e) {
                        setError(
                          e instanceof Error ? e.message : "Correspondence check unavailable.",
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Check updates
                  </Button>
                </div>
              ) : i.ready && data.billing.discovery ? (
                <a
                  className="button button-secondary button-sm"
                  href={`/api/integrations/connect?provider=${i.id}`}
                >
                  Authorize read access
                  <ArrowRight size={13} />
                </a>
              ) : i.ready ? (
                <Button variant="secondary" size="sm" onClick={() => go("settings")}>
                  Autonomous plan required
                </Button>
              ) : (
                <Button variant="secondary" size="sm" disabled>
                  Not configured
                </Button>
              )}
              <ShieldCheck size={15} className="muted" />
            </div>
          </Card>
        ))}
        <Card className="integration-card">
          <div className="flex-between">
            <span className="integration-icon">
              <Link2 size={22} />
            </span>
            <Badge>File import available</Badge>
          </div>
          <h3>LinkedIn, Devpost & academic records</h3>
          <p>
            Add your profile links or upload exports, resumes, transcripts, and notes. Review the
            facts before they are used.
          </p>
          <Button variant="secondary" size="sm" onClick={() => go("profile")}>
            Import to your profile
            <ArrowRight size={13} />
          </Button>
        </Card>
      </div>
      {githubOpen && (
        <Card className="integration-import-panel">
          <div className="section-intro">
            <h2>Your code tells part of the story.</h2>
            <p>Choose the repositories you want to discuss in your career profile.</p>
          </div>
          <form
            className="toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              void load();
            }}
          >
            <Input
              aria-label="GitHub username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="GitHub username"
              required
              style={{ maxWidth: 330 }}
            />
            <Button type="submit" disabled={busy || !username}>
              {busy ? <LoaderCircle className="spin" size={14} /> : <Search size={14} />}Find
              repositories
            </Button>
          </form>
          {repos.length > 0 && (
            <>
              <div className="repo-list">
                {repos.map((r) => (
                  <label className="repo-row" key={r.full_name}>
                    <input
                      type="checkbox"
                      checked={selected.includes(r.full_name)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, r.full_name]
                            : selected.filter((x) => x !== r.full_name),
                        )
                      }
                    />
                    <div>
                      <strong>{r.full_name}</strong>
                      <p>{r.description}</p>
                      <small>
                        {r.language || "No primary language"} · {r.stargazers_count} stars
                        {r.fork ? " · Fork" : ""}
                      </small>
                    </div>
                  </label>
                ))}
              </div>
              <Button
                onClick={() => void importRepos()}
                disabled={busy || !selected.length || selected.length > 20}
              >
                Import {selected.length || "selected"} repositories
                <ArrowRight size={14} />
              </Button>
            </>
          )}
        </Card>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <p className="helper-text">
        Connected credentials are stored in the secrets service. You can revoke access at any time.
        Waypoint never retrieves passwords from your password manager.
      </p>
    </div>
  );
}

export function SettingsView({
  data,
  act,
  refresh,
}: {
  data: Workspace;
  act: Action;
  refresh: () => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [showAnswer, setShowAnswer] = useState(false),
    [question, setQuestion] = useState(""),
    [key, setKey] = useState("relocation"),
    [answer, setAnswer] = useState(""),
    [scope, setScope] = useState("global");
  async function billing(action: "checkout" | "portal", plan?: string) {
    setError("");
    setBusy(true);
    try {
      const r = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, plan }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      window.location.assign(d.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Billing is unavailable.");
      setBusy(false);
    }
  }
  const plans = [
    {
      id: "free",
      name: "Free",
      price: 0,
      limit: data.pricing.limits.free,
      features: ["Your career profile", "LaTeX resume templates", "Manual submission approval"],
    },
    {
      id: "pro",
      name: "Pro",
      price: data.pricing.pro,
      limit: data.pricing.limits.pro,
      features: [
        `${data.pricing.limits.pro} submissions per month`,
        "Chat agent & tracking",
        "Reusable screening answers",
      ],
    },
    {
      id: "autonomous",
      name: "Autonomous",
      price: data.pricing.autonomous,
      limit: data.pricing.limits.autonomous,
      features: [
        `${data.pricing.limits.autonomous} submissions per month`,
        "Continuous job discovery",
        "Standing authorization rules",
      ],
    },
  ];
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ON YOUR TERMS</div>
          <h1>A workspace that grows with you.</h1>
          <p>Your plan, permissions, and the details worth remembering.</p>
        </div>
        <Button
          variant="secondary"
          onClick={async () => {
            await fetch("/api/auth", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "signout" }),
            });
            window.location.assign("/");
          }}
        >
          <LogOut size={15} />
          Sign out
        </Button>
      </div>
      <Card className="settings-card">
        <div className="flex-between">
          <div>
            <h2 style={{ fontFamily: "Georgia,serif", fontSize: 23 }}>
              A little room for possibility.
            </h2>
            <p className="helper-text">
              {data.billing.used} verified submissions · {data.billing.reserved} reserved ·{" "}
              {data.billing.limit} available on your plan this month
            </p>
          </div>
          {data.billing.subscription?.customerId && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void billing("portal")}
            >
              <CreditCard size={14} />
              Manage billing
            </Button>
          )}
        </div>
        <div className="plan-grid" style={{ marginTop: 25 }}>
          {plans.map((p) => (
            <div className={`plan-card ${data.billing.plan === p.id ? "current" : ""}`} key={p.id}>
              <div>
                <h3>{p.name}</h3>
                <div className="plan-price">
                  ${p.price}
                  <small>/ month</small>
                </div>
              </div>
              <ul>
                {p.features.map((f) => (
                  <li key={f}>
                    <Check size={12} />
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                variant={data.billing.plan === p.id ? "secondary" : "default"}
                disabled={
                  busy ||
                  data.billing.plan === p.id ||
                  p.id === "free" ||
                  !data.capabilities.billing
                }
                onClick={() => void billing("checkout", p.id)}
              >
                {data.billing.plan === p.id
                  ? "Your current plan"
                  : !data.capabilities.billing
                    ? "Billing not configured"
                    : `Choose ${p.name}`}
              </Button>
            </div>
          ))}
        </div>
        <p className="helper-text">
          Monthly usage counts verified submissions. Internal failures and retries do not count as
          completed applications. Initial pricing is configurable by the operator.
        </p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </Card>
      <div className="section-heading">
        <h2>Details worth remembering.</h2>
        <Button variant="secondary" size="sm" onClick={() => setShowAnswer(!showAnswer)}>
          <Plus size={14} />
          Add an answer
        </Button>
      </div>
      <Card className="settings-card">
        <p>
          Confirmed screening answers save time. Context-sensitive questions still pause for your
          review.
        </p>
        {showAnswer && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await act(
                  {
                    action: "save_answer",
                    question,
                    key,
                    answer,
                    scope,
                    sensitive: /authorization|sponsor|salary/i.test(key),
                  },
                  "Screening answer saved.",
                )
              ) {
                setShowAnswer(false);
                setQuestion("");
                setAnswer("");
              }
            }}
          >
            <div className="form-grid">
              <Field label="Question">
                <Input
                  required
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Are you willing to relocate?"
                />
              </Field>
              <Field label="Answer category">
                <select className="input" value={key} onChange={(e) => setKey(e.target.value)}>
                  {[
                    "relocation",
                    "graduation_date",
                    "degree",
                    "gpa",
                    "work_authorization",
                    "sponsorship",
                    "salary_expectation",
                    "other",
                  ].map((k) => (
                    <option key={k} value={k}>
                      {k.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Your confirmed answer">
                <Input required value={answer} onChange={(e) => setAnswer(e.target.value)} />
              </Field>
              <Field label="Scope" hint="Use a country, employer domain, exact job URL, or global.">
                <Input required value={scope} onChange={(e) => setScope(e.target.value)} />
              </Field>
            </div>
            <Button type="submit" size="sm">
              <Check size={13} />
              Confirm & save
            </Button>
          </form>
        )}
        {data.answers.length
          ? data.answers.map((a) => (
              <div className="answer-row" key={a.id}>
                <span>
                  {a.question}
                  <small>{a.scope} · User confirmed</small>
                </span>
                <strong>{a.answer}</strong>
                <button
                  className="icon-button"
                  aria-label={`Delete answer: ${a.question}`}
                  onClick={() => void act({ action: "delete_answer", id: a.id })}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          : !showAnswer && (
              <p className="helper-text">
                Your reusable answers will appear here after you confirm them.
              </p>
            )}
      </Card>
      <Card className="settings-card">
        <h2>A clear view of your workspace.</h2>
        <p>Measured activity from your saved runs.</p>
        <div className="usage-grid">
          {[
            [data.usage.attempts, "Application attempts"],
            [`${(data.usage.browserSeconds / 60).toFixed(1)} min`, "Browser runtime"],
            [`${data.usage.inputTokens + data.usage.outputTokens}`, "Model tokens"],
            [
              data.usage.costConfigured ? `$${data.usage.costUsd.toFixed(3)}` : "Not priced",
              "Estimated execution cost",
            ],
          ].map(([v, l]) => (
            <div key={l}>
              <strong>{v}</strong>
              <span>{l}</span>
            </div>
          ))}
        </div>
        <div className="service-list">
          <span>{data.capabilities.ai ? "AI configured" : "AI not configured"}</span>
          <span>
            {data.capabilities.browserbase ? "Remote browser configured" : "Local browser"}
          </span>
          <span>{data.capabilities.billing ? "Stripe configured" : "Stripe not configured"}</span>
          <span>{data.usage.retries} internal retries</span>
        </div>
        {data.capabilities.admin && (
          <a className="text-link" style={{ marginTop: 18 }} href="/admin">
            Open operator metrics
            <ArrowRight size={13} />
          </a>
        )}
      </Card>
      <AccountControls email={data.user.email} />
    </div>
  );
}

function AccountControls({ email }: { email: string }) {
  const [confirming, setConfirming] = useState(false),
    [typed, setTyped] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const support = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  async function send(method: "POST" | "DELETE", body: object) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/account", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      return d;
    } catch (e) {
      setError(e instanceof Error ? e.message : "The request failed.");
      return null;
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="settings-card">
      <h2>Your data and account.</h2>
      <p>
        Download everything Waypoint stores about you, end sessions on other devices, or delete your
        account.
      </p>
      <div className="inline-actions" style={{ marginTop: 14 }}>
        <a className="button button-secondary button-sm" href="/api/account" download>
          <ArrowDownToLine size={14} />
          Download my data
        </a>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={async () => {
            if (await send("POST", { action: "signout-all" })) window.location.assign("/");
          }}
        >
          <LogOut size={14} />
          Sign out of all devices
        </Button>
        <Button variant="danger" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
          <Trash2 size={14} />
          Delete account
        </Button>
      </div>
      {confirming && (
        <form
          style={{ marginTop: 18 }}
          onSubmit={async (e) => {
            e.preventDefault();
            const result = await send("DELETE", { confirmEmail: typed });
            if (!result) return;
            setNotice("Your account and data were deleted.");
            window.location.assign("/");
          }}
        >
          <p className="helper-text">
            This permanently deletes your profile, resumes, applications, saved answers, evidence,
            and connected-account authorizations. Applications already sent to employers cannot be
            withdrawn by Waypoint. Cancel any paid subscription in billing first. Download your data
            now if you want a copy.
          </p>
          <Field label={`Type ${email} to confirm`}>
            <Input
              required
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </Field>
          <div className="inline-actions">
            <Button
              type="submit"
              variant="danger"
              size="sm"
              disabled={busy || typed.trim().toLowerCase() !== email.toLowerCase()}
            >
              Permanently delete my account
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Keep my account
            </Button>
          </div>
        </form>
      )}
      {support && (
        <p className="helper-text">
          Questions about your data? Contact <a href={`mailto:${support}`}>{support}</a>.
        </p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
    </Card>
  );
}
