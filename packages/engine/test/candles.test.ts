import { describe, expect, it } from "vitest";
import { candlesFromTicks, candleTicks, detectPatterns, hashRandom, patternAt, practiceCandles, practicePrize, practiceProfit, PRACTICE } from "../src/candles";

const c = (open: number, close: number, high = Math.max(open, close), low = Math.min(open, close)) => ({ open, close, high, low });

describe("pattern detection", () => {
  const down = [c(1100, 1080), c(1080, 1060), c(1060, 1040)];
  const up = [c(1000, 1020), c(1020, 1040), c(1040, 1060)];
  it("finds a hammer after a fall and a shooting star after a rise", () => {
    expect(patternAt([...down, c(1040, 1042, 1043, 1000)], 3)).toBe("Hammer");
    expect(patternAt([...up, c(1060, 1058, 1100, 1057)], 3)).toBe("Shooting star");
  });
  it("finds engulfing candles", () => {
    expect(patternAt([...down, c(1040, 1030), c(1029, 1046)], 4)).toBe("Bullish engulfing");
    expect(patternAt([...up, c(1060, 1070), c(1071, 1055)], 4)).toBe("Bearish engulfing");
  });
  it("finds a doji, three soldiers and three crows", () => {
    expect(patternAt([c(1000, 1000, 1010, 990)], 0)).toBe("Doji");
    expect(patternAt([c(1000, 1010, 1011, 999), c(1010, 1020, 1021, 1009), c(1020, 1030, 1031, 1019)], 2)).toBe("Three white soldiers");
    expect(patternAt([c(1030, 1020, 1031, 1019), c(1020, 1010, 1021, 1009), c(1010, 1000, 1011, 999)], 2)).toBe("Three black crows");
  });
  it("finds a breakout from a range", () => {
    const box = Array.from({ length: 8 }, (_, i) => c(1000 + (i % 2) * 2, 1002 - (i % 2) * 2, 1004, 998));
    expect(patternAt([...box, c(1002, 1020, 1021, 1001)], 8)).toBe("Breakout up");
    expect(patternAt([...box, c(1000, 980, 1001, 979)], 8)).toBe("Breakdown");
  });
  it("finds nothing in an ordinary candle", () => {
    expect(patternAt([c(1000, 1010, 1012, 998)], 0)).toBeNull();
  });
});

describe("the practice market", () => {
  const seeds = Array.from({ length: 50 }, (_, i) => `event-x:P${String(i + 1).padStart(2, "0")}`);
  it("is the same every time for a ticker, and different between tickers", () => {
    expect(practiceCandles(seeds[0]!)).toEqual(practiceCandles(seeds[0]!));
    expect(practiceCandles(seeds[0]!)[10]).not.toEqual(practiceCandles(seeds[1]!)[10]);
  });
  it("has 180 well-formed candles with positive prices", () => {
    for (const s of seeds) {
      const cs = practiceCandles(s);
      expect(cs).toHaveLength(PRACTICE.candles);
      for (const k of cs) {
        expect(k.low).toBeGreaterThan(0);
        expect(k.high).toBeGreaterThanOrEqual(Math.max(k.open, k.close));
        expect(k.low).toBeLessThanOrEqual(Math.min(k.open, k.close));
      }
    }
  });
  it("plants patterns a trader can see: most planted signals are detected where they were planted", () => {
    let planted = 0;
    let found = 0;
    for (const s of seeds) {
      const cs = practiceCandles(s);
      cs.forEach((k, i) => {
        if (!k.planted) return;
        planted++;
        if (patternAt(cs, i) === k.planted) found++;
      });
    }
    expect(planted).toBeGreaterThan(50 * 12);
    expect(found / planted).toBeGreaterThan(0.75);
  });
  it("rewards reading them: most bullish signals are followed by a rise, most bearish by a fall", () => {
    let right = 0;
    let total = 0;
    for (const s of seeds) {
      const cs = practiceCandles(s);
      for (const p of detectPatterns(cs)) {
        if (p.bias === "neutral" || p.index + 5 >= cs.length) continue;
        const later = cs[p.index + 5]!.close - cs[p.index]!.close;
        total++;
        if ((p.bias === "bullish") === later > 0) right++;
      }
    }
    expect(right / total).toBeGreaterThan(0.58);
    expect(right / total).toBeLessThan(0.9);
  });
  it("turns candles into ticks and back", () => {
    const cs = practiceCandles(seeds[3]!).slice(0, 20);
    const ticks = cs.flatMap((k) => candleTicks(k));
    expect(ticks).toHaveLength(20 * PRACTICE.candleTicks);
    expect(candlesFromTicks(ticks).map(({ open, high, low, close }) => ({ open, high, low, close }))).toEqual(
      cs.map(({ open, high, low, close }) => ({ open, high, low, close })),
    );
  });
  it("measures practice profit against the money the fund started with", () => {
    expect(practiceProfit(PRACTICE.startCents - 500_000)).toBe(-500_000);
    expect(practiceProfit(PRACTICE.startCents + 1_234_500)).toBe(1_234_500);
  });

  it("pays the prize to the top funds only", () => {
    expect(practicePrize(1)).toBe(PRACTICE.prizeCents);
    expect(practicePrize(PRACTICE.winners)).toBe(PRACTICE.prizeCents);
    expect(practicePrize(PRACTICE.winners + 1)).toBe(0);
    expect(practicePrize(null)).toBe(0);
  });
});

describe("the live practice path (hashRandom candles, random ticks inside each candle)", () => {
  const live = (seed: string) => {
    const ticks = hashRandom(`${seed}:ticks`);
    const cs = practiceCandles(seed, PRACTICE.candles, hashRandom(`${seed}:candles`));
    return { cs, ticks: cs.flatMap((k) => candleTicks(k, PRACTICE.candleTicks, ticks)) };
  };
  const seeds = Array.from({ length: 200 }, (_, i) => `secret-hmac-${i}`);

  it("is deterministic per seed and differs between seeds", () => {
    expect(live(seeds[0]!).ticks).toEqual(live(seeds[0]!).ticks);
    expect(live(seeds[0]!).ticks).not.toEqual(live(seeds[1]!).ticks);
  });

  it("keeps every price positive, whole and sane over 200 paths x 1,080 ticks", () => {
    let lo = Infinity;
    let hi = 0;
    let maxMove = 0;
    let sum = 0;
    let moves = 0;
    for (const s of seeds) {
      const { ticks } = live(s);
      expect(ticks).toHaveLength(PRACTICE.candles * PRACTICE.candleTicks);
      for (let i = 0; i < ticks.length; i++) {
        expect(Number.isInteger(ticks[i])).toBe(true);
        lo = Math.min(lo, ticks[i]!);
        hi = Math.max(hi, ticks[i]!);
        if (i) {
          const m = Math.log(ticks[i]! / ticks[i - 1]!);
          maxMove = Math.max(maxMove, Math.abs(m));
          sum += m;
          moves++;
        }
      }
    }
    expect(lo).toBeGreaterThanOrEqual(150);
    expect(hi).toBeLessThan(2_000_000); // under $20,000 a share; starts are $12-$45
    expect(maxMove).toBeLessThan(0.05); // no 5-second move beyond 5%
    expect(Math.abs(sum / moves)).toBeLessThan(0.001); // no runaway drift across the paths
  });

  it("rebuilds exactly the scripted candles from the ticks (low <= open, close <= high)", () => {
    for (const s of seeds.slice(0, 50)) {
      const { cs, ticks } = live(s);
      const back = candlesFromTicks(ticks);
      expect(back).toEqual(cs.map(({ open, high, low, close }) => ({ open, high, low, close })));
      for (const k of back) {
        expect(k.low).toBeLessThanOrEqual(Math.min(k.open, k.close));
        expect(k.high).toBeGreaterThanOrEqual(Math.max(k.open, k.close));
      }
    }
  });

  it("gives no riskless trade inside a candle: no tick's move fixes the next one's direction", () => {
    // For each tick position inside a candle: how often the next move goes the same way as the last one.
    const rates = (paths: number[][]) => {
      const pos: [number, number][] = [1, 2, 3, 4].map(() => [0, 0]);
      for (const t of paths)
        for (let c = 0; c + 6 <= t.length; c += 6)
          for (let k = 1; k <= 4; k++) {
            const m1 = t[c + k]! - t[c + k - 1]!;
            const m2 = t[c + k + 1]! - t[c + k]!;
            if (m1 === 0 || m2 === 0) continue;
            pos[k - 1]![1]++;
            if (Math.sign(m1) === Math.sign(m2)) pos[k - 1]![0]++;
          }
      return pos.map(([same, total]) => same! / total!);
    };
    // The straight path (no generator given): open → half way → extreme → half way → extreme → close. Every move
    // told the next one for sure (carry on, turn, carry on, turn).
    expect(rates(seeds.slice(0, 50).map((s) => practiceCandles(s).flatMap((k) => candleTicks(k))))).toEqual([1, 0, 1, 0]);
    // Now no position is a sure thing either way.
    for (const r of rates(seeds.slice(0, 100).map((s) => live(s).ticks))) {
      expect(r).toBeGreaterThan(0.15);
      expect(r).toBeLessThan(0.85);
    }
  });

  it("hashRandom is uniform on [0, 1)", () => {
    const r = hashRandom("u");
    const bins = new Array(10).fill(0);
    for (let i = 0; i < 100_000; i++) {
      const x = r();
      expect(x >= 0 && x < 1).toBe(true);
      bins[Math.floor(x * 10)]++;
    }
    for (const b of bins) expect(Math.abs(b - 10_000)).toBeLessThan(500);
  });
});
