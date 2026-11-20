import { describe, expect, it } from "vitest";
import { rollDice } from "./dice-input";

describe("rollDice", () => {
  it("gives three dice faces, each 1 to 6", () => {
    for (let i = 0; i < 500; i++) expect(rollDice()).toMatch(/^[1-6]{3}$/);
  });
  it("uses the random source for each die", () => {
    const faces = [0, 5, 2];
    expect(rollDice(3, () => faces.shift()!)).toBe("163");
  });
});
