import type { Metadata } from "next";
import Link from "next/link";
import { loadAdminEvent } from "@/lib/admin/event";
import { ACTIVITY_KINDS, activityAction, activityDetails, activityKind, filterActivity, type ActivityRow, type StaffAccount } from "@/lib/admin/activity";
import { ROLE_LABELS, type Role } from "@/lib/auth/routes";
import { clock, count, dateTime } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { Badge, buttonClass, inputClass, Notice, Panel, Table, Td, type Tone } from "@/app/admin/guide-ui";

export const metadata: Metadata = { title: "Activity" };

const PAGE = 500;
const ROLE_TONES: Record<string, Tone> = {
  ORGANISER: "violet",
  REGISTRATION: "green",
  JUDGE: "blue",
  CRISIS: "red",
  FAIRNESS: "amber",
  DISPLAY: "slate",
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const UUID = /^[0-9a-f-]{36}$/i;

function roleLabel(role: string) {
  return ROLE_LABELS[role as Role] ?? role;
}

// Activity (organisers only): every action of every staff account — the organisers, the registration, judging and
// crisis desks, the fairness officer and the projector — newest first: when (IST), who, what, on which team or
// entity, and what changed. Filters by account, kind and free text; re-reads every 15 seconds.
export default async function ActivityPage({ params, searchParams }: PageProps<"/admin/[slug]/activity">) {
  const { slug } = await params;
  const sp = await searchParams;
  const actor = UUID.test(one(sp.actor)) ? one(sp.actor) : "";
  const kind = (ACTIVITY_KINDS as readonly string[]).includes(one(sp.kind)) ? one(sp.kind) : "";
  const q = one(sp.q).slice(0, 100);
  const before = one(sp.before) && !Number.isNaN(Date.parse(one(sp.before))) ? one(sp.before) : null;

  const event = await loadAdminEvent(slug);
  const sb = await supabaseServer();
  const [activity, staff] = await Promise.all([
    sb.rpc("staff_activity", { p_event: event.id, p_actor: actor || null, p_limit: PAGE, p_before: before }),
    sb.rpc("staff_accounts"),
  ]);
  if (activity.error) throw new Error(`Could not read the staff activity: ${activity.error.message}`);
  if (staff.error) throw new Error(`Could not read the staff accounts: ${staff.error.message}`);
  const all = (activity.data ?? []) as ActivityRow[];
  const accounts = (staff.data ?? []) as StaffAccount[];
  const rows = filterActivity(all, { kind, q });
  const oldest = all.at(-1)?.at;
  const query = (extra: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ actor, kind, q, ...extra })) if (v) p.set(k, v);
    const s = p.toString();
    return `/admin/${slug}/activity${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-6">
      {/* Live only on the newest page: an older page stays put while it is read. */}
      <AutoRefresh everyMs={15_000} active={!before} />
      <Panel title="Filters">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="guide-label">Staff account</span>
            <select name="actor" defaultValue={actor} className={inputClass}>
              <option value="">Everyone</option>
              {accounts.map((a) => (
                <option key={a.user_id} value={a.user_id}>
                  {a.display_name ?? a.email} · {a.email} · {roleLabel(a.role)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="guide-label">Action</span>
            <select name="kind" defaultValue={kind} className={inputClass}>
              <option value="">Every kind</option>
              {ACTIVITY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="guide-label">Search</span>
            <input type="search" name="q" defaultValue={q} placeholder="Team code, name, email, action…" className={inputClass} />
          </label>
          <button type="submit" className={buttonClass.primary}>
            Show
          </button>
          {actor || kind || q || before ? (
            <Link href={`/admin/${slug}/activity`} className={buttonClass.secondary}>
              Clear
            </Link>
          ) : null}
        </form>
      </Panel>

      <Panel
        title={before ? `Activity before ${dateTime(before)}` : "Latest activity"}
        actions={<Badge tone="slate">{`${count(rows.length)} of ${count(all.length)} lines`}</Badge>}
      >
        <p className="mb-2 text-sm text-paper">
          Newest first, times in IST. One line per action: the rows one action changed in one table are one line. Team logins&apos; own actions are not shown.
          {before ? null : " Refreshes every 15 seconds."}
        </p>
        {all.length === 0 && !before ? <Notice>No staff action recorded for this event yet.</Notice> : null}
        <Table head={["Time", "Staff", "Action", "Target", "Details"]} empty="No line matches these filters." label="Staff activity">
          {rows.map((r) => (
            <tr key={r.id} className="align-top">
              <Td mono>
                <span title={dateTime(r.at)}>{clock(r.at, true)}</span>
              </Td>
              <Td>
                <div className="font-semibold">{r.actor_name ?? "—"}</div>
                <div className="guide-muted text-xs">{r.actor_email ?? r.actor_id}</div>
                <Badge tone={ROLE_TONES[r.actor_role] ?? "slate"}>{roleLabel(r.actor_role)}</Badge>
              </Td>
              <Td className="whitespace-normal">
                <div>{activityAction(r)}</div>
                <div className="guide-muted text-xs">{activityKind(r)}</div>
              </Td>
              <Td className="whitespace-normal">
                <div>{r.entity_label ?? "—"}</div>
                <div className="guide-muted text-xs">{r.entity.replace(/_/g, " ")}</div>
              </Td>
              <Td className="whitespace-normal">
                <ul className="space-y-0.5 text-xs">
                  {activityDetails(r).map((d, i) => (
                    <li key={i} className="break-words">
                      {d}
                    </li>
                  ))}
                </ul>
              </Td>
            </tr>
          ))}
        </Table>
        <div className="mt-3 flex flex-wrap gap-3">
          {before ? (
            <Link href={query({ before: null })} className={buttonClass.secondary}>
              Newest
            </Link>
          ) : null}
          {all.length === PAGE && oldest ? (
            <Link href={query({ before: oldest })} className={buttonClass.secondary}>
              Older
            </Link>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
