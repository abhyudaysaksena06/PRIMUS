import Link from "next/link";
import { redirect } from "next/navigation";
import { PHASE_LABELS, type PhaseCode } from "@msim/engine";
import { supabaseServer } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";
import { MatrixRain } from "@/components/ui/matrix/matrix-rain";
import { dateTime } from "@/lib/format";

// Which event the projector shows. With a single event it goes straight there; otherwise the operator picks (the
// live night first, then rehearsals). Drawn as the /demo projector page: its page head and a .guide-metric per event.
export default async function DisplayHome() {
  const sb = await supabaseServer();
  const { data: events } = await sb
    .from("events")
    .select("slug, name, is_rehearsal, clock_speed, starts_at, current_phase")
    .order("is_rehearsal")
    .order("starts_at");
  if (events?.length === 1) redirect(`/display/${events[0]!.slug}`);
  return (
    <div className="demo-stage-screen guide-display-index relative min-h-screen bg-[#030805] p-6 md:p-10">
      <MatrixRain opacity={0.34} size={16} className="demo-matrix-rain-fixed" />
      <div className="relative z-10">
        <div className="guide-page-head flex items-start justify-between gap-6">
          <div>
            <small>PUBLIC STAGE OUTPUT / PROJECTOR MODE</small>
            <h1>Big screen</h1>
            <p>Pick the event this screen shows.</p>
          </div>
          <SignOutButton className="guide-btn secondary no-underline" />
        </div>
        {!events?.length ? (
          <p className="guide-muted">No event has been seeded yet.</p>
        ) : (
          <div className="guide-grid two">
            {events.map((e) => (
              <Link key={e.slug} href={`/display/${e.slug}`} className="guide-metric block no-underline">
                <small>{e.is_rehearsal ? `REHEARSAL ×${e.clock_speed}` : "LIVE"}</small>
                <b>{e.name}</b>
                <span>
                  {PHASE_LABELS[e.current_phase as PhaseCode].toUpperCase()} · STARTS {dateTime(e.starts_at)} IST
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
