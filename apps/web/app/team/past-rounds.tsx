// Home: the rounds that are over, each with the team's own submitted text, its score once released and the price move
// (lib/team/past-rounds.ts). Read-only.

import { bp, clock } from "@/lib/format";
import type { PastRound } from "@/lib/team/past-rounds";
import { ContentView } from "./squad/parts";

export function PastRounds({ rounds }: { rounds: PastRound[] }) {
  if (rounds.length === 0) return null;
  return (
    <section className="mx-panel rounded-2xl p-4" aria-label="Past rounds" data-testid="past-rounds">
      <h2 className="text-lg font-extrabold text-phosphor">Past rounds</h2>
      <p className="mt-0.5 text-sm text-muted">What you sent in each finished round, its score once released, and the price move it gave.</p>
      <ul className="mt-3 space-y-3">
        {rounds.map((r) => (
          <li key={r.key} data-testid={`past-${r.key}`}>
            <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-[var(--term-amber)]">{r.title}</h3>
            {r.entries.length === 0 ? <p className="mt-1 text-sm text-muted">No client this round.</p> : null}
            {r.entries.map((e) => (
              <details key={e.key} className="mt-1 border border-line px-3 py-2">
                <summary className="cursor-pointer text-sm">
                  <span className="font-semibold text-phosphor">{e.label}</span>
                  {" · "}
                  {e.submission ? (
                    <span className="text-paper">
                      {e.submission.auto_submitted ? "submitted for you" : "submitted"} at <span className="font-mono">{clock(e.submission.submitted_at)}</span> ({e.submission.word_count}{" "}
                      words)
                    </span>
                  ) : (
                    <span className="text-danger-soft">nothing submitted</span>
                  )}
                  {" · "}
                  <span className={e.score === null ? "text-muted" : "font-semibold text-phosphor"}>{e.score === null ? "score not released yet" : `score ${e.score}/100`}</span>
                  {e.moveBp !== null ? (
                    <>
                      {" · "}
                      <span className={e.moveBp >= 0 ? "text-phosphor" : "text-danger-soft"}>
                        {e.moveOf ?? "price"} {bp(e.moveBp)}
                      </span>
                    </>
                  ) : null}
                </summary>
                <div className="mt-2">{e.submission ? <ContentView type={e.type} content={e.submission.content} /> : <p className="text-sm text-muted">Nothing was submitted.</p>}</div>
              </details>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
