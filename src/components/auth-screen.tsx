"use client";
import { useState, type FormEvent } from "react";
import { ArrowRight, Check, Compass, FileText, ShieldCheck } from "lucide-react";
import { Button, Field, Input } from "./ui";
export function AuthScreen({ local }: { local: boolean }) {
  const [mode, setMode] = useState<"signup" | "signin">("signup"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
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
      } else window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-screen">
      <section className="auth-story">
        <a href="/" className="brand">
          <span className="brand-icon">
            <Compass size={23} />
          </span>
          waypoint<span className="brand-period">.</span>
        </a>
        <div className="auth-story-main">
          <div className="eyebrow">
            <span className="tiny-line" />
            YOUR NEXT CHAPTER
          </div>
          <h1>
            Good things
            <br />
            are ahead.
          </h1>
          <p>
            A career agent that gets to know you.
            <br />
            And helps the right opportunities find you.
          </p>
          <div className="story-illustration" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="orbit-center">
              <Compass size={45} strokeWidth={1} />
            </div>
            <span className="orbit-label label-one">
              <FileText size={16} />
              Your story, well told
            </span>
            <span className="orbit-label label-two">
              <Check size={16} />
              One step closer
            </span>
            <i className="orbit-point" />
          </div>
        </div>
        <p className="auth-footnote">A little direction. A world of possibility.</p>
      </section>
      <section className="auth-panel">
        <div className="auth-form">
          <div className="eyebrow">LET’S MAKE YOUR NEXT MOVE</div>
          <h2>{mode === "signup" ? "Welcome to your next chapter." : "Good to see you again."}</h2>
          <p>
            {mode === "signup"
              ? "Create your workspace. We’ll take it from there, together."
              : "Your career workspace is right where you left it."}
          </p>
          <div className="segmented">
            <button
              onClick={() => setMode("signup")}
              className={mode === "signup" ? "selected" : ""}
            >
              Create account
            </button>
            <button
              onClick={() => setMode("signin")}
              className={mode === "signin" ? "selected" : ""}
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
            <Button type="submit" disabled={busy} className="full-width">
              {busy
                ? "Getting your workspace ready…"
                : mode === "signup"
                  ? "Create your workspace"
                  : "Welcome back"}
              <ArrowRight size={17} />
            </Button>
          </form>
          <div className="auth-trust">
            <ShieldCheck size={17} />
            <span>Your information stays yours. Every submission is yours to approve.</span>
          </div>
          {local && (
            <p className="local-note">
              <span className="status-dot" />
              Local development · accounts and data stay on this device
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
