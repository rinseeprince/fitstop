import { describe, expect, it } from "vitest";
import { formatBlockLength, formatBlockRange } from "./block-format";

// The year rule is formatBlockDate's: appended only when it is not the current
// one. A range in a past year therefore carries it on both ends; a range in
// this year on neither. Fixtures are pinned to the machine's current year so
// the assertions hold whatever year the suite runs in.
const THIS_YEAR = new Date().getFullYear();
const LAST_YEAR = THIS_YEAR - 1;

describe("formatBlockRange", () => {
  it("start – end, in the block header's grammar", () => {
    expect(formatBlockRange(`${THIS_YEAR}-08-24`, `${THIS_YEAR}-10-04`)).toBe("24 Aug – 4 Oct");
    expect(formatBlockRange(`${THIS_YEAR}-09-07`, `${THIS_YEAR}-09-20`)).toBe("7 Sep – 20 Sep");
  });

  it("a one-day window is one date, not a range of itself", () => {
    expect(formatBlockRange(`${THIS_YEAR}-09-07`, `${THIS_YEAR}-09-07`)).toBe("7 Sep");
  });

  it("a range outside the current year carries the year on both ends", () => {
    expect(formatBlockRange(`${LAST_YEAR}-11-30`, `${LAST_YEAR}-12-27`)).toBe(
      `30 Nov ${LAST_YEAR} – 27 Dec ${LAST_YEAR}`
    );
  });
});

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
