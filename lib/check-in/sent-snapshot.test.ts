import { describe, it, expect } from "vitest";
import {
  parseSentSnapshot,
  readSentSnapshot,
  reportedReadings,
  SENT_SNAPSHOT_VERSION,
} from "./sent-snapshot";

/**
 * The saved copy of a sent check-in (migration 195). Its shape is declared
 * once, validated when written and when read, and — because the coach's wire
 * is built from it — every object comes back in the kernel's key order however
 * the database stored it (jsonb sorts keys by length).
 */

/** A full version-1 copy, every section present, keys in the kernel's order. */
function canonicalCopy() {
  return {
    version: 1,
    day: "2026-09-19",
    readings: {
      weight: 78.4,
      bodyFat: 21.3,
      waist: 81.2,
      hips: null,
      chest: 101.7,
      arms: null,
      thighs: 57.9,
    },
    standing: { weight: 78.4, bodyFat: 21.3 },
    goal: {
      id: "5a1e0c0e-1111-4000-8000-000000000011",
      name: "Lean out",
      type: "lose_weight",
      targetWeight: 74.6,
      targetBodyFatPercentage: 17.2,
      startsOn: "2026-08-17",
      deadline: "2026-11-06",
    },
    goalProgress: {
      weight: {
        goal: 74.6,
        startingWeight: 83.3,
        goalStartWeight: 80.8,
        position: {
          current: 78.4,
          remaining: -3.8,
          percentComplete: 38.7,
          status: "approaching",
          isOnTrack: true,
          paceStatus: "on_track",
        },
      },
      bodyFat: {
        goal: 17.2,
        startingBodyFat: 24.6,
        goalStartBodyFat: 23.1,
        position: {
          current: 21.3,
          remaining: -4.1,
          percentComplete: 30.5,
          status: "approaching",
          isOnTrack: false,
        },
      },
      deadline: { date: "2026-11-06", daysRemaining: 48, isPastDeadline: false },
    },
    nutritionPlan: { baseWeightKg: 80.35, effectiveFrom: "2026-09-01" },
    period: {
      dates: ["2026-09-13", "2026-09-14"],
      loggedDates: ["2026-09-14"],
      nutrition: [
        {
          date: "2026-09-13",
          dayOfWeek: "sunday",
          status: "not_logged",
          targetCalories: 2140,
          targetProteinG: 161,
          targetCarbsG: 213,
          targetFatG: 73,
          actualCalories: null,
          actualProteinG: null,
          actualCarbsG: null,
          actualFatG: null,
        },
        {
          date: "2026-09-14",
          dayOfWeek: "monday",
          status: "hit",
          targetCalories: 2290,
          targetProteinG: 166,
          targetCarbsG: 247,
          targetFatG: 71,
          actualCalories: 2257,
          actualProteinG: 159,
          actualCarbsG: 238,
          actualFatG: 74,
        },
      ],
      habits: {
        rail: ["none", "complete"],
        avgPct: 50,
        daysBelow50: 1,
        perHabit: [
          {
            id: "habit-steps",
            name: "10k steps",
            eligibleDays: 2,
            completedDays: 1,
            pct: 50,
            rail: [false, true],
          },
        ],
      },
    },
    questions: [
      { questionId: "5a1e0c0e-2222-4000-8000-000000000022", prompt: "How did training feel?" },
    ],
  };
}

/** The same copy as jsonb hands it back: every object's keys shortest first. */
function jsonbOrdered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonbOrdered);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0
    );
    return Object.fromEntries(entries.map(([key, inner]) => [key, jsonbOrdered(inner)]));
  }
  return value;
}

describe("parseSentSnapshot — the declared shape, version inside", () => {
  it("accepts a full version-1 copy as it is", () => {
    expect(SENT_SNAPSHOT_VERSION).toBe(1);
    expect(parseSentSnapshot(canonicalCopy())).toEqual(canonicalCopy());
  });

  it("gives every object back in the kernel's key order, however jsonb stored it — the coach's wire stays byte-for-byte", () => {
    const stored = jsonbOrdered(canonicalCopy()) as {
      goalProgress: { weight: Record<string, unknown> };
    };
    // The premise: jsonb really does reorder the rows the wire carries.
    expect(Object.keys(stored.goalProgress.weight)).toEqual([
      "goal",
      "position",
      "startingWeight",
      "goalStartWeight",
    ]);

    const parsed = parseSentSnapshot(stored);

    expect(Object.keys(parsed.goalProgress.weight!)).toEqual([
      "goal",
      "startingWeight",
      "goalStartWeight",
      "position",
    ]);
    expect(Object.keys(parsed.goalProgress.weight!.position!)).toEqual([
      "current",
      "remaining",
      "percentComplete",
      "status",
      "isOnTrack",
      "paceStatus",
    ]);
    expect(Object.keys(parsed.period!.habits)).toEqual(["rail", "avgPct", "daysBelow50", "perHabit"]);
    expect(Object.keys(parsed.period!.habits.perHabit[0])).toEqual([
      "id",
      "name",
      "eligibleDays",
      "completedDays",
      "pct",
      "rail",
    ]);
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(canonicalCopy()));
  });

  it("keeps an absent optional field absent rather than inventing one", () => {
    const copy = canonicalCopy();
    const { startingWeight: _startingWeight, ...weightRow } = copy.goalProgress.weight;
    const parsed = parseSentSnapshot({
      ...copy,
      goalProgress: { weight: weightRow },
    });
    expect("startingWeight" in parsed.goalProgress.weight!).toBe(false);
    expect("bodyFat" in parsed.goalProgress).toBe(false);
    expect("deadline" in parsed.goalProgress).toBe(false);
  });

  it("accepts a check-in with no goal and no resolvable week", () => {
    const parsed = parseSentSnapshot({
      ...canonicalCopy(),
      goal: null,
      goalProgress: {},
      nutritionPlan: null,
      period: null,
      questions: [],
    });
    expect(parsed.goal).toBeNull();
    expect(parsed.period).toBeNull();
  });

  it("refuses another version — a later shape is a new version beside this one", () => {
    expect(() => parseSentSnapshot({ ...canonicalCopy(), version: 2 })).toThrow();
  });

  it("refuses a key the shape does not declare", () => {
    expect(() => parseSentSnapshot({ ...canonicalCopy(), vsLast: 1.2 })).toThrow();
    const copy = canonicalCopy();
    expect(() =>
      parseSentSnapshot({ ...copy, standing: { ...copy.standing, girth: 64.2 } })
    ).toThrow();
  });

  it("refuses a missing field", () => {
    const { day: _day, ...withoutDay } = canonicalCopy();
    expect(() => parseSentSnapshot(withoutDay)).toThrow();
    const copy = canonicalCopy();
    const { chest: _chest, ...readings } = copy.readings;
    expect(() => parseSentSnapshot({ ...copy, readings })).toThrow();
  });

  it("refuses a number that is not finite — frozen for ever, it would never be right", () => {
    const copy = canonicalCopy();
    expect(() =>
      parseSentSnapshot({ ...copy, readings: { ...copy.readings, weight: Number.NaN } })
    ).toThrow();
    expect(() =>
      parseSentSnapshot({
        ...copy,
        goalProgress: {
          ...copy.goalProgress,
          weight: {
            ...copy.goalProgress.weight,
            position: { ...copy.goalProgress.weight.position, remaining: Number.POSITIVE_INFINITY },
          },
        },
      })
    ).toThrow();
  });

  it("refuses a day that is not YYYY-MM-DD", () => {
    expect(() => parseSentSnapshot({ ...canonicalCopy(), day: "2026-9-19" })).toThrow();
    const copy = canonicalCopy();
    expect(() =>
      parseSentSnapshot({ ...copy, goal: { ...copy.goal, deadline: "06/11/2026" } })
    ).toThrow();
  });
});

describe("readSentSnapshot — validated when read", () => {
  it("is null for a check-in with no copy yet", () => {
    expect(readSentSnapshot(null)).toBeNull();
    expect(readSentSnapshot(undefined)).toBeNull();
  });

  it("returns the validated copy, in the kernel's key order", () => {
    const read = readSentSnapshot(jsonbOrdered(canonicalCopy()));
    expect(JSON.stringify(read)).toBe(JSON.stringify(canonicalCopy()));
  });

  it("throws a readable error for a corrupt copy, naming what is wrong", () => {
    expect(() => readSentSnapshot({ version: 1 })).toThrow(/does not match its shape/);
    expect(() => readSentSnapshot({ ...canonicalCopy(), day: 20260919 })).toThrow(/day/);
  });
});

describe("reportedReadings — the seven readings a sent check-in reported", () => {
  it("maps every reported reading and skips the ones the form did not carry", () => {
    expect(reportedReadings(parseSentSnapshot(canonicalCopy()))).toEqual({
      weight: 78.4,
      bodyFat: 21.3,
      waist: 81.2,
      chest: 101.7,
      thighs: 57.9,
    });
  });

  it("is empty for a check-in with no copy", () => {
    expect(reportedReadings(null)).toEqual({});
  });
});
