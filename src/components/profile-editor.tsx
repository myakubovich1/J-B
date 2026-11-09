"use client";
import { useState } from "react";
import {
  Check,
  FileText,
  GraduationCap,
  History,
  Link2,
  LoaderCircle,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { Workspace } from "@/lib/workspace";
import type { CandidateProfile, Claim, Source } from "@/lib/contracts";
import type { Action } from "./workspace-app";
import { trackName } from "./workspace-app";
import { Badge, Button, Card, Field, Input } from "./ui";
import { ImportRecordReview } from "./import-record-review";
import { addReviewedImport } from "@/lib/import-draft";
const newId = () => crypto.randomUUID();
export function ProfileEditor({
  data,
  act,
  refresh,
  busy,
}: {
  data: Workspace;
  act: Action;
  refresh: () => Promise<void>;
  busy: boolean;
}) {
  const [profile, setProfile] = useState<CandidateProfile>(data.profile),
    [tab, setTab] = useState(0),
    [dirty, setDirty] = useState(false),
    [importBusy, setImportBusy] = useState(false),
    [importError, setImportError] = useState(""),
    [source, setSource] = useState<Source | null>(null),
    [fact, setFact] = useState(""),
    [savedSources, setSavedSources] = useState<Source[] | null>(null),
    [history, setHistory] = useState<{ id: string; version: number; updatedAt: string }[] | null>(
      null,
    );
  const patch = (next: Partial<CandidateProfile>) => {
    setProfile((p) => ({ ...p, ...next }));
    setDirty(true);
  };
  async function save() {
    const next = { ...profile, onboardingStep: Math.max(profile.onboardingStep, tab + 1) };
    if (await act({ action: "save_profile", profile: next }, "Your profile is saved."))
      setDirty(false);
  }
  async function upload(file: File) {
    setImportBusy(true);
    setImportError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch("/api/import", { method: "POST", body: form });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setSource(d.source);
      await refresh();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setImportBusy(false);
    }
  }
  async function showSources() {
    const r = await fetch("/api/profile");
    const d = await r.json();
    if (r.ok) setSavedSources(d.sources);
  }
  async function reviewSource(selected: Source) {
    setSavedSources(null);
    setImportError("");
    setSource(selected);
    if (
      (selected.status === "ready" || !selected.status) &&
      !selected.structured &&
      /\.(csv|json)$/i.test(selected.name)
    ) {
      try {
        const response = await fetch("/api/profile/suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceId: selected.id }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to extract profile records.");
        setSource(result.source);
      } catch (reason) {
        setImportError(reason instanceof Error ? reason.message : "Unable to review records.");
      }
    }
  }
  async function showHistory() {
    const r = await fetch("/api/profile");
    const d = await r.json();
    if (r.ok)
      setHistory(
        d.versions.sort((a: { version: number }, b: { version: number }) => b.version - a.version),
      );
  }
  return (
    <div className="page-content profile-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">CAREER PROFILE</div>
          <h1>Your career profile</h1>
          <p>A clear picture of you makes every next step more personal.</p>
        </div>
        <div className="heading-actions">
          <Button variant="secondary" onClick={() => void showSources()}>
            <FileText size={16} />
            Saved sources
          </Button>
          <Button variant="secondary" onClick={() => void showHistory()}>
            <History size={16} />
            History
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            <Save size={16} />
            {busy ? "Saving…" : "Save profile"}
          </Button>
        </div>
      </div>
      <div className="profile-overview">
        <span className="profile-overview-avatar">{profile.legalName.slice(0, 1) || "Y"}</span>
        <div>
          <h2>{profile.legalName || "Let’s start with you."}</h2>
          <p>
            {profile.headline || "The confirmed facts J*B uses in every resume and application."}
          </p>
        </div>
        <Badge tone={dirty ? "orange" : "green"}>
          {dirty
            ? "Unsaved changes"
            : data.profileVersion
              ? `Saved · version ${data.profileVersion}`
              : "Getting started"}
        </Badge>
      </div>
      <div className="tabs" role="tablist" aria-label="Profile sections">
        {["About you", "Education & experience", "Projects & strengths", "Your preferences"].map(
          (t, i) => (
            <button
              role="tab"
              aria-selected={tab === i}
              key={t}
              onClick={() => setTab(i)}
              className={tab === i ? "tab-active" : ""}
            >
              <span className="tab-number">0{i + 1}</span>
              {t}
            </button>
          ),
        )}
      </div>
      <div className="profile-form-grid">
        <div className="profile-form-main">
          {tab === 0 && (
            <Card className="form-card">
              <div className="section-intro">
                <h2>Basics</h2>
                <p>The basics, so every application starts with the right details.</p>
              </div>
              <div className="form-grid">
                <Field label="Legal name">
                  <Input
                    value={profile.legalName}
                    onChange={(e) => patch({ legalName: e.target.value })}
                    autoComplete="name"
                    placeholder="Your full legal name"
                  />
                </Field>
                <Field label="Preferred name">
                  <Input
                    value={profile.preferredName}
                    onChange={(e) => patch({ preferredName: e.target.value })}
                    placeholder="What should we call you?"
                  />
                </Field>
                <Field label="Email">
                  <Input
                    type="email"
                    value={profile.email}
                    onChange={(e) => patch({ email: e.target.value })}
                  />
                </Field>
                <Field label="Phone">
                  <Input
                    type="tel"
                    value={profile.phone}
                    onChange={(e) => patch({ phone: e.target.value })}
                    placeholder="+1 555 010 0123"
                  />
                </Field>
                <Field label="Location">
                  <Input
                    value={profile.location}
                    onChange={(e) => patch({ location: e.target.value })}
                    placeholder="City, state, country"
                  />
                </Field>
                <Field label="Professional headline">
                  <Input
                    value={profile.headline}
                    onChange={(e) => patch({ headline: e.target.value })}
                    placeholder="Computer science student · Building useful things"
                  />
                </Field>
                <Field label="Personal website">
                  <Input
                    value={profile.website}
                    onChange={(e) => patch({ website: e.target.value })}
                    placeholder="https://your.site"
                  />
                </Field>
                <Field label="LinkedIn profile">
                  <Input
                    value={profile.linkedin}
                    onChange={(e) => patch({ linkedin: e.target.value })}
                    placeholder="https://linkedin.com/in/you"
                  />
                </Field>
                <Field label="GitHub username">
                  <Input
                    value={profile.github}
                    onChange={(e) => patch({ github: e.target.value })}
                    placeholder="your-username"
                  />
                </Field>
                <Field label="Devpost profile">
                  <Input
                    value={profile.devpost}
                    onChange={(e) => patch({ devpost: e.target.value })}
                    placeholder="https://devpost.com/you"
                  />
                </Field>
              </div>
            </Card>
          )}
          {tab === 1 && (
            <>
              <Card className="form-card">
                <div className="section-intro flex-between">
                  <div>
                    <h2>Education</h2>
                    <p>Where you’ve learned, and where you’re headed.</p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      patch({
                        education: [
                          ...profile.education,
                          {
                            id: newId(),
                            school: "",
                            degree: "",
                            major: "",
                            startDate: "",
                            endDate: "",
                          },
                        ],
                      })
                    }
                  >
                    <Plus size={14} />
                    Add education
                  </Button>
                </div>
                {profile.education.length === 0 && (
                  <p className="inline-empty">Add your school, degree, and expected graduation.</p>
                )}
                {profile.education.map((e, i) => (
                  <div className="entry-form" key={e.id}>
                    <div className="flex-between">
                      <strong>Education {i + 1}</strong>
                      <button
                        className="icon-button"
                        aria-label="Remove education"
                        onClick={() =>
                          patch({ education: profile.education.filter((x) => x.id !== e.id) })
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <div className="form-grid">
                      {(
                        [
                          ["school", "School or university"],
                          ["degree", "Degree"],
                          ["major", "Major / field"],
                          ["gpa", "GPA (optional)"],
                          ["startDate", "Start date"],
                          ["endDate", "Graduation / expected date"],
                        ] as const
                      ).map(([k, label]) => (
                        <Field key={k} label={label}>
                          <Input
                            value={e[k] ?? ""}
                            onChange={(ev) =>
                              patch({
                                education: profile.education.map((x) =>
                                  x.id === e.id ? { ...x, [k]: ev.target.value } : x,
                                ),
                              })
                            }
                            placeholder={k.includes("Date") ? "Month Year" : undefined}
                          />
                        </Field>
                      ))}
                    </div>
                    <Field label="Relevant coursework or academic achievements">
                      <Input
                        value={e.coursework ?? ""}
                        onChange={(ev) =>
                          patch({
                            education: profile.education.map((x) =>
                              x.id === e.id ? { ...x, coursework: ev.target.value } : x,
                            ),
                          })
                        }
                      />
                    </Field>
                  </div>
                ))}
              </Card>
              <Card className="form-card">
                <div className="section-intro flex-between">
                  <div>
                    <h2>Experience</h2>
                    <p>Work, internships, research, leadership, and volunteering.</p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      patch({
                        experiences: [
                          ...profile.experiences,
                          {
                            id: newId(),
                            company: "",
                            title: "",
                            location: "",
                            startDate: "",
                            endDate: "",
                            bullets: [],
                            confirmed: false,
                          },
                        ],
                      })
                    }
                  >
                    <Plus size={14} />
                    Add experience
                  </Button>
                </div>
                {!profile.experiences.length && (
                  <p className="inline-empty">
                    Great experience comes in many forms. Tell us about yours.
                  </p>
                )}
                {profile.experiences.map((e, i) => (
                  <div className="entry-form" key={e.id}>
                    <div className="flex-between">
                      <strong>Experience {i + 1}</strong>
                      <button
                        className="icon-button"
                        aria-label="Remove experience"
                        onClick={() =>
                          patch({ experiences: profile.experiences.filter((x) => x.id !== e.id) })
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <div className="form-grid">
                      {(
                        [
                          ["company", "Organization"],
                          ["title", "Role"],
                          ["location", "Location"],
                          ["startDate", "Start date"],
                          ["endDate", "End date (or Present)"],
                        ] as const
                      ).map(([k, label]) => (
                        <Field key={k} label={label}>
                          <Input
                            value={e[k]}
                            onChange={(ev) =>
                              patch({
                                experiences: profile.experiences.map((x) =>
                                  x.id === e.id ? { ...x, [k]: ev.target.value } : x,
                                ),
                              })
                            }
                          />
                        </Field>
                      ))}
                    </div>
                    <Field
                      label="What did you accomplish?"
                      hint="One accomplishment per line. Include numbers only when you can support them."
                    >
                      <textarea
                        className="input"
                        rows={4}
                        value={e.bullets.join("\n")}
                        onChange={(ev) =>
                          patch({
                            experiences: profile.experiences.map((x) =>
                              x.id === e.id ? { ...x, bullets: ev.target.value.split("\n") } : x,
                            ),
                          })
                        }
                      />
                    </Field>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={e.confirmed}
                        onChange={(ev) =>
                          patch({
                            experiences: profile.experiences.map((x) =>
                              x.id === e.id ? { ...x, confirmed: ev.target.checked } : x,
                            ),
                          })
                        }
                      />
                      I confirm these details and accomplishments are accurate.
                    </label>
                  </div>
                ))}
              </Card>
            </>
          )}
          {tab === 2 && (
            <>
              <Card className="form-card">
                <div className="section-intro flex-between">
                  <div>
                    <h2>Projects</h2>
                    <p>Projects that show your contribution and initiative.</p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      patch({
                        projects: [
                          ...profile.projects,
                          {
                            id: newId(),
                            name: "",
                            description: "",
                            technologies: [],
                            url: "",
                            contribution: "",
                            confirmed: false,
                          },
                        ],
                      })
                    }
                  >
                    <Plus size={14} />
                    Add project
                  </Button>
                </div>
                {!profile.projects.length && (
                  <p className="inline-empty">
                    Add a project here, or import selected repositories from Integrations.
                  </p>
                )}
                {profile.projects.map((p) => (
                  <div className="entry-form" key={p.id}>
                    <div className="flex-between">
                      <strong>{p.name || "New project"}</strong>
                      <div className="inline-actions">
                        <Badge tone={p.confirmed ? "green" : "orange"}>
                          {p.confirmed ? "Confirmed" : "Review required"}
                        </Badge>
                        <button
                          className="icon-button"
                          aria-label="Remove project"
                          onClick={() =>
                            patch({ projects: profile.projects.filter((x) => x.id !== p.id) })
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    <div className="form-grid">
                      <Field label="Project name">
                        <Input
                          value={p.name}
                          onChange={(e) =>
                            patch({
                              projects: profile.projects.map((x) =>
                                x.id === p.id ? { ...x, name: e.target.value } : x,
                              ),
                            })
                          }
                        />
                      </Field>
                      <Field label="Repository or demo URL">
                        <Input
                          value={p.url}
                          onChange={(e) =>
                            patch({
                              projects: profile.projects.map((x) =>
                                x.id === p.id ? { ...x, url: e.target.value } : x,
                              ),
                            })
                          }
                        />
                      </Field>
                    </div>
                    <Field label="What is it?">
                      <textarea
                        className="input"
                        rows={2}
                        value={p.description}
                        onChange={(e) =>
                          patch({
                            projects: profile.projects.map((x) =>
                              x.id === p.id ? { ...x, description: e.target.value } : x,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field
                      label="Your individual contribution"
                      hint="A repository’s existence doesn’t establish your role. Describe what you personally did."
                    >
                      <textarea
                        className="input"
                        rows={2}
                        value={p.contribution}
                        onChange={(e) =>
                          patch({
                            projects: profile.projects.map((x) =>
                              x.id === p.id ? { ...x, contribution: e.target.value } : x,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="Technologies (comma separated)">
                      <Input
                        value={p.technologies.join(", ")}
                        onChange={(e) =>
                          patch({
                            projects: profile.projects.map((x) =>
                              x.id === p.id
                                ? {
                                    ...x,
                                    technologies: e.target.value.split(",").map((t) => t.trim()),
                                  }
                                : x,
                            ),
                          })
                        }
                      />
                    </Field>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={p.confirmed}
                        onChange={(e) =>
                          patch({
                            projects: profile.projects.map((x) =>
                              x.id === p.id ? { ...x, confirmed: e.target.checked } : x,
                            ),
                          })
                        }
                      />
                      I confirm the description and my contribution.
                    </label>
                  </div>
                ))}
              </Card>
              <Card className="form-card">
                <div className="section-intro">
                  <h2>Skills</h2>
                  <p>Skills you’re comfortable representing in an application.</p>
                </div>
                <Field label="Skills (comma separated)">
                  <textarea
                    className="input"
                    rows={3}
                    value={profile.skills.join(", ")}
                    onChange={(e) =>
                      patch({ skills: e.target.value.split(",").map((t) => t.trim()) })
                    }
                    placeholder="TypeScript, Python, SQL, Research, Financial modeling"
                  />
                </Field>
              </Card>
              <Card className="form-card">
                <div className="section-intro">
                  <h2>Evidence bank</h2>
                  <p>Imported claims become usable after you review and confirm them.</p>
                </div>
                {!profile.claims.filter((c) => !c.id.startsWith("profile:")).length && (
                  <p className="inline-empty">
                    Import a document and save a fact to start your evidence bank.
                  </p>
                )}
                {profile.claims
                  .filter((c) => !c.id.startsWith("profile:"))
                  .map((c) => (
                    <div className="claim-row" key={c.id}>
                      <div className="flex-between">
                        <Badge tone={c.confirmed ? "green" : "orange"}>
                          {c.confirmed
                            ? "User confirmed"
                            : c.verification === "suggestion"
                              ? "AI suggestion"
                              : "Unconfirmed import"}
                        </Badge>
                        <button
                          className="icon-button"
                          aria-label="Delete claim"
                          onClick={() =>
                            patch({ claims: profile.claims.filter((x) => x.id !== c.id) })
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <p>{c.text}</p>
                      <small>Source: {c.source}</small>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={c.confirmed}
                          onChange={(e) =>
                            patch({
                              claims: profile.claims.map((x) =>
                                x.id === c.id
                                  ? {
                                      ...x,
                                      confirmed: e.target.checked,
                                      verification: e.target.checked
                                        ? "user_confirmed"
                                        : "imported",
                                      updatedAt: new Date().toISOString(),
                                    }
                                  : x,
                              ),
                            })
                          }
                        />
                        I’ve reviewed and confirm this fact.
                      </label>
                    </div>
                  ))}
              </Card>
            </>
          )}
          {tab === 3 && (
            <>
              <Card className="form-card">
                <div className="section-intro">
                  <h2>Job preferences</h2>
                  <p>Tell J*B which roles, locations, and tracks to focus on.</p>
                </div>
                <Field label="Career directions">
                  <div className="choice-grid">
                    {["software", "finance", "consulting", "product", "general"].map((t) => (
                      <label className="checkbox-label choice" key={t}>
                        <input
                          type="checkbox"
                          checked={profile.preferences.tracks.includes(
                            t as (typeof profile.preferences.tracks)[number],
                          )}
                          onChange={(e) =>
                            patch({
                              preferences: {
                                ...profile.preferences,
                                tracks: e.target.checked
                                  ? [
                                      ...profile.preferences.tracks,
                                      t as (typeof profile.preferences.tracks)[number],
                                    ]
                                  : profile.preferences.tracks.filter((x) => x !== t),
                              },
                            })
                          }
                        />
                        {trackName(t)}
                      </label>
                    ))}
                  </div>
                </Field>
                <div className="form-grid">
                  <Field label="Target titles (comma separated)">
                    <Input
                      value={profile.preferences.titles.join(", ")}
                      onChange={(e) =>
                        patch({
                          preferences: {
                            ...profile.preferences,
                            titles: e.target.value.split(",").map((t) => t.trim()),
                          },
                        })
                      }
                      placeholder="Software engineer, Research intern"
                    />
                  </Field>
                  <Field label="Preferred locations (comma separated)">
                    <Input
                      value={profile.preferences.locations.join(", ")}
                      onChange={(e) =>
                        patch({
                          preferences: {
                            ...profile.preferences,
                            locations: e.target.value.split(",").map((t) => t.trim()),
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="Workplace">
                    <select
                      className="input"
                      value={profile.preferences.workplace}
                      onChange={(e) =>
                        patch({
                          preferences: {
                            ...profile.preferences,
                            workplace: e.target.value as typeof profile.preferences.workplace,
                          },
                        })
                      }
                    >
                      {["any", "remote", "hybrid", "onsite"].map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Employment type">
                    <select
                      className="input"
                      value={profile.preferences.employment}
                      onChange={(e) =>
                        patch({
                          preferences: {
                            ...profile.preferences,
                            employment: e.target.value as typeof profile.preferences.employment,
                          },
                        })
                      }
                    >
                      {["any", "internship", "fulltime", "parttime", "contract"].map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Internship season">
                    <Input
                      value={profile.preferences.season}
                      onChange={(e) =>
                        patch({ preferences: { ...profile.preferences, season: e.target.value } })
                      }
                      placeholder="Summer 2027"
                    />
                  </Field>
                  <Field label="Minimum annual compensation (optional)">
                    <Input
                      type="number"
                      min={0}
                      value={profile.preferences.minSalary ?? ""}
                      onChange={(e) =>
                        patch({
                          preferences: {
                            ...profile.preferences,
                            minSalary: e.target.value ? Number(e.target.value) : null,
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="Target companies (comma separated)">
                    <Input
                      value={profile.preferences.targetCompanies.join(", ")}
                      onChange={(e) =>
                        patch({
                          preferences: {
                            ...profile.preferences,
                            targetCompanies: e.target.value.split(",").map((t) => t.trim()),
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="Excluded companies (comma separated)">
                    <Input
                      value={profile.preferences.excludedCompanies.join(", ")}
                      onChange={(e) =>
                        patch({
                          preferences: {
                            ...profile.preferences,
                            excludedCompanies: e.target.value.split(",").map((t) => t.trim()),
                          },
                        })
                      }
                    />
                  </Field>
                </div>
              </Card>
              <Card className="form-card">
                <div className="section-intro">
                  <h2>Work eligibility</h2>
                  <p>Eligibility is always based on your confirmation, never assumptions.</p>
                </div>
                <Field label="Country these answers apply to">
                  <Input
                    value={profile.eligibility.country}
                    onChange={(e) =>
                      patch({
                        eligibility: {
                          ...profile.eligibility,
                          country: e.target.value,
                          confirmedAt: null,
                        },
                      })
                    }
                    placeholder="United States"
                  />
                </Field>
                <div className="form-grid">
                  {(
                    [
                      [
                        "workAuthorization",
                        "Are you currently authorized to work in this country?",
                      ],
                      ["sponsorship", "Will you require employer sponsorship?"],
                    ] as const
                  ).map(([k, label]) => (
                    <Field key={k} label={label}>
                      <select
                        className="input"
                        value={profile.eligibility[k]}
                        onChange={(e) =>
                          patch({
                            eligibility: {
                              ...profile.eligibility,
                              [k]: e.target.value,
                              confirmedAt: null,
                            },
                          })
                        }
                      >
                        <option value="unknown">I need to clarify this</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </Field>
                  ))}
                </div>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={Boolean(profile.eligibility.confirmedAt)}
                    onChange={(e) =>
                      patch({
                        eligibility: {
                          ...profile.eligibility,
                          confirmedAt: e.target.checked ? new Date().toISOString() : null,
                        },
                      })
                    }
                  />
                  I confirm these answers for the country above.
                </label>
              </Card>
            </>
          )}
          <div className="profile-save-bar">
            <span>
              {dirty ? "You have unsaved changes." : "You can come back and add more any time."}
            </span>
            <Button onClick={() => void save()} disabled={busy}>
              <Save size={15} />
              Save & continue
            </Button>
          </div>
        </div>
        <aside className="profile-form-aside">
          <Card className="import-card">
            <span className="starter-icon peach">
              <Upload size={21} />
            </span>
            <h3>Already have a starting point?</h3>
            <p>
              Import a resume, LinkedIn export, transcript, or project notes. Review the extracted
              text before adding facts.
            </p>
            <label className="button button-secondary upload-button">
              {importBusy ? <LoaderCircle className="spin" size={15} /> : <FileText size={15} />}
              Import a document
              <input
                type="file"
                accept=".pdf,.txt,.md,.json,.tex,.csv"
                disabled={importBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                  e.target.value = "";
                }}
              />
            </label>
            <small>PDF, TXT, MD, JSON, CSV, or TeX · up to 5 MB</small>
            {importError && <p className="error-text">{importError}</p>}
          </Card>
          <div className="profile-writing-tip">
            <span className="eyebrow">MAKE IT YOURS</span>
            <h3>Specific beats impressive.</h3>
            <p>
              “Built a scheduling tool for 12 volunteers” says more than “demonstrated exceptional
              leadership.”
            </p>
            <div>
              <ShieldCheck size={16} />
              Only the facts you confirm make it into your resume.
            </div>
          </div>
        </aside>
      </div>
      {source && (
        <div className="modal-backdrop">
          <section
            className="modal import-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Review imported document"
          >
            <div className="modal-header">
              <div>
                <div className="eyebrow">REVIEW YOUR SOURCE</div>
                <h2>{source.name}</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close import"
                onClick={() => setSource(null)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              {importError && (
                <p role="alert" className="error-text">
                  {importError}
                </p>
              )}
              <p className="muted">
                The text below is an imported source. Add only the statements you can confirm.
              </p>
              {source.status === "queued" ? (
                <p className="notice">
                  Your document is queued for extraction. Open Saved sources after the worker
                  finishes.
                </p>
              ) : source.status === "failed" ? (
                <p className="error-text">{source.error}</p>
              ) : (
                <>
                  {source.structured && (
                    <ImportRecordReview
                      key={source.id}
                      source={source}
                      profile={profile}
                      onApply={(records) => patch(addReviewedImport(profile, source, records))}
                    />
                  )}
                  <details className="import-source-text">
                    <summary>Read the source text</summary>
                    <pre className="source-text">{source.text}</pre>
                  </details>
                </>
              )}
              <Field label="A fact or accomplishment to keep">
                <textarea
                  className="input"
                  value={fact}
                  onChange={(e) => setFact(e.target.value)}
                  rows={3}
                  placeholder="Paste or write one statement from this document."
                />
              </Field>
              <Button
                disabled={!fact.trim()}
                onClick={() => {
                  const claim: Claim = {
                    id: newId(),
                    type: "achievement",
                    text: fact.trim(),
                    source: source.name,
                    sourceUrl: source.url ?? undefined,
                    verification: "imported",
                    confirmed: false,
                    updatedAt: new Date().toISOString(),
                    track: profile.preferences.tracks[0] ?? "general",
                  };
                  patch({ claims: [...profile.claims, claim] });
                  setFact("");
                  setTab(2);
                }}
              >
                Add to evidence bank
              </Button>
              <p className="helper-text">
                Confirm the fact in Projects & strengths, then save your profile.
              </p>
            </div>
          </section>
        </div>
      )}
      {savedSources && (
        <div className="modal-backdrop" onClick={() => setSavedSources(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Saved sources"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>Imported sources</h2>
              <button
                className="icon-button"
                aria-label="Close sources"
                onClick={() => setSavedSources(null)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              {savedSources.length ? (
                savedSources.map((s) => (
                  <div key={s.id} className="history-row">
                    <div>
                      <strong>{s.name}</strong>
                      <small>
                        {s.status ?? "ready"} · Imported{" "}
                        {new Date(s.importedAt).toLocaleDateString()}
                      </small>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        void reviewSource(s);
                      }}
                    >
                      Review
                    </Button>
                  </div>
                ))
              ) : (
                <p className="muted">
                  Imported files and connected project sources will appear here.
                </p>
              )}
            </div>
          </section>
        </div>
      )}
      {history && (
        <div className="modal-backdrop" onClick={() => setHistory(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Profile history"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>Version history</h2>
              <button
                className="icon-button"
                aria-label="Close history"
                onClick={() => setHistory(null)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              {history.length ? (
                history.map((v) => (
                  <div key={v.id} className="history-row">
                    <div>
                      <strong>Version {v.version}</strong>
                      <small>{new Date(v.updatedAt).toLocaleString()}</small>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={async () => {
                        if (
                          await act(
                            { action: "restore_profile", id: v.id },
                            "Previous profile version restored.",
                          )
                        )
                          setHistory(null);
                      }}
                    >
                      Restore
                    </Button>
                  </div>
                ))
              ) : (
                <p className="muted">
                  Your previous profile versions will appear here after your next save.
                </p>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
