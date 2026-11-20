import type { Metadata } from "next";
import Link from "next/link";
import { loadTeamContext } from "@/lib/team/context";
import { sectionAllowed } from "@/lib/team/sections";
import { judgingSteps, promptAnchor, publishedPrompts, tierRows, type PublishedPrompt } from "@/lib/team/judging";
import { parseMarkdown } from "@/lib/team/markdown";
import { bp, money } from "@/lib/format";
import { Markdown } from "./markdown";
import { GuidePageTitle, GuidePanel } from "@/components/guide/guide";

export const metadata: Metadata = { title: "Judging" };

const linkClass = "font-semibold underline underline-offset-2";

function PromptPanel({ p }: { p: PublishedPrompt }) {
  return (
    <div id={promptAnchor(p.type)} className="scroll-mt-4" data-testid={`judging-prompt-${p.type}`}>
      <GuidePanel title={`${p.label} prompt`} tag={`AT MOST ${p.wordLimit} WORDS`}>
        {p.prompt.ok ? (
          <>
            <p className="guide-muted">
              The judge&apos;s instructions for every {p.label.toLowerCase()}, from <span className="font-mono">prompts/{p.file}</span>. {p.moves}
            </p>
            <dl className="guide-metric mt-3">
              <dt>
                <small>SHA-256</small>
              </dt>
              <dd className="mt-1.5 break-all font-mono text-[11px]" data-testid={`prompt-sha-${p.type}`}>
                {p.prompt.sha}
              </dd>
            </dl>
            <p className="guide-muted mt-2">
              Every judging run stores the SHA-256 of the prompt it used, so each score can be matched to this exact text; a change of even one
              character gives a different SHA-256.{" "}
              <a href={`data:text/markdown;charset=utf-8,${encodeURIComponent(p.prompt.text)}`} download={p.file} className={linkClass}>
                Download {p.file}
              </a>
            </p>
            <div className="mt-4 border-t border-[var(--line-neutral)] pt-4">
              <Markdown blocks={parseMarkdown(p.prompt.text)} label={`${p.label} prompt`} headingBase={2} />
            </div>
            <details className="mt-4 border-t border-[var(--line-neutral)] pt-3">
              <summary className="guide-btn secondary cursor-pointer">The prompt as plain text</summary>
              <pre className="guide-scroll-box mt-2 whitespace-pre-wrap border border-[var(--line-neutral)] p-3 font-mono text-[11px] leading-relaxed [overflow-wrap:anywhere]">
                {p.prompt.text}
              </pre>
            </details>
          </>
        ) : (
          <p className="guide-alert guide-danger">The {p.label.toLowerCase()} prompt could not be read on the server. Please tell an organiser.</p>
        )}
      </GuidePanel>
    </div>
  );
}

// How the judge scores, for every track at every phase (the brief: "Store the prompts as files in the repo; they will
// be published to teams"): the steps of judging, the score tiers, and the three system prompts exactly as the judge
// receives them, read from prompts/ on the server with the worker's own loader, each with the SHA-256 that every
// judging run stores. Shown as formatted text (lib/team/markdown, never as HTML) and as the plain file.
export default async function TeamJudgingPage() {
  const { team } = await loadTeamContext();
  if (!sectionAllowed(team.track, "/judging")) {
    return (
      <p className="guide-alert">
        How the judge scores is not open to your track.{" "}
        <Link href="/team" className="font-semibold underline">
          Back to Home
        </Link>
      </p>
    );
  }
  const prompts = publishedPrompts();
  return (
    <div className="space-y-4">
      {/* The demo's judging page (app/demo/judging): the page head, then the steps beside the score tiers. */}
      <GuidePageTitle
        as="p"
        eyebrow="REFERENCE / AI JUDGING"
        title="How judging works."
        sub="The steps, the score tiers and the three prompts the judge is given, word for word. The judge sees only the ticker, never team, member or company names."
      />
      <div className="guide-grid two">
      <GuidePanel title="How the judge scores" tag="EVERY SUBMISSION">
        <p className="guide-muted">
          An AI judge scores every PRD, rescue plan and flash answer out of 100 against a published rubric. This is what happens to a
          submission, and below are the three prompts the judge is given, word for word.
        </p>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-[12px]" aria-label="How a submission is judged">
          {judgingSteps().map((s) => (
            <li key={s.title} className="pl-1">
              <b>{s.title}</b> <span className="guide-muted">{s.text}</span>
            </li>
          ))}
        </ol>
        <nav aria-label="The prompts" className="mt-4 flex flex-wrap gap-2">
          {prompts.map((p) => (
            <a key={p.type} href={`#${promptAnchor(p.type)}`} className="guide-chip">
              {p.label} prompt
            </a>
          ))}
        </nav>
      </GuidePanel>

      <GuidePanel title="Score tiers" tag="PRICE MOVE PER SCORE">
        <div data-testid="judging-tiers">
          <div className="overflow-x-auto">
            <table className="guide-table" aria-label="Score tiers">
              <thead>
                <tr>
                  {["Score", "Pitch", "Plan", "Flash"].map((h) => (
                    <th key={h} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tierRows().map((t) => (
                  <tr key={t.band}>
                    <td className="font-mono">
                      <strong>{t.band}</strong>
                    </td>
                    <td className="font-mono">
                      {bp(t.bp.PITCH)}
                      <span className="guide-muted block">IPO {money(t.ipoPrice)}</span>
                    </td>
                    <td className="font-mono">{bp(t.bp.PLAN)}</td>
                    <td className="font-mono">{bp(t.bp.FLASH)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="guide-muted mt-2">
          The change in price for a released score. The pitch tier sets the IPO price; plan and flash tiers apply to both the market price and the AI
          price.
        </p>
      </GuidePanel>
      </div>

      {prompts.map((p) => (
        <PromptPanel key={p.type} p={p} />
      ))}
    </div>
  );
}
