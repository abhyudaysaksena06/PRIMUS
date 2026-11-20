"use client";

// The sign-in form, drawn as the demo's (app/demo/login): two access tabs, capital labels, dark fields and one solid
// key. The fields, their names and the messages are the real ones (actions.ts).

import { useActionState, useState } from "react";
import { signIn, type LoginState } from "./actions";

export function LoginForm({ next, code }: { next?: string; code?: string }) {
  const [mode, setMode] = useState<"team" | "staff">("team");
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});

  const tab = (m: "team" | "staff", label: string) => (
    <button type="button" onClick={() => setMode(m)} aria-pressed={mode === m}>
      {label}
    </button>
  );

  return (
    <form action={action} className="space-y-4">
      <div className="mx-login-tabs">
        {tab("team", "Team")}
        {tab("staff", "Organiser")}
      </div>
      <input type="hidden" name="mode" value={mode} />
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {mode === "team" ? (
        <label className="block">
          <span className="mx-login-label">Team code</span>
          <input
            name="code"
            defaultValue={mode === "team" ? (state.login ?? code) : undefined}
            required
            autoComplete="username"
            autoCapitalize="characters"
            placeholder="P07"
            className="mx-login-input font-mono uppercase tracking-wider"
          />
        </label>
      ) : (
        <label className="block">
          <span className="mx-login-label">Email</span>
          <input
            name="email"
            type="email"
            defaultValue={mode === "staff" ? state.login : undefined}
            required
            autoComplete="username"
            className="mx-login-input"
          />
        </label>
      )}

      <label className="block">
        <span className="mx-login-label">Password</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          autoFocus={mode === "team" && !!code}
          placeholder={mode === "team" ? "XXXX-XXXX-XXXX" : undefined}
          className="mx-login-input font-mono tracking-wider"
        />
      </label>

      {state.error ? (
        <p role="alert" className="mx-sys rounded-md border border-danger/70 bg-danger/10 px-3 py-2 text-sm text-danger-soft">
          {state.error}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className="mx-login-submit">
        <span>{pending ? "Signing in…" : "Sign in"}</span>
        <span aria-hidden>→</span>
      </button>
    </form>
  );
}
