import type { Metadata } from "next";
import { can, type Role } from "@/lib/auth/routes";
import { headers } from "next/headers";
import { TRACKS, TRACK_LABELS, type Track } from "@msim/engine";
import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent } from "@/lib/admin/event";
import { MAX_LIST_BYTES } from "@/lib/admin/team-list";
import { PARTICIPANT_CAP, TRACK_CAP, nextFreeCard } from "@/lib/admin/admitted";
import { supabaseServer } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { Notice, Panel, Stat, inputClass } from "@/app/admin/guide-ui";
import { ActionButton, ActionForm } from "@/components/ui/action";
import { Desk, type ListTeam } from "./desk";
import { DrawPreview } from "./draw-preview";
import { importTeamList, setDeskRule, setRegistration } from "./actions";

export const metadata: Metadata = { title: "Registration desk" };

interface TeamRow {
  id: string;
  code: string;
  track: Track;
  checked_in_at: string | null;
  disqualified: boolean;
}

interface RosterRow {
  id: string;
  number: number;
  team_name: string;
  track: Track | null;
  college: string | null;
  email: string | null;
  phone: string | null;
  members: { full_name: string; roll_number: string | null }[];
  extra: Record<string, string>;
  source: "UPLOAD" | "ONLINE" | "DESK";
  team_id: string | null;
}

// The registration desk on the night. The organisers' team list is uploaded here before the night. Every team's login
// card is printed in advance, but it signs in only after the desk admits that team: find it in the list (or start a
// walk-in), correct its details, press Admit, and hand over the card the page names.
export default async function DeskPage({ params }: PageProps<"/admin/[slug]/desk">) {
  const { slug } = await params;
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  const organiser = can(viewer!.role as Role, "desk"); // organisers and the registration desk (migration 074)
  const sb = await supabaseServer();
  const host = (await headers()).get("host") ?? "primus.mrdev4u.com";
  const registerUrl = `${host.startsWith("localhost") ? "http" : "https"}://${host}/register`;
  const [teams, roster, rule, reg, memberRows] = await Promise.all([
    // Paged: PostgREST returns at most 1,000 rows a read (600 cards at 200 a track; the list can be longer).
    fetchAll<TeamRow>((from, to) => sb.from("teams").select("id, code, track, checked_in_at, disqualified").eq("event_id", event.id).order("code").order("id").range(from, to)).then((data) => ({ data, error: null }), (e: Error) => ({ data: null, error: { message: e.message } })),
    fetchAll<RosterRow>((from, to) =>
      sb
        .from("roster")
        .select("id, number, team_name, track, college, email, phone, members, extra, source, team_id")
        .eq("event_id", event.id)
        .order("number")
        .order("id")
        .range(from, to),
    ).then((data) => ({ data, error: null }), (e: Error) => ({ data: null, error: { message: e.message } })),
    sb.from("events").select("desk_check_in").eq("id", event.id).maybeSingle<{ desk_check_in: boolean }>(),
    sb.from("events").select("registration_open").eq("id", event.id).maybeSingle<{ registration_open: boolean }>(),
    // Participants (migration 096 caps them at 675): the members of every admitted team.
    fetchAll<{ team_id: string }>((from, to) => sb.from("members").select("team_id").eq("event_id", event.id).order("id").range(from, to)).then(
      (data) => data,
      () => [] as { team_id: string }[],
    ),
  ]);
  if (teams.error || roster.error || rule.error) {
    return (
      <Notice tone="amber">
        The database does not have the registration desk yet: run the latest SQL update (migration 048), then reload this page.
      </Notice>
    );
  }
  const cards = (teams.data ?? []) as TeamRow[];
  const byId = new Map(cards.map((t) => [t.id, t]));
  const on = rule.data?.desk_check_in ?? false;
  const list: ListTeam[] = ((roster.data ?? []) as RosterRow[]).map((r) => ({
    id: r.id,
    number: r.number,
    name: r.team_name,
    track: r.track,
    college: r.college ?? "",
    email: r.email ?? "",
    phone: r.phone ?? "",
    members: r.members ?? [],
    extra: r.extra ?? {},
    source: r.source ?? "UPLOAD",
    teamId: r.team_id,
    card: r.team_id ? (byId.get(r.team_id)?.code ?? null) : null,
  }));
  const count = (track: Track) => {
    const all = cards.filter((t) => t.track === track);
    return { total: all.length, done: all.filter((t) => t.checked_in_at).length };
  };
  const admitted = cards.filter((t) => t.checked_in_at).length;
  const admittedIds = new Set(cards.filter((t) => t.checked_in_at).map((t) => t.id));
  const participants = memberRows.filter((m) => admittedIds.has(m.team_id)).length;
  // "Next free card" at the desk: the lowest code of each track nobody is checked in on (only that code is shown).
  const nextFree = Object.fromEntries(TRACKS.map((t) => [t, nextFreeCard(cards, t)])) as Record<Track, string | null>;
  const open = !event.drawn_at;
  // Online registration needs migration 049; without it the panel says so instead of breaking the page.
  const regReady = !reg.error;
  const regOpen = reg.data?.registration_open ?? false;
  const online = list.filter((t) => t.source === "ONLINE").length;

  return (
    <div className="space-y-6">
      <Panel
        title="Registration desk"
        actions={
          organiser ? (
            <ActionButton
              action={setDeskRule.bind(null, event.id, !on)}
              confirm={on ? "Click again: let every team sign in without the desk" : "Click again: require the desk's check-in"}
            >
              {on ? "Turn off desk check-in" : "Require desk check-in"}
            </ActionButton>
          ) : null
        }
      >
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat
            label="Participants"
            value={`${participants} / ${PARTICIPANT_CAP}`}
            hint={`${Math.max(0, PARTICIPANT_CAP - participants)} places left · ${admitted} teams admitted · ${list.length} in the list`}
          />
          {TRACKS.map((track) => {
            const c = count(track);
            return (
              <Stat
                key={track}
                label={TRACK_LABELS[track]}
                value={`${c.done} / ${TRACK_CAP}`}
                hint={c.done >= TRACK_CAP ? "Full: no more teams of this track" : `${TRACK_CAP - c.done} places left`}
              />
            );
          })}
        </div>
        <div className="mt-4 space-y-2">
          {on ? (
            <Notice tone="blue">
              A team&apos;s login works only after it is admitted here. Find the team in the list below (or start a walk-in team), check and correct
              its details, and press <b>Admit</b>: the page tells you which login card to hand over.
            </Notice>
          ) : (
            <Notice tone="amber">
              Desk check-in is <b>off</b> for this event: every team can sign in with its card, admitted or not. Turn it on to make logins wait for
              the desk.
            </Notice>
          )}
          {!open ? <Notice>The squads have been drawn: teams can still be edited, but no longer checked out.</Notice> : null}
          {open && on && admitted < cards.length ? (
            <Notice>
              Cards not admitted by the draw still take part in it as empty seats: admit every team before the lottery.
            </Notice>
          ) : null}
        </div>
      </Panel>

      <Panel
        title="Online registration"
        actions={
          organiser && regReady ? (
            <ActionButton
              action={setRegistration.bind(null, event.id, !regOpen)}
              confirm={regOpen ? "Click again: close the online form" : "Click again: open the online form"}
            >
              {regOpen ? "Close registration" : "Open registration"}
            </ActionButton>
          ) : null
        }
      >
        {regReady ? (
          <div className="space-y-2 text-sm">
            <p>
              {regOpen ? "Open" : "Closed"} · {online} teams registered online. Share this link: <b className="font-mono">{registerUrl}</b>
            </p>
            <p className="text-muted">
              Each team gets a serial number when it registers, and keeps it as its team ID. Online sign-ups appear in the list below (show{" "}
              <b>Registered online</b>): open one to edit it, choose its track and <b>Save details only</b>, or admit it on the night.
            </p>
          </div>
        ) : (
          <Notice tone="amber">Online registration needs the latest SQL update (migration 049).</Notice>
        )}
      </Panel>

      {organiser ? (
        <Panel title="Upload team list">
          <ActionForm action={importTeamList.bind(null, event.id)} submit="Upload" maxFileBytes={MAX_LIST_BYTES} className="space-y-3" resetOnSuccess>
            <p className="text-sm">
              An Excel (.xlsx) or .csv file, first row the header. Columns are found by their names: <b>Team name</b> (required), <b>Track</b>,{" "}
              <b>College</b>, <b>Email</b>, <b>Phone</b>, and each member&apos;s <b>name</b> with an optional <b>Roll no.</b> column after it
              (leader first). Other columns are kept and shown at the desk.
            </p>
            <input type="file" name="file" accept=".xlsx,.csv" required className={inputClass} data-testid="list-file" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="replace" /> Replace the teams not admitted yet (otherwise the file is added to the list)
            </label>
          </ActionForm>
        </Panel>
      ) : null}

      <DrawPreview eventId={event.id} />
      <Desk eventId={event.id} list={list} nextFree={nextFree} editable={organiser} canCheckOut={organiser && open} />
    </div>
  );
}
