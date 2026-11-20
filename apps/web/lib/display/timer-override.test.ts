import { describe, expect, test } from "vitest";
import { adjustOverride, overrideFromClock, overrideFromMinutes, overrideReached, parseOverride, remainingText } from "./timer-override";

// 2026-11-20 14:00:00 UTC = 19:30 IST.
const NOW = Date.UTC(2026, 10, 20, 14, 0, 0);

describe("the projector's manual timer", () => {
  test("minutes from now; nonsense is refused; an empty label reads Timer", () => {
    expect(overrideFromMinutes(NOW, 10, " Break ends ")).toEqual({ label: "Break ends", at: NOW + 600_000 });
    expect(overrideFromMinutes(NOW, 0, "x")).toBeNull();
    expect(overrideFromMinutes(NOW, Number.NaN, "x")).toBeNull();
    expect(overrideFromMinutes(NOW, 1, "  ")!.label).toBe("Timer");
  });

  test("an exact HH:MM in IST: today's, or tomorrow's once passed", () => {
    expect(overrideFromClock(NOW, "20:00", "Doors")!.at).toBe(Date.UTC(2026, 10, 20, 14, 30));
    expect(overrideFromClock(NOW, "19:00", "x")!.at).toBe(Date.UTC(2026, 10, 21, 13, 30));
    expect(overrideFromClock(NOW, "25:00", "x")).toBeNull();
    expect(overrideFromClock(NOW, "8pm", "x")).toBeNull();
  });

  test("the steps move it, never before now", () => {
    const t = overrideFromMinutes(NOW, 2, "x")!;
    expect(adjustOverride(t, 5, NOW).at).toBe(NOW + 7 * 60_000);
    expect(adjustOverride(t, -1, NOW).at).toBe(NOW + 60_000);
    expect(adjustOverride(adjustOverride(t, -1, NOW), -5, NOW).at).toBe(NOW);
  });

  test("MM:SS, H:MM:SS from an hour, 00:00 once reached", () => {
    const t = { label: "x", at: NOW + 90_500 };
    expect(remainingText(t, NOW)).toBe("01:31");
    expect(remainingText({ label: "x", at: NOW + 3_723_000 }, NOW)).toBe("1:02:03");
    expect(remainingText(t, NOW + 100_000)).toBe("00:00");
    expect(overrideReached(t, NOW)).toBe(false);
    expect(overrideReached(t, NOW + 90_500)).toBe(true);
  });

  test("a stored value read back; anything unreadable is none", () => {
    expect(parseOverride(JSON.stringify({ label: "Break", at: NOW }))).toEqual({ label: "Break", at: NOW });
    expect(parseOverride("{oops")).toBeNull();
    expect(parseOverride(JSON.stringify({ label: 3, at: NOW }))).toBeNull();
    expect(parseOverride(null)).toBeNull();
  });
});
