"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { Button, Field, Input } from "./ui";
import { Asterisk, Logo } from "./brand";

type Mode = "signup" | "signin";
export function AuthScreen({
  local,
  initialMode = "signup",
  initialError = "",
}: {
  local: boolean;
  initialMode?: Mode;
  initialError?: string;
}) {
  const [mode, setModeState] = useState<Mode>(initialMode),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(initialError),
    [notice, setNotice] = useState("");
  function setMode(next: Mode) {
    setModeState(next);
    setError("");
    window.history.replaceState(null, "", next === "signup" ? "/signup" : "/signin");
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: mode,
          name: f.get("name"),
          email: f.get("email"),
          password: f.get("password"),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not sign in.");
      if (
        d.requiresConfirmation ||
        d.needsConfirmation ||
        d.confirmationRequired ||
        d.user === null
      ) {
        setNotice("Check your email to confirm your account, then sign in.");
        setMode("signin");
      } else window.location.assign("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="jb-auth">
      <section className="jb-auth-story">
        <Link href="/" aria-label="J*B home">
          <Logo size={28} inverted />
        </Link>
        <div className="jb-auth-story-main">
          <span className="jb-auth-kicker">
            <Asterisk size={12} color="var(--teal)" />
            Your personal AI career agent
          </span>
          <h1>
            Your career.
            <br />
            <span>On autopilot.</span>
          </h1>
          <ul>
            {[
              "Tailored LaTeX resumes from facts you confirm",
              "Applications prepared from a single job link",
              "Nothing is submitted without your approval",
            ].map((item) => (
              <li key={item}>
                <span>
                  <Check size={13} />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="jb-auth-foot">jasteriskb.com</p>
      </section>
      <section className="jb-auth-panel">
        <div className="jb-auth-form">
          <Link href="/" className="jb-auth-mobile-logo" aria-label="J*B home">
            <Logo size={26} />
          </Link>
          <h2>{mode === "signup" ? "Create your J*B workspace" : "Welcome back"}</h2>
          <p>
            {mode === "signup"
              ? "Set up your career profile once. Your agent takes it from there."
              : "Sign in to pick up where your agent left off."}
          </p>
          <div className="segmented" role="group" aria-label="Account">
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={mode === "signup" ? "selected" : ""}
              aria-pressed={mode === "signup"}
            >
              Create account
            </button>
            <button
              type="button"
              onClick={() => setMode("signin")}
              className={mode === "signin" ? "selected" : ""}
              aria-pressed={mode === "signin"}
            >
              Sign in
            </button>
          </div>
          <form onSubmit={submit}>
            {mode === "signup" && (
              <Field label="Your name">
                <Input
                  name="name"
                  autoComplete="name"
                  placeholder="Alex Morgan"
                  required
                  maxLength={200}
                />
              </Field>
            )}
            <Field label="Email address">
              <Input
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
            </Field>
            <Field
              label="Password"
              hint={mode === "signup" ? "At least 12 characters." : undefined}
            >
              <Input
                name="password"
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                placeholder="Your password"
                minLength={mode === "signup" ? 12 : 1}
                required
              />
            </Field>
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
            <Button type="submit" disabled={busy} className="full-width jb-auth-submit">
              {busy
                ? "Getting your workspace ready…"
                : mode === "signup"
                  ? "Create your workspace"
                  : "Sign in"}
              <ArrowRight size={17} />
            </Button>
          </form>
          <div className="jb-auth-trust">
            <ShieldCheck size={17} />
            <span>Your data stays private. You approve every submission.</span>
          </div>
          {local && (
            <p className="jb-auth-local">
              <span className="status-dot" />
              Local development · accounts and data stay on this device
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
