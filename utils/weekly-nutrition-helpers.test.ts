import { describe, it, expect } from "vitest";
import { calculateWeeklySummaryFromLogs } from "./weekly-nutrition-helpers";
import type { DailyLog } from "@/types/daily-log";

// A period's logs. Only the fields the summary reads.
const logs = (
  rows: { date: string; consumed?: number | null; target?: number | null }[]
): DailyLog[] =>
  rows.map((r) => ({
    date: r.date,
    caloriesConsumed: r.consumed ?? null,
    targetCalories: r.target ?? null,
  })) as unknown as DailyLog[];

// The seven real nutrition_events behind check-in 440112cd sum to this.
const WHOLE_PERIOD = { calories: 14545, proteinG: null, carbsG: null, fatG: null };

describe("calculateWeeklySummaryFromLogs — the two nutrition denominators", () => {
  // Adherence asks "did they do what they were supposed to", so an unlogged day
  // counts against it. An average asks "what was it actually like", and an
  // unlogged day is unknown rather than zero. Reporting only the first read as
  // severe under-eating for a client who hit target on every day they logged.
  it("reports coverage over the whole period AND intake over the logged days", () => {
    const summary = calculateWeeklySummaryFromLogs(
      logs([
        { date: "2026-08-25", consumed: 2442, target: 2442 },
        { date: "2026-08-26", consumed: 2553, target: 2553 },
      ]),
      "2026-08-25",
      7,
      WHOLE_PERIOD,
      "2026-08-31"
    );

    // Coverage: 4995 of 14545 across seven days. Deliberately unchanged (D5.2).
    expect(summary.adherencePercentage).toBe(34.3);
    expect(summary.daysLogged).toBe(2);

    // Intake: both logged days hit target to the calorie.
    expect(summary.loggedTargetCalories).toBe(4995);
    expect(summary.loggedDayMeanConsumed).toBe(2497.5);
    expect(summary.loggedDayMeanTarget).toBe(2497.5);
    expect(summary.loggedDayAdherencePercentage).toBe(100);
    expect(summary.daysUnder).toBe(0);
  });

  it("excludes a day carrying a target but no consumed value from the logged-day pair", () => {
    // Only days with BOTH are a like-for-like comparison — which is why the
    // logged-day target is accumulated in the consumed branch rather than
    // reusing the running target total.
    const summary = calculateWeeklySummaryFromLogs(
      logs([
        { date: "2026-08-25", consumed: 2000, target: 2000 },
        { date: "2026-08-26", consumed: null, target: 3000 },
      ]),
      "2026-08-25",
      7,
      WHOLE_PERIOD,
      "2026-08-31"
    );

    expect(summary.daysLogged).toBe(1);
    expect(summary.loggedTargetCalories).toBe(2000);
    expect(summary.loggedDayMeanTarget).toBe(2000);
    expect(summary.loggedDayAdherencePercentage).toBe(100);
  });

  it("returns null logged-day figures when nothing was logged", () => {
    const summary = calculateWeeklySummaryFromLogs(
      logs([{ date: "2026-08-25", consumed: null, target: 2000 }]),
      "2026-08-25",
      7,
      WHOLE_PERIOD,
      "2026-08-31"
    );

    expect(summary.daysLogged).toBe(0);
    expect(summary.loggedTargetCalories).toBeNull();
    expect(summary.loggedDayMeanConsumed).toBeNull();
    expect(summary.loggedDayMeanTarget).toBeNull();
    expect(summary.loggedDayAdherencePercentage).toBeNull();
  });

  it("agrees with coverage when every day is logged", () => {
    const summary = calculateWeeklySummaryFromLogs(
      logs(
        Array.from({ length: 7 }, (_, i) => ({
          date: `2026-08-${25 + i}`,
          consumed: 2000,
          target: 2000,
        }))
      ),
      "2026-08-25",
      7,
      { calories: 14000, proteinG: null, carbsG: null, fatG: null },
      "2026-08-31"
    );

    expect(summary.adherencePercentage).toBe(100);
    expect(summary.loggedDayAdherencePercentage).toBe(100);
  });
});
