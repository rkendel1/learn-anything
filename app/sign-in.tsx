"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { FormEvent, useState } from "react";
import { ArrowRight, BookOpen } from "lucide-react";

export function SignIn() {
  const { signIn } = useAuthActions();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      form.set("flow", mode);
      await signIn("password", form);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <span className="brand" aria-label="Learn Anything home">
          <span className="brand-mark"><BookOpen size={19} /></span>
          <span>learn anything</span>
        </span>
        <span className="topbar-note">A quiet place to stay curious.</span>
      </header>

      <section className="setup-page auth-page">
        <div className="section-kicker">YOUR PRIVATE LEARNING SPACE</div>
        <h1>Welcome back.<br /><em>Let&apos;s learn.</em></h1>
        <p className="lead">
          Sign in to keep your journeys, lessons, and assessment evidence private to you.
        </p>

        {error && <div className="alert error" role="alert">{error}</div>}

        <form className="setup-form" onSubmit={submit}>
          <label className="field-label" htmlFor="email">Email</label>
          <input
            id="email"
            className="topic-input"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
          />

          <label className="field-label" htmlFor="password">Password</label>
          <input
            id="password"
            className="topic-input"
            name="password"
            type="password"
            autoComplete={mode === "signUp" ? "new-password" : "current-password"}
            minLength={mode === "signUp" ? 8 : undefined}
            required
            placeholder={mode === "signUp" ? "At least 8 characters" : "Your password"}
          />

          <button className="primary-button wide" type="submit" disabled={busy}>
            {busy ? "Checking…" : mode === "signIn" ? "Sign in" : "Create my account"}
            {!busy && <ArrowRight size={17} />}
          </button>

          <button
            className="text-button wide"
            type="button"
            disabled={busy}
            onClick={() => {
              setMode(mode === "signIn" ? "signUp" : "signIn");
              setError("");
            }}
          >
            {mode === "signIn" ? "New here? Create an account" : "Already have an account? Sign in"}
          </button>
          <p className="form-footnote">
            Your learning data is stored in this app&apos;s Convex deployment.
          </p>
        </form>
      </section>
    </main>
  );
}
