import { expect, test } from "@playwright/test";
import type pg from "pg";
import { e2ePool, seedE2eEvent, type E2eEvent } from "./support/event";
import { drawn } from "./support/game";
import { loginAsTeam } from "./support/login";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 900 } });

// The Round 1 practice market (laptop): before Round 1 it says when it opens; in Round 1 a Finance team trades the
// scripted candlestick market (the Do-this-now task leads there, the chart and the patterns show, a BUY fills and the
// account follows); when Round 1 ends the top funds win a $50,000 prize in real cash and the page shows the result.
//
// The team-code prefix U is shared with admin-run and display-takeovers: the files take turns (an advisory
// lock), and each purges the others' events first.
let ev: E2eEvent;
let turn: pg.PoolClient | undefined;
let fund = "";

test.beforeAll(async () => {
  test.setTimeout(300_000);
  turn = await e2ePool().connect();
  await turn.query("select pg_advisory_lock(hashtext('e2e-common-U'))");
  await turn.query("select public.purge_event($1)", ["e2e-run"]);
  await turn.query("select public.purge_event($1)", ["e2e-display-takeovers"]);
  ev = await seedE2eEvent({ slug: "e2e-team-practice", prefix: "U", format: "PRIMUS" });
  fund = ev.plan.teams.find((t) => t.track === "FINANCE")!.code;
});

test.afterAll(async () => {
  await turn?.query("select pg_advisory_unlock(hashtext('e2e-common-U'))");
  turn?.release();
});

test("before Round 1 the practice market says when it opens", async ({ page }) => {
  await loginAsTeam(page, ev, fund);
  await page.goto("/team/trade/practice");
  await expect(page.getByTestId("practice-notice")).toContainText("The practice market opens with Round 1");
});

test("in Round 1 a fund trades the candlestick market and a top finish wins the prize", async ({ page }) => {
  test.setTimeout(240_000);
  await drawn(ev);
  await ev.n.advanceTo("BUILD");
  // The market started ten minutes ago, so the chart has twenty candles.
  await ev.n.q("update phases set started_at = now() - interval '10 minutes' where event_id = $1 and code = 'BUILD'", [ev.n.eventId]);

  await loginAsTeam(page, ev, fund);
  await page.goto("/team");
  await page.getByRole("link", { name: "Open the practice market" }).click();
  await expect(page).toHaveURL(/\/team\/trade\/practice/);
  const term = page.getByTestId("practice-terminal");
  await expect(term).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("practice-tickers").getByRole("button")).toHaveCount(ev.plan.teams.filter((t) => t.track === "PRODUCT").length);
  await expect(page.getByTestId("practice-price")).toContainText("$", { timeout: 20_000 });
  await expect(page.getByTestId("practice-chart").locator("svg rect").first()).toBeVisible({ timeout: 20_000 });
  // The crosshair reads out a candle.
  await page.getByTestId("practice-chart").locator("svg").hover({ position: { x: 300, y: 150 } });
  await expect(page.getByTestId("practice-chart-ohlc")).toContainText("O $");
  await expect(page.getByTestId("practice-chart-patterns")).toBeVisible();

  // A trade.
  await page.getByLabel("Shares").fill("500");
  await page.getByTestId("practice-BUY").click();
  await expect(page.getByTestId("practice-message")).toContainText("BUY 500", { timeout: 15_000 });
  await expect(page.getByTestId("practice-account")).toContainText("long");
  await expect(page.getByTestId("practice-trades")).toContainText("BUY 500");
  // A refusal is shown as it comes.
  await page.getByTestId("practice-SHORT").click();
  await expect(page.getByTestId("practice-message")).toContainText("SELL first");

  // Round 1 ends: this fund is the only one that traded, so it places #1 and wins the prize in real cash.
  const teamId = ev.n.teamId(fund);
  await ev.n.q("update practice_accounts set cash_cents = cash_cents + 2000000 where team_id = $1", [teamId]);
  const before = Number((await ev.n.one("select cash_cents from teams where id = $1", [teamId])).cash_cents);
  await ev.n.deadlinePassed("PITCH");
  await ev.n.advanceTo("READING");
  const after = Number((await ev.n.one("select cash_cents from teams where id = $1", [teamId])).cash_cents);
  const acct = await ev.n.one("select rank, edge_cents::bigint as prize from practice_accounts where team_id = $1", [teamId]);
  expect(acct.rank).toBe(1);
  expect(Number(acct.prize)).toBe(5_000_000);
  expect(after - before).toBe(5_000_000);
  await page.goto("/team/trade/practice");
  await expect(page.getByTestId("practice-result")).toContainText("You placed #1");
  await expect(page.getByTestId("practice-leaderboard")).toContainText(fund);
});
