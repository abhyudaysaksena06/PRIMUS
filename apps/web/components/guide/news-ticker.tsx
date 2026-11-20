"use client";

// The demo's bottom news ticker (app/demo/event-news-ticker.tsx), same markup and classes, fed with the event's real
// bulletins and crisis notices. Nothing published yet: one quiet line instead of made-up news.

import Link from "next/link";
import { Pause, Play } from "lucide-react";
import { useState } from "react";
import "@/app/demo/event-news-ticker.css";

export interface TickerStory {
  id: string;
  /** "HH:MM" in IST. */
  time: string | null;
  type: string;
  title: string;
}

export function NewsTicker({ stories, href, testId }: { stories: readonly TickerStory[]; href: string; testId?: string }) {
  const [paused, setPaused] = useState(false);
  const list = stories.length ? stories : [{ id: "none", time: null, type: "NEWS", title: "No bulletins yet. Announcements appear here as they are published." }];
  // One story moves slowly; repeat short lists so the belt is never mostly empty.
  const sets = list.length < 3 ? [...list, ...list, ...list] : list;
  return (
    <div className="event-news-ticker" aria-label="PRIMUS event news ticker" role="region">
      <span className="event-news-label" aria-hidden="true">
        Event news
      </span>
      <Link href={href} className="event-news-window" aria-label="Read event news" data-testid={testId}>
        <span className="event-news-belt" data-paused={paused} aria-hidden="true">
          {[0, 1].map((copy) => (
            <span className="event-news-set" key={copy}>
              {sets.map((story, i) => (
                <span className="event-news-headline" key={`${story.id}-${i}`}>
                  {story.time ? <span className="event-news-time">{story.time} IST</span> : null}
                  <strong>{story.type}</strong>
                  <span>{story.title}</span>
                </span>
              ))}
            </span>
          ))}
        </span>
        {/* The words for screen readers (the belt itself is decoration). */}
        <span className="sr-only">{list[0].title}</span>
      </Link>
      <button
        type="button"
        className="event-news-toggle"
        aria-label={paused ? "Resume news ticker" : "Pause news ticker"}
        onClick={() => setPaused(!paused)}
      >
        {paused ? <Play aria-hidden="true" size={15} /> : <Pause aria-hidden="true" size={15} />}
      </button>
    </div>
  );
}
