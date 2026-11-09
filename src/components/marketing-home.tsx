import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  BriefcaseBusiness,
  Check,
  CircleCheck,
  FileText,
  Github,
  KeyRound,
  Link2,
  ListChecks,
  LoaderCircle,
  MessageSquare,
  Radar,
  ScanSearch,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { planLimits } from "@/lib/billing";
import { builtInTemplates } from "@/lib/resume";
import { Asterisk, Logo } from "./brand";
import "@/app/marketing.css";

const trackLabel: Record<string, string> = {
  software: "Software",
  finance: "Finance",
  consulting: "Consulting",
  product: "Product",
  general: "General",
};

export function MarketingHome() {
  const limits = planLimits();
  const pro = Number(process.env.PLAN_PRO_MONTHLY_USD || 39);
  const autonomous = Number(process.env.PLAN_AUTONOMOUS_MONTHLY_USD || 199);
  const plans = [
    {
      name: "Free",
      price: 0,
      blurb: "Build your profile and try the agent.",
      features: [
        `${limits.free} verified submissions / month`,
        "Career profile & GitHub import",
        "All LaTeX templates, PDF & .tex export",
        "Approve every submission",
      ],
    },
    {
      name: "Pro",
      price: pro,
      blurb: "For an active search.",
      featured: true,
      features: [
        `${limits.pro} verified submissions / month`,
        "Chat agent with job-specific tailoring",
        "Reusable confirmed screening answers",
        "Application tracking & CSV export",
      ],
    },
    {
      name: "Autonomous",
      price: autonomous,
      blurb: "Let opportunities come to you.",
      features: [
        `${limits.autonomous} verified submissions / month`,
        "Internship & ATS feed monitoring",
        "Standing rules you define and can pause",
        "Gmail & Outlook application updates",
      ],
    },
  ];
  return (
    <div className="mk">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="mk-nav">
        <div className="mk-container mk-nav-inner">
          <Link href="/" aria-label="J*B home">
            <Logo size={26} />
          </Link>
          <nav aria-label="Marketing" className="mk-nav-links">
            <a href="#how">How it works</a>
            <a href="#resumes">Resumes</a>
            <a href="#control">Control</a>
            <a href="#pricing">Pricing</a>
          </nav>
          <div className="mk-nav-actions">
            <Link href="/signin" className="mk-link">
              Sign in
            </Link>
            <Link href="/signup" className="mk-btn mk-btn-dark">
              Get started
            </Link>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="mk-hero">
          <div className="mk-container mk-hero-grid">
            <div className="mk-hero-copy">
              <span className="mk-pill">
                <Asterisk size={12} color="var(--teal)" />
                Your personal AI career agent
              </span>
              <h1>
                Your career.
                <br />
                <span>On autopilot.</span>
              </h1>
              <p className="mk-lede">
                Paste a job link. J*B reads the role, tailors your LaTeX resume using only facts
                you’ve confirmed, fills out the application, and waits for your approval before it
                submits.
              </p>
              <div className="mk-hero-actions">
                <Link href="/signup" className="mk-btn mk-btn-teal mk-btn-lg">
                  Start free
                  <ArrowRight size={18} />
                </Link>
                <a href="#how" className="mk-btn mk-btn-ghost mk-btn-lg">
                  See how it works
                </a>
              </div>
              <ul className="mk-hero-points">
                <li>
                  <Check size={15} />
                  You approve every submission
                </li>
                <li>
                  <Check size={15} />
                  No portal passwords stored
                </li>
                <li>
                  <Check size={15} />
                  Real LaTeX, real PDFs
                </li>
              </ul>
            </div>
            <ProductPreview />
          </div>
        </section>

        <section id="how" className="mk-section">
          <div className="mk-container">
            <SectionHead
              eyebrow="How it works"
              title="One link in. A finished application out."
              text="J*B does the repetitive work of applying. You make the decisions that matter."
            />
            <ol className="mk-steps">
              {[
                [
                  UserRound,
                  "Build your profile once",
                  "Import a resume, GitHub repositories, transcripts, or notes. Confirm what’s true, and J*B remembers it.",
                ],
                [
                  Link2,
                  "Paste a job link",
                  "J*B reads the posting, checks the fit against your profile, and picks the right template for the role.",
                ],
                [
                  FileText,
                  "Get a tailored resume",
                  "Your confirmed experience, reordered and focused for this job, compiled to a one-page LaTeX PDF.",
                ],
                [
                  ShieldCheck,
                  "Approve, submit, verify",
                  "Review the exact resume and answers. J*B submits once and records the portal’s confirmation.",
                ],
              ].map(([Icon, title, text], i) => {
                const StepIcon = Icon as typeof UserRound;
                return (
                  <li key={title as string}>
                    <span className="mk-step-num">0{i + 1}</span>
                    <span className="mk-icon">
                      <StepIcon size={20} />
                    </span>
                    <h3>{title as string}</h3>
                    <p>{text as string}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        <section className="mk-section mk-section-tint">
          <div className="mk-container">
            <SectionHead
              eyebrow="What J*B handles"
              title="An agent built for the whole application."
            />
            <div className="mk-features">
              {[
                [
                  MessageSquare,
                  "Chat-first workspace",
                  "Talk to your agent like a recruiter who knows your background. It tracks every application in the same thread.",
                ],
                [
                  ScanSearch,
                  "Job-specific tailoring",
                  "Relevance scoring and resume selection use the posting’s requirements, never invented experience.",
                ],
                [
                  ListChecks,
                  "Screening questions",
                  "Saved answers fill only exact matches you confirmed. Anything new or sensitive is sent to you first.",
                ],
                [
                  KeyRound,
                  "Sign-in handoff",
                  "When a portal needs a login or verification code, J*B pauses and hands you a secure browser session.",
                ],
                [
                  Radar,
                  "Discover",
                  "Monitor GitHub internship lists and supported employer boards, with standing rules you control.",
                ],
                [
                  BellRing,
                  "Tracking & updates",
                  "A timeline for every application, stored receipts, CSV export, and optional inbox monitoring.",
                ],
              ].map(([Icon, title, text]) => {
                const FeatureIcon = Icon as typeof UserRound;
                return (
                  <article key={title as string} className="mk-feature">
                    <span className="mk-icon">
                      <FeatureIcon size={20} />
                    </span>
                    <h3>{title as string}</h3>
                    <p>{text as string}</p>
                  </article>
                );
              })}
            </div>
            <p className="mk-footnote">
              Browser submission currently supports Greenhouse and Lever. Other portals stop and ask
              you to finish the step yourself.
            </p>
          </div>
        </section>

        <section id="resumes" className="mk-section">
          <div className="mk-container">
            <SectionHead
              eyebrow="LaTeX resumes"
              title="Typeset like an engineer wrote it."
              text="Start from Jake’s Resume or one of five other templates built for different career tracks. Every version exports as PDF and .tex."
            />
            <div className="mk-templates">
              {builtInTemplates.map((t) => (
                <a
                  key={t.id}
                  className="mk-template"
                  href={`/templates/${t.id}.pdf`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="mk-template-paper">
                    <img
                      src={`/templates/${t.id}.png`}
                      alt={`${t.name} template preview with sample content`}
                      loading="lazy"
                      width={816}
                      height={1056}
                    />
                  </span>
                  <span className="mk-template-meta">
                    <strong>{t.name}</strong>
                    <span className="mk-tag">{trackLabel[t.track]}</span>
                  </span>
                </a>
              ))}
            </div>
            <p className="mk-footnote">
              Previews show fictional sample content. Jake’s Resume is adapted from Jake Gutierrez’s
              template under the MIT license.
            </p>
          </div>
        </section>

        <section id="control" className="mk-section mk-section-dark">
          <div className="mk-container mk-control">
            <div>
              <span className="mk-eyebrow mk-eyebrow-light">You stay in control</span>
              <h2>Autopilot, with you at the controls.</h2>
              <p>
                J*B is designed to act on your behalf without speaking for you. It never invents
                experience, never guesses at eligibility, and never submits without the permission
                you gave it.
              </p>
              <Link href="/signup" className="mk-btn mk-btn-teal">
                Create your workspace
                <ArrowRight size={16} />
              </Link>
            </div>
            <ul className="mk-control-list">
              {[
                ["Confirmed facts only", "Imported details stay pending until you confirm them."],
                [
                  "Approval before submission",
                  "See the exact PDF and every answer before anything is sent.",
                ],
                [
                  "Honest screening answers",
                  "Work authorization and sponsorship come from your explicit, per-country answers.",
                ],
                [
                  "No credential capture",
                  "You type passwords and codes directly into the portal’s own page.",
                ],
                [
                  "Verified receipts",
                  "An application counts as submitted only when the portal confirms it.",
                ],
                ["Pause anytime", "Standing authorizations can be turned off instantly."],
              ].map(([title, text]) => (
                <li key={title}>
                  <CircleCheck size={18} />
                  <div>
                    <strong>{title}</strong>
                    <span>{text}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="pricing" className="mk-section">
          <div className="mk-container">
            <SectionHead
              eyebrow="Pricing"
              title="Pay for submissions, not seats."
              text="Usage counts only verified submissions. Failed attempts and retries never count."
            />
            <div className="mk-plans">
              {plans.map((p) => (
                <article key={p.name} className={`mk-plan ${p.featured ? "mk-plan-featured" : ""}`}>
                  <h3>{p.name}</h3>
                  <p className="mk-plan-blurb">{p.blurb}</p>
                  <div className="mk-plan-price">
                    ${p.price}
                    <small>/ month</small>
                  </div>
                  <ul>
                    {p.features.map((f) => (
                      <li key={f}>
                        <Check size={15} />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/signup"
                    className={`mk-btn ${p.featured ? "mk-btn-teal" : "mk-btn-outline"}`}
                  >
                    {p.price === 0 ? "Start free" : `Choose ${p.name}`}
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mk-cta">
          <div className="mk-container mk-cta-inner">
            <Asterisk size={44} color="var(--teal)" />
            <h2>Your next application is one link away.</h2>
            <Link href="/signup" className="mk-btn mk-btn-teal mk-btn-lg">
              Get started free
              <ArrowRight size={18} />
            </Link>
          </div>
        </section>
      </main>

      <footer className="mk-footer">
        <div className="mk-container mk-footer-inner">
          <div>
            <Logo size={22} />
            <p>Your personal AI career agent.</p>
          </div>
          <nav aria-label="Footer" className="mk-footer-links">
            <a href="#how">How it works</a>
            <a href="#pricing">Pricing</a>
            <Link href="/signin">Sign in</Link>
          </nav>
          <small>© {new Date().getFullYear()} J*B · jasteriskb.com</small>
        </div>
      </footer>
    </div>
  );
}

function SectionHead({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) {
  return (
    <div className="mk-section-head">
      <span className="mk-eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      {text && <p>{text}</p>}
    </div>
  );
}

/** A static illustration of the workspace with example data, not live usage. */
function ProductPreview() {
  return (
    <div className="mk-preview" role="img" aria-label="Illustration of the J*B agent workspace">
      <div className="mk-preview-bar">
        <i />
        <i />
        <i />
        <span>app.jasteriskb.com</span>
      </div>
      <div className="mk-preview-body">
        <aside className="mk-preview-nav" aria-hidden="true">
          <Asterisk size={18} color="var(--teal)" />
          <span className="active">
            <MessageSquare size={15} />
          </span>
          <span>
            <UserRound size={15} />
          </span>
          <span>
            <FileText size={15} />
          </span>
          <span>
            <BriefcaseBusiness size={15} />
          </span>
          <span>
            <Radar size={15} />
          </span>
          <span>
            <Github size={15} />
          </span>
        </aside>
        <div className="mk-preview-chat">
          <div className="mk-bubble mk-bubble-user">
            Apply to this role → boards.example.com/jobs/swe-intern
          </div>
          <div className="mk-bubble mk-bubble-agent">
            <span className="mk-agent-dot">
              <Asterisk size={11} color="#fff" />
            </span>
            <div>
              Software Engineering Intern at Example Co. fits your backend projects. I tailored
              Jake’s Resume and filled the application. One question needs you.
            </div>
          </div>
          <div className="mk-progress">
            {[
              ["Read the job", true],
              ["Tailored resume", true],
              ["Filled 14 fields", true],
              ["Waiting for your approval", false],
            ].map(([label, done]) => (
              <span key={label as string} className={done ? "done" : "active"}>
                {done ? <Check size={12} /> : <LoaderCircle size={12} />}
                {label as string}
              </span>
            ))}
          </div>
          <div className="mk-approval">
            <div>
              <strong>Ready for your review</strong>
              <small>Resume · 9 answers · Greenhouse</small>
            </div>
            <span className="mk-approve">Approve &amp; submit</span>
          </div>
        </div>
        <div className="mk-preview-context">
          <small>JOB</small>
          <strong>Software Engineering Intern</strong>
          <span>Example Co. · Remote</span>
          <div className="mk-match">
            <span>Profile match</span>
            <b>Strong</b>
          </div>
          <img src="/templates/jakes.png" alt="" width={816} height={1056} />
        </div>
      </div>
    </div>
  );
}
