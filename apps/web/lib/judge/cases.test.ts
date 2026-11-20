import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import config from "../../next.config";
import { briefTitle, caseBriefIndex, caseBriefLoader, findCaseBrief, normTitle, readCaseBriefs, runPromptSha, sectorFolder } from "./cases";
import { fakeJudge } from "./fake";
import { buildJudgeRequest, CASE_BRIEF_NOTE } from "./request";
import type { JudgeInput, JudgeRequest, RunResult } from "./types";
import { runWorker, type JudgeDb } from "./worker";

const REPO = path.join(__dirname, "../../../..");
const PROMPTS_DIR = path.join(REPO, "prompts");
const SECTORS = path.join(REPO, "seed/sectors");

/** A minimal RFC 4180 CSV reader (quoted fields may hold commas, quotes and newlines). */
function readCsv(file: string): Record<string, string>[] {
  const text = readFileSync(file, "utf8");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) rows.push([...row, field]);
  const [head, ...body] = rows.filter((r) => r.some((f) => f !== ""));
  return body.map((r) => Object.fromEntries(head!.map((h, i) => [h, r[i] ?? ""])));
}

const base: JudgeInput = {
  run_id: "run-1",
  type: "PITCH",
  ticker: "AQS",
  company_name: "AquaSense",
  names: ["AquaSense"],
  submission_id: "sub-1",
  submission_text: "Our answer.",
  injections_recorded: true,
};

const index = caseBriefIndex({
  "fmcg/problem.md": "# Fast-moving consumer goods\n\nFMCG problem brief.\n",
  "aviation/problem.md": "# The Empty Runway\n\nAviation problem brief.\n",
  "fmcg/crisis-market.md": "# The secret ingredient\n\nFMCG market brief.\n",
  "aviation/crisis-market.md": "# The giant comes to town\n\nAviation market brief.\n",
  "fmcg/statement-03.md": "# Plastic-free packaging that costs under Rs 1 more per pack\n\nStatement 3 brief.\n",
  "luxury/statement-23.md": "# Prove any luxury item is genuine in seconds\n\nStatement 23 brief.\n",
});

const crisisCard = { category: "Market", title: "The giant comes to town", body: "The national airline…" };
const statement = { number: 3, title: "Plastic-free packaging that costs under Rs 1 more per pack", body: "FMCG · Round 3. Plastic-free…" };

describe("findCaseBrief", () => {
  test("a PITCH gets its sector's problem brief (sector in any case)", () => {
    const b = findCaseBrief({ ...base, problem_card: { sector: "Aviation", title: "Anything", body: "…" } }, index);
    expect(b?.file).toBe("cases/aviation/problem.md");
    expect(findCaseBrief({ ...base, problem_card: { sector: " fmcg ", title: "x", body: "" } }, index)?.file).toBe("cases/fmcg/problem.md");
  });

  test("a PITCH with no sector finds its brief by title; a PITCH with no card (one-case events, calibration) gets none", () => {
    expect(findCaseBrief({ ...base, problem_card: { sector: null, title: "Fast-Moving Consumer Goods!", body: "" } }, index)?.file).toBe(
      "cases/fmcg/problem.md",
    );
    expect(findCaseBrief(base, index)).toBeNull();
    expect(findCaseBrief({ ...base, problem_card: { sector: "Energy", title: "Power to the people", body: "" } }, index)).toBeNull();
  });

  test("CRISIS_2 and ADVICE_2 get the crisis brief of their card (by title and category, across sectors)", () => {
    for (const type of ["CRISIS_2", "ADVICE_2"] as const) {
      expect(findCaseBrief({ ...base, type, crisis_card: crisisCard }, index)?.file).toBe("cases/aviation/crisis-market.md");
    }
    // Same category in another sector: the title decides.
    expect(findCaseBrief({ ...base, type: "CRISIS_2", crisis_card: { ...crisisCard, title: "The Secret Ingredient" } }, index)?.file).toBe(
      "cases/fmcg/crisis-market.md",
    );
  });

  test("a crisis card whose title or category matches no brief gets none", () => {
    expect(findCaseBrief({ ...base, type: "CRISIS_2", crisis_card: { ...crisisCard, title: "Factory fire" } }, index)).toBeNull();
    expect(findCaseBrief({ ...base, type: "CRISIS_2", crisis_card: { ...crisisCard, category: "Trust" } }, index)).toBeNull();
    expect(findCaseBrief({ ...base, type: "CRISIS_2", crisis_card: null }, index)).toBeNull();
  });

  test("SOLUTION and ADVICE_5 get their statement's brief; an edited title falls back to the number in the body's sector", () => {
    for (const type of ["SOLUTION", "ADVICE_5"] as const) {
      expect(findCaseBrief({ ...base, type, statement }, index)?.file).toBe("cases/fmcg/statement-03.md");
    }
    expect(findCaseBrief({ ...base, type: "SOLUTION", statement: { ...statement, title: "Plastic-free packs" } }, index)?.file).toBe(
      "cases/fmcg/statement-03.md",
    );
    // An Energy statement numbered 23 (another sector mix) does not get Luxury's statement 23.
    expect(findCaseBrief({ ...base, type: "SOLUTION", statement: { number: 23, title: "Grid storage", body: "Energy · Round 3. Grid storage." } }, index)).toBeNull();
    expect(findCaseBrief({ ...base, type: "SOLUTION", statement: null }, index)).toBeNull();
  });

  test("MEMO, PLAN and FLASH get no brief", () => {
    for (const type of ["MEMO", "PLAN", "FLASH"] as const) {
      expect(findCaseBrief({ ...base, type, crisis_card: crisisCard, problem_card: { sector: "FMCG", title: "x", body: "" } }, index)).toBeNull();
    }
  });

  test("titles, headings and folders", () => {
    expect(normTitle("  The “Ambassador”  Scandal! ")).toBe("the ambassador scandal");
    expect(briefTitle("\n# Grounded at Dawn\n\nText")).toBe("Grounded at Dawn");
    expect(briefTitle("No heading")).toBe("");
    expect(sectorFolder("FMCG")).toBe("fmcg");
  });
});

describe("buildJudgeRequest with a case brief", () => {
  const brief = { file: "cases/fmcg/problem.md", text: "# Title\n\nCriteria: numbers & <constraints>.\n" };

  test("the brief comes first, in <case_brief> after a note that it is context, before the context and the submission", () => {
    const r = buildJudgeRequest({ ...base, problem_card: { sector: "FMCG", title: "T", body: "B" } }, "SYS", brief);
    const t = r.userText;
    expect(t.startsWith(`${CASE_BRIEF_NOTE}\n<case_brief>\n# Title`)).toBe(true);
    expect(t).toContain("Criteria: numbers &amp; &lt;constraints&gt;.\n</case_brief>");
    expect(t.indexOf("</case_brief>")).toBeLessThan(t.indexOf("<context>"));
    expect(t.indexOf("</case_brief>")).toBeLessThan(t.indexOf("<submission"));
    expect(r.requestText).toBe(t);
    expect(r.caseBrief).toBe(brief);
    expect(r.system).toBe("SYS");
  });

  test("without a brief (or with an empty one) the request is exactly as before", () => {
    const input = { ...base, problem_card: { sector: "FMCG", title: "T", body: "B" } };
    const plain = buildJudgeRequest(input, "SYS");
    expect(plain.userText).not.toContain("case_brief");
    expect(plain.caseBrief).toBeNull();
    expect(buildJudgeRequest(input, "SYS", null).userText).toBe(plain.userText);
    expect(buildJudgeRequest(input, "SYS", { file: "x", text: "  \n" }).userText).toBe(plain.userText);
  });
});

describe("runPromptSha", () => {
  test("the prompt's own SHA without a brief; the SHA of the prompt then the brief with one", () => {
    const prompt = { text: "RUBRIC\n", sha: "own-sha" };
    expect(runPromptSha(prompt, null)).toBe("own-sha");
    const expected = createHash("sha256").update("RUBRIC\n# Brief\n", "utf8").digest("hex");
    expect(runPromptSha(prompt, { file: "f", text: "# Brief\n" })).toBe(expected);
  });
});

describe("the briefs on disk", () => {
  const disk = readCaseBriefs(PROMPTS_DIR);

  test("every problem card has its sector's problem brief, titled with the card's title", () => {
    const cards = readCsv(path.join(SECTORS, "problem-cards.csv"));
    expect(cards).toHaveLength(3);
    for (const c of cards) {
      const b = findCaseBrief({ ...base, problem_card: { sector: c.sector!, title: c.title!, body: c.body! } }, disk);
      expect(b?.file, c.sector).toBe(`cases/${sectorFolder(c.sector)}/problem.md`);
      expect(normTitle(briefTitle(b!.text))).toBe(normTitle(c.title!));
    }
  });

  test("every crisis card has its brief, found for both the plan and the firm's memo", () => {
    const cards = readCsv(path.join(SECTORS, "crisis-cards.csv"));
    expect(cards).toHaveLength(12);
    for (const c of cards) {
      const file = `cases/${sectorFolder(c.sector)}/crisis-${c.category!.toLowerCase()}.md`;
      for (const type of [`CRISIS_${c.number}`, `ADVICE_${c.number}`] as const) {
        const b = findCaseBrief({ ...base, type: type as JudgeInput["type"], crisis_card: { category: c.category!, title: c.title!, body: c.body! } }, disk);
        expect(b?.file, `${c.sector} ${c.category} ${type}`).toBe(file);
      }
    }
  });

  test("every Round 3 statement has its brief, statement-<NN>.md, found for the solution and the firm's memo", () => {
    const rows = readCsv(path.join(SECTORS, "statements.csv"));
    expect(rows).toHaveLength(30);
    for (const s of rows) {
      const n = Number(s.number);
      const file = `cases/${sectorFolder(s.sector)}/statement-${String(n).padStart(2, "0")}.md`;
      for (const type of ["SOLUTION", "ADVICE_5"] as const) {
        const b = findCaseBrief({ ...base, type, statement: { number: n, title: s.title!, body: s.body! } }, disk);
        expect(b?.file, `${s.sector} ${n}`).toBe(file);
      }
    }
  });

  test("end to end: PITCH, CRISIS_2, ADVICE_2, SOLUTION and ADVICE_5 each carry the right brief before the submission", () => {
    const cases: [JudgeInput, string][] = [
      [{ ...base, type: "PITCH", problem_card: { sector: "Luxury", title: "Reengineering the next era of luxury", body: "…" } }, "# Reengineering the next era of luxury"],
      [{ ...base, type: "CRISIS_2", pitch_text: "PRD", crisis_card: crisisCard }, "# The giant comes to town"],
      [{ ...base, type: "ADVICE_2", pitch_text: "PRD", crisis_card: { category: "Market", title: "The next-generation exodus", body: "…" } }, "# The next-generation exodus"],
      [{ ...base, type: "SOLUTION", statement }, "# Plastic-free packaging that costs under Rs 1 more per pack"],
      [{ ...base, type: "ADVICE_5", pitch_text: "PRD", statement: { number: 14, title: "Halve fog cancellations at a North-East airport", body: "Aviation · Round 3." } }, "# Halve fog cancellations"],
    ];
    for (const [input, heading] of cases) {
      const r = buildJudgeRequest(input, "SYS", findCaseBrief(input, disk));
      expect(r.caseBrief, input.type).not.toBeNull();
      const t = r.userText;
      expect(t.indexOf(`<case_brief>\n${heading}`), input.type).toBeGreaterThan(0);
      expect(t.indexOf("</case_brief>"), input.type).toBeLessThan(t.indexOf("<submission"));
    }
  });

  test("there are exactly the 45 briefs, each with the four sections", () => {
    expect(disk.byPath.size).toBe(45);
    for (const [rel, b] of disk.byPath) {
      for (const h of ["## The case in brief", "## What a strong answer addresses", "## Common weak answers", "## Fairness reminders"]) {
        expect(b.text, `${rel} ${h}`).toContain(h);
      }
    }
  });

  test("the worker route traces the briefs in; no other route (no team page) does", () => {
    const includes = config.outputFileTracingIncludes!;
    expect(includes["/api/judge/work"]).toContain("../../prompts/cases/**/*.md");
    for (const [route, globs] of Object.entries(includes)) {
      if (route === "/api/judge/work") continue;
      expect(globs.some((g) => g.includes("cases") || g.includes("**")), route).toBe(false);
    }
  });
});

describe("caseBriefLoader", () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  test("reads prompts/cases/ once; no folder means no briefs", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "judge-cases-"));
    dirs.push(dir);
    const load = caseBriefLoader(dir);
    expect(load({ ...base, problem_card: { sector: "FMCG", title: "x", body: "" } })).toBeNull();

    mkdirSync(path.join(dir, "cases", "fmcg"), { recursive: true });
    writeFileSync(path.join(dir, "cases", "fmcg", "problem.md"), "# FMCG\n\nBrief.\n");
    const fresh = caseBriefLoader(dir);
    expect(fresh({ ...base, problem_card: { sector: "FMCG", title: "x", body: "" } })?.text).toBe("# FMCG\n\nBrief.\n");
    expect(existsSync(path.join(dir, "cases"))).toBe(true);
  });
});

describe("runWorker with case briefs", () => {
  function oneRun(input: Partial<JudgeInput>) {
    const reports: RunResult[] = [];
    let claimed = false;
    const db: JudgeDb = {
      claimRuns: async () => {
        if (claimed) return [];
        claimed = true;
        return [{ run_id: "run-1", submission_id: "sub-1", company_id: "co-1", type: input.type ?? "PITCH", generation: 1, run_no: 1, attempts: 1, claim_token: 1, slot: "PRIMARY" }];
      },
      input: async () => ({ ...base, ...input }),
      recordInjections: async () => {},
      finish: async (_id, result) => {
        reports.push(result);
        return { ok: true, status: "DONE" };
      },
      claimCalibration: async () => [],
      calibrationInput: async () => {
        throw new Error("none");
      },
      finishCalibration: async () => ({ ok: true, status: "DONE" }),
    };
    return { db, reports };
  }
  const prompts = () => ({ text: "RUBRIC", sha: "rubric-sha" });

  test("the brief is sent before the submission and folded into prompt_sha", async () => {
    const { db, reports } = oneRun({ type: "CRISIS_2", crisis_card: crisisCard, pitch_text: "PRD" });
    const requests: JudgeRequest[] = [];
    const inner = fakeJudge({ latencyMs: 0 });
    await runWorker({ db, judge: async (r) => (requests.push(r), inner(r)), budgetMs: 5000, concurrency: 1, models: { PRIMARY: "m", BACKUP: "b" }, prompts, caseBriefs: (i) => findCaseBrief(i, index) });
    expect(requests[0]!.userText.indexOf("<case_brief>")).toBeGreaterThanOrEqual(0);
    expect(requests[0]!.userText.indexOf("Aviation market brief.")).toBeLessThan(requests[0]!.userText.indexOf("<submission"));
    expect(reports[0]).toMatchObject({ ok: true, prompt_sha: createHash("sha256").update("RUBRIC# The giant comes to town\n\nAviation market brief.\n").digest("hex") });
  });

  test("no brief, or a lookup that throws: judged exactly as without briefs", async () => {
    for (const caseBriefs of [() => null, () => { throw new Error("disk gone"); }]) {
      const { db, reports } = oneRun({ type: "PITCH" });
      const requests: JudgeRequest[] = [];
      const inner = fakeJudge({ latencyMs: 0 });
      await runWorker({ db, judge: async (r) => (requests.push(r), inner(r)), budgetMs: 5000, concurrency: 1, models: { PRIMARY: "m", BACKUP: "b" }, prompts, caseBriefs });
      expect(requests[0]!.userText).toBe(buildJudgeRequest({ ...base, type: "PITCH" }, "RUBRIC").userText);
      expect(reports[0]).toMatchObject({ ok: true, prompt_sha: "rubric-sha" });
    }
  });
});
