import { describe, expect, test } from "vitest";
import { originOf, qrSvg, teamQrLinks } from "./qr";

const h = (m: Record<string, string>) => ({ get: (n: string) => m[n] ?? null });

describe("team QR codes", () => {
  test("the request's host, https unless forwarded otherwise or local", () => {
    expect(originOf(h({ host: "primus.example.com" }))).toBe("https://primus.example.com");
    expect(originOf(h({ host: "internal:3000", "x-forwarded-host": "primus.example.com", "x-forwarded-proto": "https" }))).toBe("https://primus.example.com");
    expect(originOf(h({ host: "localhost:3000" }))).toBe("http://localhost:3000");
    expect(originOf(h({ host: "evil.com/<script>" }))).toBeNull();
    expect(originOf(h({}))).toBeNull();
  });

  test("each track's demo page and guide", () => {
    expect(teamQrLinks("FINANCE", "https://p.io")).toEqual({ demo: "https://p.io/demo/finance?asTrack=FINANCE", guide: "https://p.io/guide/finance" });
    expect(teamQrLinks("PRODUCT", "https://p.io").guide).toBe("https://p.io/guide/product");
    expect(teamQrLinks("CONSULTING", "https://p.io").demo).toBe("https://p.io/demo/dashboard?asTrack=CONSULTING");
  });

  test("the code is an SVG", async () => {
    const svg = await qrSvg("https://p.io/guide/product");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toContain("<script");
  });
});
