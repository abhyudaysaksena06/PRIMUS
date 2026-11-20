import Link from "next/link";
import { PHASE_LABELS, type PhaseCode } from "@msim/engine";
import { currentViewer } from "@/lib/auth/viewer";
import { supabaseServer } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";
import { MatrixRain } from "@/components/ui/matrix/matrix-rain";
import { dateTime } from "@/lib/format";

// The events this account can run: the live night and any rehearsal, in the /demo organiser console's look.
export default async function AdminHome() {
  const viewer = (await currentViewer())!;
  const sb = await supabaseServer();
  const { data: events } = await sb
    .from("events")
    .select("slug, name, is_rehearsal, clock_speed, starts_at, current_phase, paused")
    .order("is_rehearsal")
    .order("starts_at");
  return (
    <div className="adm-app">
      <div className="adm-atmosphere" aria-hidden />
      <MatrixRain opacity={0.2} size={15} tone="green" className="adm-rain" />
      <header className="adm-top relative z-10">
        <div className="adm-top-left">
          <span className="adm-code">PRIMUS ’26</span>
          <span className="adm-pill gold">Organiser console</span>
          <span className="text-[13px] text-[#9ba2ad]">
            {viewer.displayName} · {viewer.role === "FAIRNESS" ? "Fairness officer" : "Organiser"}
          </span>
        </div>
        <div className="adm-top-right adm-side-links">
          <SignOutButton />
        </div>
      </header>
      <main className="adm-index">
        <div className="adm-head">
          <small>Organiser / event control</small>
          <h1 className="adm-title">Control panel</h1>
          <p>Pick the event to run: the live night or a rehearsal. Every button inside acts on that event only.</p>
        </div>
        <section aria-label="Events">
          <p className="adm-mono-label mb-3">Events</p>
          {!events?.length ? (
            <div className="adm-metric">
              <p className="text-sm text-[#cbd0d9]">No event has been seeded yet (see the README, “Seed an event”).</p>
            </div>
          ) : (
            <div className="grid gap-[14px] md:grid-cols-2">
              {events.map((e) => (
                <Link
                  key={e.slug}
                  href={`/admin/${e.slug}/run`}
                  className="adm-metric flex flex-col justify-between gap-3 transition-colors hover:border-[rgba(255,216,77,.45)]"
                >
                  <span>
                    <span className="adm-label block" aria-hidden>
                      &gt; ./{e.slug}
                    </span>
                    <span className="adm-value block">{e.name}</span>
                    <span className="flex flex-wrap items-center gap-2">
                      {e.is_rehearsal ? <span className="adm-pill violet">Rehearsal ×{e.clock_speed}</span> : <span className="adm-pill green">Live</span>}
                      <span className="text-[13px] text-[#9ba2ad]">Starts {dateTime(e.starts_at)} IST</span>
                    </span>
                  </span>
                  <span className="adm-delta flex flex-wrap items-center gap-2">
                    {PHASE_LABELS[e.current_phase as PhaseCode]}
                    {e.paused ? <span className="adm-pill amber">Paused</span> : null}
                    <span className="ml-auto" aria-hidden>
                      OPEN ↗
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
