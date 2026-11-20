import { ROLE_LABELS } from "@/lib/auth/routes";
import Link from "next/link";
import { PHASE_LABELS, type PhaseCode } from "@msim/engine";
import { currentViewer } from "@/lib/auth/viewer";
import { supabaseServer } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";
import { MatrixRain } from "@/components/ui/matrix/matrix-rain";
import { dateTime } from "@/lib/format";

// The events this account can run (the live night and any rehearsal), in the markup of the /demo organiser
// console: .guide-app, a .guide-top bar, the preview note, a page head and one .guide-metric card per event.
export default async function AdminHome() {
  const viewer = (await currentViewer())!;
  const sb = await supabaseServer();
  const { data: events } = await sb
    .from("events")
    .select("slug, name, is_rehearsal, clock_speed, starts_at, current_phase, paused")
    .order("is_rehearsal")
    .order("starts_at");
  return (
    <div className="guide-app guide-admin">
      <div className="guide-atmosphere" aria-hidden />
      <MatrixRain opacity={0.28} size={15} className="demo-matrix-rain-fixed" />
      <div className="guide-main" style={{ width: "100%", margin: 0 }}>
        <header className="guide-top">
          <div className="guide-top-left">
            <span className="guide-team-code">PRIMUS ’26</span>
            <b className="guide-phase">ORGANISER CONSOLE</b>
            <span>
              {viewer.displayName} · {ROLE_LABELS[viewer.role] ?? "Staff"}
            </span>
          </div>
          <div className="guide-top-right">
            <SignOutButton className="no-underline" />
          </div>
        </header>
        <div className="guide-preview-note">ORGANISER ENVIRONMENT · PICK AN EVENT</div>
        <main className="guide-content">
          <div className="guide-page-head">
            <small>ORGANISER / EVENT CONTROL</small>
            <h1>Control panel</h1>
            <p>Pick the event to run: the live night or a rehearsal. Every button inside acts on that event only.</p>
          </div>
          <section aria-label="Events" className="guide-panel">
            <div className="guide-panel-head">
              <h2>Events</h2>
              <span>ORGANISER ONLY</span>
            </div>
            <div className="guide-panel-body">
              {!events?.length ? (
                <p className="guide-muted">No event has been seeded yet (see the README, “Seed an event”).</p>
              ) : (
                <div className="guide-grid two">
                  {events.map((e) => (
                    <Link key={e.slug} href={`/admin/${e.slug}/run`} className="guide-metric guide-metric-link">
                      <small aria-hidden>&gt; ./{e.slug}</small>
                      <b>{e.name}</b>
                      <span className="flex flex-wrap items-center gap-2">
                        <i className="guide-chip" data-tone={e.is_rehearsal ? "violet" : "green"}>
                          {e.is_rehearsal ? `Rehearsal ×${e.clock_speed}` : "Live"}
                        </i>
                        {PHASE_LABELS[e.current_phase as PhaseCode]}
                        {e.paused ? (
                          <i className="guide-chip" data-tone="amber">
                            Paused
                          </i>
                        ) : null}
                        <em className="guide-muted not-italic">Starts {dateTime(e.starts_at)} IST</em>
                        <em className="ml-auto not-italic" aria-hidden>
                          OPEN ↗
                        </em>
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </section>
        </main>
        <footer className="guide-footer">
          <span>PRIMUS ’26 · ORGANISER OPERATIONS</span>
          <span>SERVER CLOCK · IST</span>
        </footer>
      </div>
    </div>
  );
}
