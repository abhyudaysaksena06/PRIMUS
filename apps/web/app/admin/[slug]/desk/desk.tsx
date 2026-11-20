"use client";

// The desk: the team list with a search, and the admit form. Open a team from the list (or start a walk-in), correct
// its details, press Admit: the page names the login card to hand over, and that card's login starts working.
// An admitted team can be edited, or checked out again until the squads are drawn.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TRACKS, TRACK_LABELS, type Track } from "@msim/engine";
import type { ActionResult } from "@/lib/rpc";
import { Badge, buttonClass, inputClass } from "@/app/admin/guide-ui";
import { ResultMessage } from "@/components/ui/result-message";
import { safely } from "@/components/ui/action-helpers";
import { admitTeam, checkOut, saveTeam, type DeskMember } from "./actions";

export interface ListTeam {
  id: string;
  number: number;
  name: string;
  track: Track | null;
  college: string;
  email: string;
  phone: string;
  members: DeskMember[];
  extra: Record<string, string>;
  /** Where the team came from: the uploaded sheet, the online form, or a walk-in at the desk. */
  source: "UPLOAD" | "ONLINE" | "DESK";
  /** The login card this team was admitted on, or null. */
  teamId: string | null;
  card: string | null;
}

interface Draft {
  rosterId: string | null;
  number: number | null;
  /** The card the team is already on (editing). */
  card: string | null;
  track: Track;
  /** A specific card to hand over (optional; blank = the track's next free card). */
  pick: string;
  name: string;
  college: string;
  email: string;
  phone: string;
  members: { full_name: string; roll_number: string }[];
  extra: Record<string, string>;
}

const MAX = 5;
const row = () => ({ full_name: "", roll_number: "" });
const walkIn = (track: Track): Draft => ({
  rosterId: null, number: null, card: null, track, pick: "", name: "", college: "", email: "", phone: "", members: [row(), row()], extra: {},
});
const fromTeam = (t: ListTeam, fallback: Track): Draft => ({
  rosterId: t.id,
  number: t.number,
  card: t.card,
  track: t.track ?? fallback,
  pick: "",
  name: t.name,
  college: t.college,
  email: t.email,
  phone: t.phone,
  members: t.members.length ? t.members.map((m) => ({ full_name: m.full_name, roll_number: m.roll_number ?? "" })) : [row()],
  extra: t.extra,
});

export function Desk({ eventId, list, editable, canCheckOut }: { eventId: string; list: ListTeam[]; editable: boolean; canCheckOut: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [handed, setHanded] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<"all" | "waiting" | "admitted" | "online">("waiting");
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<ActionResult>, then?: (r: ActionResult) => void) =>
    start(async () => {
      const r = await safely(fn);
      setResult(r);
      if (r.ok) then?.(r);
      router.refresh();
    });

  const open = (d: Draft) => {
    setHanded(null);
    setResult(null);
    setDraft(d);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setHanded(null);
    const members = draft.members
      .filter((m) => m.full_name.trim() !== "")
      .map((m) => ({ full_name: m.full_name.trim(), roll_number: m.roll_number.trim() || null }));
    run(
      () =>
        admitTeam(eventId, {
          rosterId: draft.rosterId,
          track: draft.track,
          code: draft.card ?? (draft.pick.trim() || null),
          edit: draft.card !== null,
          name: draft.name,
          members,
          details: { college: draft.college, email: draft.email, phone: draft.phone },
        }),
      (r) => {
        if (r.data?.new) setHanded(String(r.data?.card ?? ""));
        setDraft(null);
        setQuery("");
      },
    );
  };
  // Save a registered team's details (name, track, contacts, members) without admitting it yet.
  const saveOnly = () => {
    if (!draft?.rosterId) return;
    const members = draft.members
      .filter((m) => m.full_name.trim() !== "")
      .map((m) => ({ full_name: m.full_name.trim(), roll_number: m.roll_number.trim() || null }));
    setHanded(null);
    run(
      () =>
        saveTeam({
          rosterId: draft.rosterId!,
          track: draft.track,
          name: draft.name,
          members,
          details: { college: draft.college, email: draft.email, phone: draft.phone },
        }),
      () => setDraft(null),
    );
  };
  const setMember = (i: number, key: "full_name" | "roll_number", value: string) =>
    setDraft((d) => (d ? { ...d, members: d.members.map((m, j) => (j === i ? { ...m, [key]: value } : m)) } : d));

  const q = query.trim().toLowerCase();
  const shown = list.filter(
    (t) =>
      (show === "all" || (show === "online" ? t.source === "ONLINE" : (show === "admitted") === (t.card !== null))) &&
      (q === "" ||
        [String(t.number), t.card ?? "", t.name, t.college, t.email, t.phone, ...t.members.map((m) => `${m.full_name} ${m.roll_number ?? ""}`)].some((s) =>
          s.toLowerCase().includes(q),
        )),
  );
  const admittedCount = list.filter((t) => t.card !== null).length;

  return (
    <div className="space-y-6">
      {handed ? (
        <p className="rounded-md border border-phosphor px-4 py-3 text-lg" data-testid="desk-handed">
          Give them login card <b className="font-mono text-2xl">{handed}</b>
        </p>
      ) : null}
      <ResultMessage result={result} />

      {editable && draft ? (
        <form onSubmit={submit} className="space-y-3 rounded-lg border border-phosphor p-4" data-testid="desk-form">
          <h3 className="font-semibold">
            {draft.card ? `Edit ${draft.card}` : draft.number !== null ? `Admit team #${draft.number}` : "Admit a walk-in team"}
          </h3>
          {draft.card ? null : (
            <div className="flex flex-wrap gap-3">
              <label className="text-sm">
                <span className="block">Track</span>
                <select value={draft.track} onChange={(e) => setDraft({ ...draft, track: e.target.value as Track })} className={`${inputClass} w-44`} data-testid="desk-track">
                  {TRACKS.map((t) => (
                    <option key={t} value={t}>
                      {TRACK_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="block">Card code (optional)</span>
                <input
                  value={draft.pick}
                  onChange={(e) => setDraft({ ...draft, pick: e.target.value.toUpperCase() })}
                  placeholder="next free card"
                  maxLength={6}
                  className={`${inputClass} w-40 font-mono`}
                  data-testid="desk-card"
                />
              </label>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span>Team name</span>
              <input value={draft.name} required maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClass} data-testid="desk-name" />
            </label>
            <label className="block text-sm">
              <span>College</span>
              <input value={draft.college} maxLength={160} onChange={(e) => setDraft({ ...draft, college: e.target.value })} className={inputClass} />
            </label>
            <label className="block text-sm">
              <span>Email</span>
              <input value={draft.email} maxLength={160} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className={inputClass} />
            </label>
            <label className="block text-sm">
              <span>Phone</span>
              <input value={draft.phone} maxLength={40} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className={inputClass} />
            </label>
          </div>
          <div className="space-y-2">
            <p className="text-sm">
              Members, team leader first ({draft.members.length} of {MAX})
            </p>
            {draft.members.map((m, i) => (
              <div key={i} className="flex gap-2">
                <input aria-label={`Member ${i + 1} name`} placeholder="Name" value={m.full_name} maxLength={120} onChange={(e) => setMember(i, "full_name", e.target.value)} className={inputClass} />
                <input
                  aria-label={`Member ${i + 1} roll number`}
                  placeholder="Roll no."
                  value={m.roll_number}
                  maxLength={30}
                  onChange={(e) => setMember(i, "roll_number", e.target.value)}
                  className={`${inputClass} w-32`}
                />
                {draft.members.length > 1 ? (
                  <button
                    type="button"
                    className={buttonClass.secondary}
                    aria-label={`Remove member ${i + 1}`}
                    onClick={() => setDraft({ ...draft, members: draft.members.filter((_, j) => j !== i) })}
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            ))}
            {draft.members.length < MAX ? (
              <button type="button" className={buttonClass.secondary} onClick={() => setDraft({ ...draft, members: [...draft.members, row()] })}>
                + Add member
              </button>
            ) : null}
          </div>
          {Object.keys(draft.extra).length ? (
            <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
              {Object.entries(draft.extra).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="text-muted">{k}:</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={buttonClass.primary} disabled={pending} data-testid="desk-submit">
              {pending ? "Saving…" : draft.card ? "Save changes" : "Admit and give a card"}
            </button>
            {draft.rosterId && !draft.card ? (
              <button type="button" className={buttonClass.secondary} onClick={saveOnly} disabled={pending} data-testid="desk-save-only">
                Save details only
              </button>
            ) : null}
            <button type="button" className={buttonClass.secondary} onClick={() => setDraft(null)} disabled={pending}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">
            Team list ({list.length}, {admittedCount} admitted)
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <select value={show} onChange={(e) => setShow(e.target.value as typeof show)} className={`${inputClass} w-auto`} aria-label="Show">
              <option value="waiting">Not admitted yet</option>
              <option value="admitted">Admitted</option>
              <option value="online">Registered online</option>
              <option value="all">All teams</option>
            </select>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, member, roll no., phone"
              aria-label="Search the team list"
              className={`${inputClass} w-64`}
              data-testid="desk-search"
            />
            {editable ? (
              <button type="button" className={buttonClass.secondary} onClick={() => open(walkIn("PRODUCT"))} disabled={pending}>
                Walk-in team
              </button>
            ) : null}
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border border-phosphor-dim">
          <table className="w-full text-left text-sm" data-testid="desk-table">
            <thead className="text-xs uppercase">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Team</th>
                <th className="px-3 py-2">Members</th>
                <th className="px-3 py-2">Card</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id} className="border-t border-phosphor-dim">
                  <td className="px-3 py-2 font-mono">
                    {t.number}
                    {t.source === "ONLINE" ? <span className="block text-xs text-muted">online</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    {t.name}
                    <span className="block text-xs text-muted">{[t.track ? TRACK_LABELS[t.track] : null, t.college || null, t.phone || null].filter(Boolean).join(" · ")}</span>
                  </td>
                  <td className="px-3 py-2">{t.members.map((m) => m.full_name).join(", ")}</td>
                  <td className="px-3 py-2">{t.card ? <Badge tone="green">{t.card}</Badge> : <span className="text-muted">not admitted</span>}</td>
                  <td className="px-3 py-2">
                    {editable ? (
                      <div className="flex justify-end gap-2">
                        <button type="button" className={t.card ? buttonClass.secondary : buttonClass.primary} disabled={pending} onClick={() => open(fromTeam(t, "PRODUCT"))}>
                          {t.card ? "Edit" : "Admit"}
                        </button>
                        {t.card && t.teamId && canCheckOut ? (
                          <button
                            type="button"
                            className={armed === t.id ? buttonClass.danger : buttonClass.secondary}
                            disabled={pending}
                            onClick={() => {
                              if (armed !== t.id) return setArmed(t.id);
                              setArmed(null);
                              run(() => checkOut(eventId, t.teamId!));
                            }}
                          >
                            {armed === t.id ? `Click again: check out ${t.card}` : "Check out"}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-muted">
                    {list.length === 0 ? "No teams yet: upload the team list, or admit a walk-in team." : "No team matches."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
