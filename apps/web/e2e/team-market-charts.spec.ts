import { expect, test } from "@playwright/test";
import { seedE2eEvent } from "./support/event";
import { trading } from "./support/game";
import { loginAsTeam } from "./support/login";

test("Finance orders move the read-only Market chart for Product and Consulting", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const event = await seedE2eEvent({ slug: "e2e-market-charts", prefix: "Y" });
  const squads = await trading(event);
  const companyId = squads[0]!.company_id;
  await event.n.openRound(1);

  const contexts = await Promise.all([browser.newContext({ baseURL }), browser.newContext({ baseURL })]);
  try {
    const [product, consulting] = await Promise.all(contexts.map((context) => context.newPage()));
    const spectators = [product!, consulting!];
    await Promise.all(spectators.map(async (page, index) => {
      await loginAsTeam(page, event, index === 0 ? squads[0]!.p_code : squads[0]!.c_code);
      await page.goto("/team/market");
      await page.getByLabel("Company chart").selectOption(companyId);
      await expect(page.getByTestId("indicative-price")).toContainText("$10.50");
      await expect(page.getByText(/Order ticket/i)).toHaveCount(0);
    }));

    await event.n.ok(event.n.team(squads[1]!.f_code), "place_order", companyId, "BUY", 2_000);
    await Promise.all(spectators.map(async (page) => {
      await expect(page.getByTestId("indicative-price")).toContainText("$10.71");
      await expect(page.getByTestId("trade-chart").getByRole("img")).toHaveAttribute("aria-label", /last \$10\.71/);
    }));

    await event.n.clearRound(1);
    await Promise.all(spectators.map(async (page) => {
      await expect(page.getByTestId("indicative-price")).toHaveCount(0);
      await expect(page.getByTestId("trade-chart").getByRole("img")).toHaveAttribute("aria-label", /last \$10\.71/);
    }));
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
