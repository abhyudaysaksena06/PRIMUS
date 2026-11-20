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

// Every admin page of one event, in the /demo organiser console's look (admin.css): the sidebar of sections, a top
// bar with the phase, trading state and server clock, the section's page head; the event's realtime channel (pages refresh on every broadcast) and the heartbeat (an organiser's console also runs
// the game clock as a backup).
export default async function EventAdminLayout({ children, params }: LayoutProps<"/admin/[slug]">) {
  const { slug } = await params;
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  const status = await loadEventStatus(event.id);
  const organiser = viewer!.role === "ORGANISER";
  return (
    <ClockProvider serverTime={status.server_time} pausedAt={status.paused ? status.paused_at : null}>
      <EventChannel eventId={event.id} staff>
        <FeedbackProvider>
        <Heartbeat eventId={event.id} area="admin" tick={organiser} />
        <div className="adm-app">
          <div className="adm-atmosphere" aria-hidden />
          <MatrixRain opacity={0.2} size={15} tone="green" className="adm-rain" />
          <AdminSidebar
            slug={slug}
            fairness={viewer!.role === "FAIRNESS"}
            who={viewer!.displayName}
            roleLabel={organiser ? "Organiser" : "Fairness officer"}
            signOut={<SignOutButton />}
          />
          <div className="adm-main">
            <header className="adm-top">
              <div className="adm-top-left">
                <Link href="/admin">Events</Link>
                <span className="text-[#5f6672]" aria-hidden>
                  /
                </span>
                <span className="adm-code" aria-hidden>
                  PRIMUS ’26
                </span>
                <h1 className="adm-event-name">{event.name}</h1>
                {event.is_rehearsal ? (
                  <span className="adm-pill violet">Rehearsal ×{event.clock_speed}</span>
                ) : (
                  <span className="adm-pill green">Live</span>
                )}
                <span className="adm-pill gold">{PHASE_LABELS[status.phase]}</span>
                <span className={`adm-pill ${status.trading === "OPEN" ? "green" : status.trading === "PAUSED" ? "amber" : ""}`}>{status.trading}</span>
              </div>
              <div className="adm-top-right">
                <RealtimeDot />
                <span className="adm-clock">
                  <ServerClock className="text-base font-semibold" />
                  <small>IST</small>
                </span>
              </div>
            </header>
            <div className="adm-note">
              <span>
                Organiser console · {event.is_rehearsal ? "rehearsal" : "live event"} · {event.slug}
              </span>
              <span className="flex flex-wrap gap-4">
                <a href={`/display/${slug}`} target="_blank" rel="noreferrer">
                  Projector ↗
                </a>
                <a href={`/display/${slug}/live`} target="_blank" rel="noreferrer">
                  Live wall ↗
                </a>
              </span>
            </div>
            <FeedbackBar className="mx-auto w-[min(100%,1500px)] px-7 pt-4" />
            <main className="adm-content">
              <AdminPageHead slug={slug} />
              {children}
            </main>
            <footer className="adm-footer">
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
