import { describe, it, expect } from "vitest";
import {
  containsDigit,
  formatDayName,
  formatLogDate,
  formatShortDate,
  formatSigned,
  TONE_TEXT,
} from "./metrics-format";

describe("formatSigned", () => {
  it("prefixes positive values with +", () => {
    expect(formatSigned(1.23)).toBe("+1.2");
  });

  it("keeps the native minus on negatives", () => {
    expect(formatSigned(-0.3)).toBe("-0.3");
  });

  it("renders zero without a sign", () => {
    expect(formatSigned(0)).toBe("0.0");
  });

  it("drops the + when a tiny positive rounds to zero at the given precision", () => {
    expect(formatSigned(0.04)).toBe("0.0");
  });

  it("honours the decimals parameter", () => {
    expect(formatSigned(2, 0)).toBe("+2");
    expect(formatSigned(-1.234, 2)).toBe("-1.23");
  });
});

describe("containsDigit", () => {
  it("detects digits anywhere in the string", () => {
    expect(containsDigit("1.2 kg")).toBe(true);
    expect(containsDigit("week 2")).toBe(true);
  });

  it("is false for word-only or empty strings", () => {
    expect(containsDigit("stable")).toBe(false);
    expect(containsDigit("")).toBe(false);
  });
});

describe("date formatters (suite runs pinned to UTC)", () => {
  it("formatLogDate renders day + long month", () => {
    expect(formatLogDate("2026-07-23")).toBe("23 July");
  });

  it("formatShortDate renders day + short month", () => {
    expect(formatShortDate("2026-04-05")).toBe("5 Apr");
  });

  it("formatDayName renders the long weekday", () => {
    expect(formatDayName("2026-07-23")).toBe("Thursday");
  });
});

describe("TONE_TEXT", () => {
  it("maps every tone to a text colour class", () => {
    expect(Object.keys(TONE_TEXT).sort()).toEqual(["bad", "good", "neutral"]);
    expect(TONE_TEXT.good).toBe("text-[#0d9488]");
    expect(TONE_TEXT.bad).toBe("text-[#d97706]");
    expect(TONE_TEXT.neutral).toBe("text-[#93b0b4]");
  });
});
