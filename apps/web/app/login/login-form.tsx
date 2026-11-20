"use client";

// The sign-in form, drawn as the demo's (app/demo/login): two access tabs, capital labels, dark fields and one solid
// key. The fields, their names and the messages are the real ones (actions.ts).

import { useActionState, useState } from "react";
import { signIn, type LoginState } from "./actions";

export function LoginForm({ next, code }: { next?: string; code?: string }) {
  const [mode, setMode] = useState<"team" | "staff">("team");
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});

  const tab = (m: "team" | "staff", label: string) => (
    <button type="button" onClick={() => setMode(m)} aria-pressed={mode === m} className={mode === m ? "active" : ""}>
      {label}
    </button>
  );

  return (
    <form action={action}>
      <div className="guide-tabs">
        {tab("team", "Team access")}
        {tab("staff", "Organiser")}
      </div>
      <input type="hidden" name="mode" value={mode} />
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {mode === "team" ? (
        <label className="block">
          <span className="guide-label">TEAM CODE (ON YOUR CARD, E.G. P07)</span>
          <input
            name="code"
            defaultValue={mode === "team" ? (state.login ?? code) : undefined}
            required
            autoComplete="username"
            autoCapitalize="characters"
            placeholder="P07"
            className="guide-input font-mono uppercase"
          />
        </label>
      ) : (
        <label className="block">
          <span className="guide-label">ORGANISER EMAIL</span>
          <input
            name="email"
            type="email"
            defaultValue={mode === "staff" ? state.login : undefined}
            required
            autoComplete="username"
            className="guide-input"
          />
        </label>
      )}

      <label className="block">
        <span className="guide-label">PASSWORD</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          autoFocus={mode === "team" && !!code}
          placeholder={mode === "team" ? "XXXX-XXXX-XXXX" : undefined}
          className="guide-input font-mono"
        />
      </label>

      {state.error ? (
        <p role="alert" className="guide-alert mt-4 border-l-[#ff5d6c] bg-[rgba(128,22,34,.22)] text-[#ffc7cd]">
          {state.error}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className="demo-login-submit mt-5 w-full px-4 py-3 text-left font-mono text-[10px] font-bold uppercase tracking-[.15em] hover:brightness-110 disabled:opacity-60">
        {pending ? "Signing in…" : "Sign in"} <span className="float-right" aria-hidden>→</span>
      </button>
    </form>
  );
}
