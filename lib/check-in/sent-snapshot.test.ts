import { describe, it, expect } from "vitest";
import {
  composeHabitWeek,
  parseSentSnapshot,
  readSentSnapshot,
  reportedReadings,
  SENT_SNAPSHOT_VERSION,
  sentHabitTotals,
} from "./sent-snapshot";
import type { HabitPeriodWeek } from "@/types/habits";

/**
 * The saved copy of a sent check-in (migration 195). Its shape is declared
 * once, validated when written and when read, and — because the coach's wire
 * is built from it — every object comes back in the kernel's key order however
 * the database stored it (jsonb sorts keys by length). A copy saved in an
 * earlier version reads into the current shape.
 */

const EVERY_DAY = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/** The parts every version shares, keys in the kernel's order. */
function sharedParts() {
  return {
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
          trend: "towards",
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
          trend: "away",
        },
      },
      deadline: { date: "2026-11-06", daysRemaining: 48, isPastDeadline: false },
    },
    nutritionPlan: { baseWeightKg: 80.35, effectiveFrom: "2026-09-01" },
  };
}

const WEEK = {
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
};

const QUESTIONS = [{ questionId: "5a1e0c0e-2222-4000-8000-000000000022", prompt: "How did training feel?" }];

/** The habit week version 3 freezes: a number habit with a note, and a set-days tick habit. */
function habitWeek() {
  return {
    habits: [
      {
        id: "habit-water",
        name: "Water",
        measure: "number",
        unit: "L",
        direction: "at_least",
        firstStartsOn: "2026-08-17",
        versions: [{ startsOn: "2026-09-01", endsOn: null, target: 3, timesPerWeek: null, weekdays: EVERY_DAY }],
        days: [
          { date: "2026-09-13", covered: true, planned: true, target: 3, entry: { done: null, value: 2.1, note: "Travelling" }, met: false },
          { date: "2026-09-14", covered: true, planned: true, target: 3, entry: { done: null, value: 3.2, note: null }, met: true },
        ],
        figures: { planned: 2, done: 1, met: 1 },
      },
      {
        id: "habit-mobility",
        name: "Mobility",
        measure: "tick",
        unit: null,
        direction: null,
        firstStartsOn: "2026-09-14",
        versions: [{ startsOn: "2026-09-14", endsOn: null, target: null, timesPerWeek: null, weekdays: ["monday", "wednesday"] }],
        days: [
          { date: "2026-09-13", covered: false, planned: false, target: null, entry: null, met: false },
          { date: "2026-09-14", covered: true, planned: true, target: null, entry: { done: true, value: null, note: null }, met: true },
        ],
        figures: { planned: 1, done: 1, met: 1 },
      },
    ],
    totals: { planned: 3, done: 2, met: 2 },
  };
}

/** A full copy in the current version, every section present, keys in the kernel's order. */
function canonicalCopy() {
  return {
    version: 3,
    ...sharedParts(),
    period: { ...WEEK, habitWeek: habitWeek() },
    questions: QUESTIONS,
  };
}

/** The same check-in as version 2 saved it: the Overview's rail and, per habit, its ticks over the days it existed. */
function version2Copy() {
  return {
    version: 2,
    ...sharedParts(),
    period: {
      ...WEEK,
      habits: {
        rail: ["none", "complete"],
        avgPct: 50,
        daysBelow50: 1,
        perHabit: [
          { id: "habit-steps", name: "10k steps", eligibleDays: 2, completedDays: 1, pct: 50, rail: [false, true] },
          // Added on the Monday: the Sunday before it existed is null, not a miss.
          { id: "habit-read", name: "Read", eligibleDays: 1, completedDays: 0, pct: 0, rail: [null, false] },
          // Never eligible in the week: it says nothing about it.
          { id: "habit-later", name: "Later", eligibleDays: 0, completedDays: 0, pct: null, rail: [null, null] },
        ],
      },
    },
    questions: QUESTIONS,
  };
}

/** Version 2's habits read as a habit week: tick habits planned on every day they existed, their ticks as entries. */
function version2HabitWeek() {
  return {
    habits: [
      {
        id: "habit-steps",
        name: "10k steps",
        measure: "tick",
        unit: null,
        direction: null,
        firstStartsOn: "2026-09-13",
        versions: [{ startsOn: "2026-09-13", endsOn: null, target: null, timesPerWeek: null, weekdays: EVERY_DAY }],
        days: [
          { date: "2026-09-13", covered: true, planned: true, target: null, entry: null, met: false },
          { date: "2026-09-14", covered: true, planned: true, target: null, entry: { done: true, value: null, note: null }, met: true },
        ],
        figures: { planned: 2, done: 1, met: 1 },
      },
      {
        id: "habit-read",
        name: "Read",
        measure: "tick",
        unit: null,
        direction: null,
        // The first day its rail reaches: the copy knows no earlier start.
        firstStartsOn: "2026-09-14",
        versions: [{ startsOn: "2026-09-14", endsOn: null, target: null, timesPerWeek: null, weekdays: EVERY_DAY }],
        days: [
          { date: "2026-09-13", covered: false, planned: false, target: null, entry: null, met: false },
          { date: "2026-09-14", covered: true, planned: true, target: null, entry: null, met: false },
        ],
        figures: { planned: 1, done: 0, met: 0 },
      },
    ],
    totals: { planned: 3, done: 1, met: 1 },
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

/**
 * The same check-in as version 1 saved it: version 2's habits, and each row's
 * trend a yes or no — moving towards the target, or not.
 */
function version1Copy() {
  const copy = version2Copy();
  const { weight, bodyFat } = copy.goalProgress;
  return {
    ...copy,
    version: 1,
    goalProgress: {
      weight: {
        ...weight,
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
        ...bodyFat,
        position: { current: 21.3, remaining: -4.1, percentComplete: 30.5, status: "approaching", isOnTrack: false },
      },
      deadline: copy.goalProgress.deadline,
    },
  };
}

/** What a version 1 or 2 copy reads as: the current shape, its habits as a habit week. */
function readAsCurrent(version: number) {
  return { ...canonicalCopy(), version, period: { ...WEEK, habitWeek: version2HabitWeek() } };
}

describe("parseSentSnapshot — the declared shape, version inside", () => {
  it("accepts a full copy in the current version as it is", () => {
    expect(SENT_SNAPSHOT_VERSION).toBe(3);
    expect(parseSentSnapshot(canonicalCopy())).toEqual(canonicalCopy());
  });

  it("accepts a row with no trend yet — fewer than two check-ins carrying the metric (commit 8d4)", () => {
    const copy = canonicalCopy();
    const parsed = parseSentSnapshot({
      ...copy,
      goalProgress: {
        ...copy.goalProgress,
        weight: { ...copy.goalProgress.weight, position: { ...copy.goalProgress.weight.position, trend: null } },
      },
    });
    expect(parsed.goalProgress.weight?.position?.trend).toBeNull();
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
      "trend",
      "paceStatus",
    ]);
    expect(Object.keys(parsed.period!.habitWeek)).toEqual(["habits", "totals"]);
    expect(Object.keys(parsed.period!.habitWeek.habits[0])).toEqual([
      "id",
      "name",
      "measure",
      "unit",
      "direction",
      "firstStartsOn",
      "versions",
      "days",
      "figures",
    ]);
    expect(Object.keys(parsed.period!.habitWeek.habits[0].days[0])).toEqual([
      "date",
      "covered",
      "planned",
      "target",
      "entry",
      "met",
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

  it("refuses another version — a copy is always written in the current one", () => {
    expect(() => parseSentSnapshot(version1Copy())).toThrow();
    expect(() => parseSentSnapshot(version2Copy())).toThrow();
    expect(() => parseSentSnapshot({ ...canonicalCopy(), version: 4 })).toThrow();
  });

  it("refuses version 2's habits in a version 3 copy, and a habit week in a version 2 one", () => {
    expect(() => parseSentSnapshot({ ...version2Copy(), version: 3 })).toThrow();
    expect(() => readSentSnapshot({ ...canonicalCopy(), version: 2 })).toThrow(/habits/);
  });

  it("refuses a habit measured some other way, or a day missing a fact", () => {
    const copy = canonicalCopy();
    const [water, mobility] = copy.period.habitWeek.habits;
    const withHabits = (habits: unknown[]) => ({ ...copy, period: { ...copy.period, habitWeek: { ...copy.period.habitWeek, habits } } });
    expect(() => parseSentSnapshot(withHabits([{ ...water, measure: "count" }, mobility]))).toThrow();
    const { met: _met, ...dayWithoutMet } = water.days[0];
    expect(() => parseSentSnapshot(withHabits([{ ...water, days: [dayWithoutMet, water.days[1]] }, mobility]))).toThrow();
  });

  it("refuses a habit row without the day it first started — what tells a day not yet added from one not running", () => {
    const copy = canonicalCopy();
    const [water, mobility] = copy.period.habitWeek.habits;
    const withHabits = (habits: unknown[]) => ({ ...copy, period: { ...copy.period, habitWeek: { ...copy.period.habitWeek, habits } } });
    const { firstStartsOn: _firstStartsOn, ...waterWithoutStart } = water;
    expect(() => parseSentSnapshot(withHabits([waterWithoutStart, mobility]))).toThrow();
    expect(() => parseSentSnapshot(withHabits([{ ...water, firstStartsOn: "17 Aug" }, mobility]))).toThrow();
  });

  it("refuses a key the shape does not declare", () => {
    expect(() => parseSentSnapshot({ ...canonicalCopy(), vsLast: 1.2 })).toThrow();
    const copy = canonicalCopy();
    expect(() =>
      parseSentSnapshot({ ...copy, standing: { ...copy.standing, girth: 64.2 } })
    ).toThrow();
    // Inside the habit week too: a habit row, a version and a day each declare their keys.
    const [water, mobility] = copy.period.habitWeek.habits;
    const withHabits = (habits: unknown[]) => ({ ...copy, period: { ...copy.period, habitWeek: { ...copy.period.habitWeek, habits } } });
    expect(() => parseSentSnapshot(withHabits([{ ...water, streak: 4 }, mobility]))).toThrow();
    expect(() =>
      parseSentSnapshot(withHabits([{ ...water, versions: [{ ...water.versions[0], id: "v1" }] }, mobility]))
    ).toThrow();
    expect(() =>
      parseSentSnapshot(withHabits([{ ...water, days: [{ ...water.days[0], edited: false }, water.days[1]] }, mobility]))
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

describe("composeHabitWeek — the habit week frozen at Send", () => {
  it("keeps values, never references: each habit's name and measure, its first start, its versions' runs, each day's facts, the figures", () => {
    const week: HabitPeriodWeek = {
      habits: [
        {
          habit: { id: "habit-water", name: "Water", howTo: "A glass with each meal", measure: "number", unit: "L", direction: "at_least" },
          // Started long before the version the week holds: kept as given, never worked out from the versions.
          firstStartsOn: "2026-08-03",
          versions: [{ id: "v-1", startsOn: "2026-09-01", endsOn: null, target: 3, timesPerWeek: null, weekdays: ["monday"] }],
          days: [
            {
              date: "2026-09-14",
              covered: true,
              planned: true,
              target: 3,
              edited: false,
              versionId: "v-1",
              timesPerWeek: null,
              entry: { done: null, value: 3.2, note: null },
              met: true,
            },
          ],
          figures: { planned: 1, done: 1, met: 1 },
        },
      ],
      totals: { planned: 1, done: 1, met: 1 },
    };

    expect(composeHabitWeek(week)).toEqual({
      habits: [
        {
          id: "habit-water",
          name: "Water",
          measure: "number",
          unit: "L",
          direction: "at_least",
          firstStartsOn: "2026-08-03",
          versions: [{ startsOn: "2026-09-01", endsOn: null, target: 3, timesPerWeek: null, weekdays: ["monday"] }],
          days: [{ date: "2026-09-14", covered: true, planned: true, target: 3, entry: { done: null, value: 3.2, note: null }, met: true }],
          figures: { planned: 1, done: 1, met: 1 },
        },
      ],
      totals: { planned: 1, done: 1, met: 1 },
    });
    // What it freezes is a valid version 3 week.
    expect(() =>
      parseSentSnapshot({ ...canonicalCopy(), period: { ...WEEK, habitWeek: composeHabitWeek(week) } })
    ).not.toThrow();
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

describe("readSentSnapshot — a version 2 copy reads in the current shape (rule 9)", () => {
  it("reads each habit as a tick habit planned on every day it existed, its ticks as its entries, and keeps its version", () => {
    const read = readSentSnapshot(version2Copy());
    expect(read?.version).toBe(2);
    expect(read?.period?.habitWeek).toEqual(version2HabitWeek());
    // Everything else is the copy as it was saved.
    expect(JSON.stringify(read)).toBe(JSON.stringify(readAsCurrent(2)));
  });

  it("keeps the figures the week froze, and leaves out a habit that existed on none of its days", () => {
    const read = readSentSnapshot(version2Copy());
    expect(read?.period?.habitWeek.habits.map((habit) => [habit.name, habit.figures])).toEqual([
      ["10k steps", { planned: 2, done: 1, met: 1 }],
      ["Read", { planned: 1, done: 0, met: 0 }],
    ]);
  });

  it("shows each habit's figures as the copy froze them, never recounted from its ticks", () => {
    // Figures no rail of this copy would give: they are read, not worked out.
    const copy = version2Copy();
    const [steps, ...rest] = copy.period.habits.perHabit;
    const frozen = { ...steps, eligibleDays: 5, completedDays: 4, pct: 80 };
    const read = readSentSnapshot({
      ...copy,
      period: { ...copy.period, habits: { ...copy.period.habits, perHabit: [frozen, ...rest] } },
    });
    expect(read?.period?.habitWeek.habits[0].figures).toEqual({ planned: 5, done: 4, met: 4 });
    expect(read?.period?.habitWeek.totals).toEqual({ planned: 6, done: 4, met: 4 });
  });

  it("reads in the kernel's key order however jsonb stored it", () => {
    const read = readSentSnapshot(jsonbOrdered(version2Copy()));
    expect(JSON.stringify(read)).toBe(JSON.stringify(readAsCurrent(2)));
  });

  it("keeps a week that could not be resolved as none", () => {
    expect(readSentSnapshot({ ...version2Copy(), period: null })?.period).toBeNull();
  });

  it("refuses a habit rail that does not line up with the week's days: that is corruption", () => {
    const copy = version2Copy();
    const [steps, ...rest] = copy.period.habits.perHabit;
    expect(() =>
      readSentSnapshot({
        ...copy,
        period: { ...copy.period, habits: { ...copy.period.habits, perHabit: [{ ...steps, rail: [true] }, ...rest] } },
      })
    ).toThrow(/does not match its shape/);
  });
});

describe("readSentSnapshot — a version 1 copy reads in the current shape", () => {
  it("its yes or no reads as towards or away, its habits as a habit week, and it keeps its version", () => {
    const read = readSentSnapshot(version1Copy());
    expect(read?.version).toBe(1);
    expect(read?.goalProgress.weight?.position).toEqual({
      current: 78.4,
      remaining: -3.8,
      percentComplete: 38.7,
      status: "approaching",
      trend: "towards",
      paceStatus: "on_track",
    });
    expect(read?.goalProgress.bodyFat?.position?.trend).toBe("away");
    expect(JSON.stringify(read)).toBe(JSON.stringify(readAsCurrent(1)));
  });

  it("keeps an absent pace absent and a row with no reading as none", () => {
    const copy = version1Copy();
    const read = readSentSnapshot({
      ...copy,
      goalProgress: { ...copy.goalProgress, weight: { ...copy.goalProgress.weight, position: null } },
    });
    expect(read?.goalProgress.weight?.position).toBeNull();
    expect("paceStatus" in read!.goalProgress.bodyFat!.position!).toBe(false);
    expect("deadline" in readSentSnapshot({ ...copy, goalProgress: {} })!.goalProgress).toBe(false);
  });

  it("reads in the kernel's key order however jsonb stored it", () => {
    const read = readSentSnapshot(jsonbOrdered(version1Copy()));
    expect(JSON.stringify(read)).toBe(JSON.stringify(readAsCurrent(1)));
  });

  it("is held to version 1's shape: a word for its trend is refused, as is a yes or no in version 2", () => {
    expect(() => readSentSnapshot({ ...version2Copy(), version: 1 })).toThrow(/isOnTrack/);
    expect(() => readSentSnapshot({ ...version1Copy(), version: 2 })).toThrow(/trend/);
  });
});

describe("sentHabitTotals — the client's habit figure, from the copy", () => {
  it("is the frozen week's days met over its days planned", () => {
    expect(sentHabitTotals(parseSentSnapshot(canonicalCopy()))).toEqual({ met: 2, planned: 3 });
  });

  it("reads a version 2 copy's week as it reads every other", () => {
    // 10k steps 1 of 2 and Read 0 of 1: Later was never eligible.
    expect(sentHabitTotals(readSentSnapshot(version2Copy()))).toEqual({ met: 1, planned: 3 });
  });

  it("is null when the copy holds no week, or there is no copy", () => {
    expect(sentHabitTotals(parseSentSnapshot({ ...canonicalCopy(), period: null }))).toBeNull();
    expect(sentHabitTotals(null)).toBeNull();
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
