// The judge's case briefs: prompts/cases/<sector>/{problem,crisis-<category>,statement-<NN>}.md, one neutral brief per
// problem card, crisis card and Round 3 statement (judge-only context, never shown to teams: crisis cards stay sealed
// until hiring closes). A brief's first line is `# <the card's title>`.
//
// The brief for a run is found from what judge_input already carries:
// - PITCH: the problem card's sector folder (problem.md), or failing that the brief whose title is the card's title;
// - CRISIS_k, ADVICE_k (k 1-4): the crisis brief whose title is the card's title and whose file is crisis-<category>.md
//   (the crisis card in judge_input has no sector, and its title is unique across the deck);
// - SOLUTION, ADVICE_5: the statement brief whose title is the statement's title, or failing that statement-<NN>.md
//   in the folder of the sector the statement's body opens with ("FMCG · Round 3. …").
// No brief (no file, an edited title, a sector not in prompts/cases/): the request is built exactly as without briefs.
// When a brief is sent, the run's prompt_sha is the SHA-256 of the system prompt followed directly by the brief's text
// (`cat prompts/PITCH.md prompts/cases/fmcg/problem.md | sha256sum`), so the record names both.
// Dynamic filesystem paths opt out of Turbopack tracing: next.config.ts traces prompts/cases/ in for the worker route.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { findPromptsDir, sha256Hex } from "./prompts";
import type { JudgeInput } from "./types";

export interface CaseBrief {
  /** Path relative to prompts/, e.g. "cases/fmcg/problem.md". */
  file: string;
  /** The brief, exactly as stored in the file. */
  text: string;
}

export interface CaseBriefIndex {
  /** Every brief, by its path relative to prompts/cases/ ("fmcg/crisis-trust.md"). */
  byPath: ReadonlyMap<string, CaseBrief>;
}

/** A title compared loosely: case, quotes, punctuation and spacing do not matter. */
export function normTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The `# Title` on a brief's first non-empty line, or "". */
export function briefTitle(text: string): string {
  const first = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const m = /^#\s+(.+?)\s*$/.exec(first);
  return m ? m[1]! : "";
}

/** A sector as a folder name: "FMCG" -> "fmcg". */
export function sectorFolder(sector: string | null | undefined): string {
  return (sector ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Builds an index from {relative path: text}. Pure. */
export function caseBriefIndex(files: Record<string, string>): CaseBriefIndex {
  const byPath = new Map<string, CaseBrief>();
  for (const [rel, text] of Object.entries(files)) {
    if (text.trim() === "") continue;
    byPath.set(rel, { file: `cases/${rel}`, text });
  }
  return { byPath };
}

function byTitle(index: CaseBriefIndex, title: string, file: (rel: string) => boolean): CaseBrief | null {
  const want = normTitle(title);
  if (want === "") return null;
  for (const [rel, brief] of index.byPath) {
    if (file(rel) && normTitle(briefTitle(brief.text)) === want) return brief;
  }
  return null;
}

const baseName = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1);

/** The brief for a run's input, or null. Pure. */
export function findCaseBrief(input: JudgeInput, index: CaseBriefIndex): CaseBrief | null {
  const type = input.type;
  if (type === "PITCH") {
    const card = input.problem_card;
    if (!card) return null;
    const folder = sectorFolder(card.sector);
    return (folder ? index.byPath.get(`${folder}/problem.md`) : undefined) ?? byTitle(index, card.title, (rel) => baseName(rel) === "problem.md");
  }
  if (type === "SOLUTION" || type === "ADVICE_5") {
    const s = input.statement;
    if (!s) return null;
    const hit = byTitle(index, s.title, (rel) => baseName(rel).startsWith("statement-"));
    if (hit) return hit;
    // The title was edited: the number, in the folder of the sector the statement's body names first.
    const sector = /^\s*([^·\n]+?)\s*·/.exec(s.body ?? "")?.[1];
    const folder = sectorFolder(sector);
    if (!folder || !Number.isSafeInteger(s.number) || s.number < 1) return null;
    return index.byPath.get(`${folder}/statement-${String(s.number).padStart(2, "0")}.md`) ?? null;
  }
  if (/^(CRISIS|ADVICE)_[1-4]$/.test(type)) {
    const card = input.crisis_card;
    if (!card) return null;
    const file = `crisis-${sectorFolder(card.category)}.md`;
    return byTitle(index, card.title, (rel) => baseName(rel) === file);
  }
  return null;
}

/** Reads every prompts/cases/<sector>/*.md under `promptsDir`; an empty index when there is no cases folder. */
export function readCaseBriefs(promptsDir: string): CaseBriefIndex {
  const root = path.join(/* turbopackIgnore: true */ promptsDir, "cases");
  const files: Record<string, string> = {};
  if (!existsSync(/* turbopackIgnore: true */ root)) return caseBriefIndex(files);
  for (const sector of readdirSync(/* turbopackIgnore: true */ root)) {
    const dir = path.join(/* turbopackIgnore: true */ root, sector);
    if (!statSync(/* turbopackIgnore: true */ dir).isDirectory()) continue;
    for (const name of readdirSync(/* turbopackIgnore: true */ dir)) {
      if (!name.endsWith(".md")) continue;
      files[`${sector}/${name}`] = readFileSync(/* turbopackIgnore: true */ path.join(dir, name), "utf8");
    }
  }
  return caseBriefIndex(files);
}

/**
 * A lookup bound to one prompts folder, read once on first use (the worker calls it for every run). Never throws:
 * a folder that cannot be read means no briefs, so judging goes on exactly as without them.
 */
export function caseBriefLoader(dir?: string, log?: (line: string) => void): (input: JudgeInput) => CaseBrief | null {
  let index: CaseBriefIndex | null = null;
  return (input) => {
    if (!index) {
      try {
        index = readCaseBriefs(dir ?? findPromptsDir());
      } catch (e) {
        log?.(`case briefs not read, judging without them: ${e instanceof Error ? e.message : String(e)}`);
        index = caseBriefIndex({});
      }
    }
    return findCaseBrief(input, index);
  };
}

/** The prompt_sha of a run: the system prompt's own SHA-256 without a brief, else that of the prompt then the brief. */
export function runPromptSha(prompt: { text: string; sha: string }, brief: CaseBrief | null | undefined): string {
  return brief ? sha256Hex(prompt.text + brief.text) : prompt.sha;
}
