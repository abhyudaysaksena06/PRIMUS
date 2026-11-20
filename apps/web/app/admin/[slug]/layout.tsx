import { ROLE_LABELS } from "@/lib/auth/routes";
import type { Metadata } from "next";
import Link from "next/link";
import { PHASE_LABELS } from "@msim/engine";
import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent, loadEventStatus } from "@/lib/admin/event";
import { ClockProvider } from "@/lib/live/clock";
import { EventChannel } from "@/lib/live/channel";
import { Heartbeat } from "@/lib/live/heartbeat";
import { FeedbackBar, FeedbackProvider } from "@/lib/live/feedback";
import { SignOutButton } from "@/components/sign-out-button";
import { MatrixRain } from "@/components/ui/matrix/matrix-rain";
import { ServerClock } from "@/components/ui/countdown";
import { RealtimeDot } from "@/components/ui/realtime-dot";
import { AdminPageHead, AdminSidebar } from "./nav";

export const metadata: Metadata = { title: { template: "%s · Control panel", default: "Control panel" } };

// Every admin page of one event, in the markup of the /demo organiser console (app/demo/layout.tsx, /demo/admin):
// .guide-app with the rain, a .guide-top bar (PRIMUS ’26, ORGANISER CONSOLE, the event's phase and trading state on
// the left; the clock and the projector, events and sign-out links on the right), the .guide-preview-note line, then
// .guide-content with the section tabs and the section's page head, and the .guide-footer. The event's realtime
// channel refreshes the pages on every broadcast, and the heartbeat (an organiser's console also runs the game
// clock as a backup).
export default async function EventAdminLayout({ children, params }: LayoutProps<"/admin/[slug]">) {
  const { slug } = await params;
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  const status = await loadEventStatus(event.id);
  const organiser = viewer!.role === "ORGANISER";
  const roleLabel = ROLE_LABELS[viewer!.role] ?? "Staff";
  return (
    <ClockProvider serverTime={status.server_time} pausedAt={status.paused ? status.paused_at : null}>
      <EventChannel eventId={event.id} staff>
        <FeedbackProvider>
          <Heartbeat eventId={event.id} area="admin" tick={organiser} />
          <div className="guide-app guide-admin">
            <div className="guide-atmosphere" aria-hidden />
            <MatrixRain opacity={0.28} size={15} className="demo-matrix-rain-fixed" />
            <div className="guide-main" style={{ width: "100%", margin: 0 }}>
              <header className="guide-top">
                <div className="guide-top-left">
                  <span className="guide-team-code">PRIMUS ’26</span>
                  <b className="guide-phase">ORGANISER CONSOLE</b>
                  <h1 className="guide-event-name">{event.name}</h1>
                  <b className="guide-phase">{event.is_rehearsal ? `REHEARSAL ×${event.clock_speed}` : "LIVE"}</b>
                  <b className="guide-phase">{PHASE_LABELS[status.phase].toUpperCase()}</b>
                  <span className="guide-trading" data-state={status.trading}>
                    <i aria-hidden /> TRADING {status.trading}
                  </span>
                </div>
                <div className="guide-top-right">
                  <RealtimeDot />
                  <span className="guide-countdown">
                    <ServerClock /> IST
                  </span>
                  <a href={`/display/${slug}`} target="_blank" rel="noreferrer">
                    PROJECTOR ↗
                  </a>
                  <a href={`/display/${slug}/live`} target="_blank" rel="noreferrer">
                    LIVE WALL ↗
                  </a>
                  <Link href="/admin">ALL EVENTS ↗</Link>
                  <SignOutButton className="no-underline" />
                </div>
              </header>
              <div className="guide-preview-note">
                ORGANISER ENVIRONMENT · {event.is_rehearsal ? "REHEARSAL" : "LIVE EVENT"} · {event.slug.toUpperCase()} ·{" "}
                {viewer!.displayName.toUpperCase()} · {roleLabel.toUpperCase()}
              </div>
              <main className="guide-content">
                <AdminPageHead slug={slug} />
                <AdminSidebar slug={slug} fairness={viewer!.role === "FAIRNESS"} />
                <FeedbackBar className="mb-4" />
                {children}
              </main>
              <footer className="guide-footer">
                <span>PRIMUS ’26 · ORGANISER OPERATIONS</span>
                <span>SERVER CLOCK · IST</span>
              </footer>
            </div>
          </div>
        </FeedbackProvider>
      </EventChannel>
    </ClockProvider>
  );
}
