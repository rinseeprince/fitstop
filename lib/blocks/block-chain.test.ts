import { describe, it, expect } from "vitest";
import { inclusiveDays, weeksSpanned } from "./block-chain";

// All math is UTC string arithmetic, so these exact-date assertions hold under
// any server timezone — including the DST-straddling chains below, which is
// what a server-local `new Date(x + "T00:00:00")` walk would get wrong.

describe("weeksSpanned", () => {
  it("equals the authored count for whole-week windows", () => {
    expect(weeksSpanned("2026-08-11", "2026-09-21")).toBe(6);
    expect(weeksSpanned("2026-08-11", "2026-08-17")).toBe(1);
  });

  it("reports the week a truncated block reached (ceil)", () => {
    // 29 days — a 6-week block truncated in its fifth week.
    expect(inclusiveDays("2026-07-13", "2026-08-10")).toBe(29);
    expect(weeksSpanned("2026-07-13", "2026-08-10")).toBe(5);
  });
});
