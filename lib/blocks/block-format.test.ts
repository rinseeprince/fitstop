import { describe, expect, it } from "vitest";
import { formatBlockLength } from "./block-format";

describe("formatBlockLength", () => {
  it("whole weeks", () => {
    expect(formatBlockLength(28)).toBe("4 weeks");
    expect(formatBlockLength(7)).toBe("1 week");
  });

  it("mixed weeks and days — the day-granular case", () => {
    expect(formatBlockLength(31)).toBe("4 weeks 3 days");
    expect(formatBlockLength(8)).toBe("1 week 1 day");
  });

  it("under a week", () => {
    expect(formatBlockLength(5)).toBe("5 days");
    expect(formatBlockLength(1)).toBe("1 day");
  });
});
