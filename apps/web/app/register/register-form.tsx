"use client";

import { useActionState, useState } from "react";
import { MAX_MEMBERS } from "@/lib/register";
import { registerTeam, type RegisterState } from "./actions";

// The demo's form parts (app/demo/demo.css): capital labels, dark fields, the demo's buttons.
const label = "guide-label";
const inputClass = "guide-input";
const quietButton = "guide-btn secondary";

export function RegisterForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState<RegisterState, FormData>(registerTeam.bind(null, slug), {});
  const [category, setCategory] = useState<"THAPAR" | "OUTSIDE">("THAPAR");
  const [count, setCount] = useState(2);
  const thapar = category === "THAPAR";

  if (state.number) {
    return (
      <div className="mt-6 space-y-3" data-testid="register-done">
        <p className="text-[15px] font-semibold">
          <b>{state.teamName}</b> is registered.
        </p>
        <p className="guide-alert guide-warning">
          Your team number is <b className="font-mono text-3xl" data-testid="register-number">{state.number}</b>
        </p>
        <p className="guide-muted">
          Save this number (take a screenshot). Give it at the registration desk on the day: the desk checks your details and hands over your login card.
        </p>
      </div>
    );
  }

  const tab = (c: "THAPAR" | "OUTSIDE", text: string) => (
    <button
      type="button"
      onClick={() => setCategory(c)}
      aria-pressed={category === c}
      className={`flex-1 ${category === c ? "active" : ""}`}
    >
      {text}
    </button>
  );

  return (
    <form action={action} className="mt-6 space-y-4" data-testid="register-form">
      <div className="demo-tab-strip">
        {tab("THAPAR", "Thapar student")}
        {tab("OUTSIDE", "Outside Thapar")}
      </div>
      <input type="hidden" name="category" value={category} />
      {/* Hidden from people; a bot that fills it in is turned away. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />

      <label className={label}>
        Team name
        <input name="team_name" required maxLength={80} className={`${inputClass} mt-1`} />
      </label>
      {thapar ? null : (
        <label className={label}>
          College name
          <input name="college" required maxLength={160} className={`${inputClass} mt-1`} />
        </label>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>
          Team leader&apos;s email
          <input name="leader_email" type="email" required maxLength={160} className={`${inputClass} mt-1`} />
        </label>
        <label className={label}>
          Team leader&apos;s phone
          <input name="leader_phone" type="tel" required inputMode="tel" pattern="[0-9+ \-]{10,20}" maxLength={20} className={`${inputClass} mt-1`} />
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className={label}>
          Members, team leader first ({count} of {MAX_MEMBERS}; 2 to {MAX_MEMBERS} including the leader)
        </legend>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="flex gap-2">
            <input
              name={`member_name_${i}`}
              required
              maxLength={120}
              placeholder={i === 0 ? "Leader's name" : `Member ${i + 1} name`}
              aria-label={i === 0 ? "Leader's name" : `Member ${i + 1} name`}
              className={inputClass}
            />
            {thapar ? (
              <input
                name={`member_roll_${i}`}
                required
                maxLength={40}
                placeholder="Roll no."
                aria-label={`Member ${i + 1} roll number`}
                className={`${inputClass} w-36`}
              />
            ) : null}
          </div>
        ))}
        <div className="flex gap-2">
          {count < MAX_MEMBERS ? (
            <button type="button" className={quietButton} onClick={() => setCount(count + 1)}>
              + Add member
            </button>
          ) : null}
          {count > 2 ? (
            <button type="button" className={quietButton} onClick={() => setCount(count - 1)}>
              Remove last
            </button>
          ) : null}
        </div>
      </fieldset>

      {state.error ? (
        <p role="alert" className="guide-alert guide-warning">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className="demo-login-primary w-full font-mono text-[11px] font-bold uppercase tracking-[0.12em]" data-testid="register-submit">
        {pending ? "Registering…" : "Register"}
      </button>
    </form>
  );
}
