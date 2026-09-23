import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { goalProgressChip } from "./goal-chip";
import { goalResult, type ReadingDays } from "./goal-result";

// A day in another year carries its year, so today is pinned.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-23T12:00:00"));
});
afterEach(() => vi.useRealTimers());

const days = (...points: Array<[date: string, value: number]>): ReadingDays =>
  points.map(([date, value]) => ({ date, value }));
const NONE: ReadingDays = [];

// Cut: lose weight to 79.4 kg, 4 May – 28 Jun, deadline 26 Jun.
const cut = {
  type: "lose_weight" as const,
  status: "ended" as const,
  startsOn: "2026-05-04",
  endsOn: "2026-06-28",
  deadline: "2026-06-26",
  targets: { weight: 79.4, bodyFat: null },
};

const weights = (weight: ReadingDays) => ({ weight, bodyFat: NONE });

describe("goalResult — a goal that has ended", () => {
  it("was reached, on the first day a reading met its target", () => {
    const readings = days(["2026-04-30", 83.2], ["2026-05-20", 81.1], ["2026-06-10", 79.3], ["2026-06-20", 79.8]);
    expect(goalResult(cut, weights(readings), "kg")).toEqual([
      { kind: "verdict", text: "Reached 10 June", tone: "positive" },
    ]);
  });

  it("counts a reading within the card's tolerance of the target as met", () => {
    const readings = days(["2026-04-30", 83.2], ["2026-06-03", 79.44]);
    expect(goalResult(cut, weights(readings), "kg")[0]).toMatchObject({ text: "Reached 3 June" });
  });

  it("was reached on its first day when the reading then already met it", () => {
    expect(goalResult(cut, weights(days(["2026-04-30", 79.2], ["2026-05-25", 80.6])), "kg")[0]).toMatchObject({
      text: "Reached 4 May",
    });
  });

  it("was reached late, after its deadline but while it ran — reached wins", () => {
    const readings = days(["2026-04-30", 83.2], ["2026-06-24", 80.7], ["2026-06-27", 79.4]);
    expect(goalResult(cut, weights(readings), "kg")[0]).toMatchObject({ text: "Reached 27 June" });
  });

  it("missed its deadline by how far the reading on that day was from the target", () => {
    const readings = days(["2026-04-30", 83.2], ["2026-06-24", 80.7], ["2026-06-27", 80.1]);
    expect(goalResult(cut, weights(readings), "kg")).toEqual([
      { kind: "verdict", text: "Missed by 1.3 kg", tone: "warning" },
    ]);
  });

  it("missed a deadline on its last day, the day it came while it ran", () => {
    const readings = days(["2026-04-30", 83.2], ["2026-06-27", 80.6]);
    expect(goalResult({ ...cut, deadline: "2026-06-28" }, weights(readings), "kg")[0]).toMatchObject({
      text: "Missed by 1.2 kg",
    });
  });

  it("ended short, judged on its last day, when no reading stood by its deadline", () => {
    // The first reading came after the deadline, and none met the target
    const readings = days(["2026-06-02", 85.1], ["2026-06-25", 81.8]);
    expect(goalResult({ ...cut, deadline: "2026-05-20" }, weights(readings), "kg")).toEqual([
      { kind: "verdict", text: "Ended 2.4 kg short", tone: "warning" },
    ]);
  });

  it("gives the year of a day that isn't this year's", () => {
    const lastYear = { ...cut, startsOn: "2025-05-05", endsOn: "2025-06-29", deadline: "2025-06-27" };
    const readings = days(["2025-05-01", 83.6], ["2025-06-11", 79.1]);
    expect(goalResult(lastYear, weights(readings), "kg")[0]).toMatchObject({ text: "Reached 11 June 2025" });
  });

  it("ended before its deadline short by how far its last day's reading was", () => {
    const readings = days(["2026-04-30", 83.2], ["2026-06-24", 80.7], ["2026-06-27", 80.1]);
    const replacedEarly = { ...cut, deadline: "2026-07-20" };
    expect(goalResult(replacedEarly, weights(readings), "kg")).toEqual([
      { kind: "verdict", text: "Ended 0.7 kg short", tone: "warning" },
    ]);
    expect(goalResult({ ...cut, deadline: null }, weights(readings), "kg")[0]).toMatchObject({
      text: "Ended 0.7 kg short",
    });
  });

  it("judges in the goal type's direction: under a build-muscle target is short", () => {
    const build = { ...cut, type: "build_muscle" as const, targets: { weight: 84.6, bodyFat: null } };
    const readings = days(["2026-04-30", 80.3], ["2026-06-24", 83.9]);
    expect(goalResult(build, weights(readings), "kg")[0]).toMatchObject({ text: "Missed by 0.7 kg" });
  });

  it("says there is no reading when none was in force", () => {
    expect(goalResult(cut, weights(NONE), "kg")).toEqual([{ kind: "noReading" }]);
    // The first reading came after the goal ended
    expect(goalResult(cut, weights(days(["2026-07-05", 78.8])), "kg")).toEqual([{ kind: "noReading" }]);
  });

  it("reads each target it has, weight first", () => {
    const recomp = { ...cut, type: "recomposition" as const, targets: { weight: 79.4, bodyFat: 18.5 } };
    const readings = {
      weight: days(["2026-04-30", 83.2], ["2026-06-24", 80.1]),
      bodyFat: days(["2026-04-30", 22.4], ["2026-06-15", 18.4]),
    };
    expect(goalResult(recomp, readings, "kg")).toEqual([
      { kind: "verdict", text: "Missed by 0.7 kg", tone: "warning" },
      { kind: "verdict", text: "Reached 15 June", tone: "positive" },
    ]);
  });
});

describe("goalResult — today's goal and a planned one", () => {
  const build = {
    type: "build_muscle" as const,
    status: "current" as const,
    startsOn: "2026-06-29",
    endsOn: null,
    deadline: "2026-10-09",
    targets: { weight: 84.6, bodyFat: null },
  };
  const readings = days(["2026-06-25", 80.3], ["2026-08-30", 82.8], ["2026-09-20", 83.7]);

  it("is the goal card's chip, from the goals read's start readings and the newest reading", () => {
    const withStart = { ...build, startReadings: { weight: 80.1, bodyFat: null } };
    const card = goalProgressChip({ type: "build_muscle", metric: "weight", start: 80.1, current: 83.7, target: 84.6, unit: "kg" });
    expect(goalResult(withStart, weights(readings), "kg")).toEqual([{ kind: "verdict", ...card }]);
    expect(card).toEqual({ text: "0.9 kg to go", tone: "warning" });
  });

  it("is the card's chip in the viewer's units: a margin the kilogram misses, the pound does not", () => {
    // 79.43 kg against a 79.4 kg target is reached in kilograms and 0.1 lbs short in pounds
    const lbs = (kg: number) => kg * 2.20462;
    const cutting = { ...build, type: "lose_weight" as const, targets: { weight: 79.4, bodyFat: null } };
    const inKg = goalResult(cutting, weights(days(["2026-06-25", 84.1], ["2026-09-20", 79.43])), "kg");
    const inLbs = goalResult(
      { ...cutting, targets: { weight: lbs(79.4), bodyFat: null } },
      weights(days(["2026-06-25", lbs(84.1)], ["2026-09-20", lbs(79.43)])),
      "lbs"
    );
    expect(inKg[0]).toMatchObject({ text: "Goal reached" });
    expect(inLbs[0]).toEqual({
      kind: "verdict",
      ...goalProgressChip({
        type: "lose_weight",
        metric: "weight",
        start: lbs(84.1),
        current: lbs(79.43),
        target: lbs(79.4),
        unit: "lbs",
      }),
    });
    expect(inLbs[0]).toMatchObject({ text: "0.1 lbs to go" });
  });

  it("takes its direction from the start the goals read gives, else from the reading on its start day", () => {
    // Event prep sets no direction: the side of the start the target sits on does
    const prep = { ...build, type: "event_prep" as const, targets: { weight: 82.0, bodyFat: null } };
    expect(goalResult({ ...prep, startReadings: { weight: 85.0, bodyFat: null } }, weights(readings), "kg")[0]).toMatchObject({
      text: "1.7 kg to go",
    });
    expect(goalResult(prep, weights(readings), "kg")[0]).toMatchObject({ text: "1.7 kg over goal" });
  });

  it("says there is no reading when the client has none", () => {
    expect(goalResult(build, weights(NONE), "kg")).toEqual([{ kind: "noReading" }]);
  });

  it("is planned for a planned goal, whatever its targets", () => {
    expect(goalResult({ ...build, status: "planned" }, weights(readings), "kg")).toEqual([{ kind: "planned" }]);
  });
});

describe("goalResult — a goal with no targets", () => {
  const maintain = {
    type: "maintain" as const,
    status: "ended" as const,
    startsOn: "2026-05-04",
    endsOn: "2026-06-28",
    deadline: null,
    targets: { weight: null, bodyFat: null },
  };
  const readings = days(["2026-04-30", 83.2], ["2026-06-12", 82.1], ["2026-07-08", 81.5]);

  it("shows its weight change over its days: its last day's reading against its start", () => {
    const [line] = goalResult(maintain, weights(readings), "kg");
    expect(line.kind).toBe("change");
    expect(line.kind === "change" && line.amount).toBeCloseTo(-1.1, 5);
  });

  it("runs to the newest reading while it is today's goal", () => {
    const [line] = goalResult({ ...maintain, status: "current", endsOn: null }, weights(readings), "kg");
    expect(line.kind === "change" && line.amount).toBeCloseTo(-1.7, 5);
  });

  it("measures from the first reading after its start when none came before", () => {
    const [line] = goalResult(maintain, weights(days(["2026-05-10", 82.4], ["2026-06-20", 81.6])), "kg");
    expect(line.kind === "change" && line.amount).toBeCloseTo(-0.8, 5);
  });

  it("says there is no reading without one", () => {
    expect(goalResult(maintain, weights(NONE), "kg")).toEqual([{ kind: "noReading" }]);
  });

  it("claims no change when nothing was weighed after the reading it runs from", () => {
    // 30 Apr is where it runs from and still the reading on its last day
    const untouched = weights(days(["2026-04-30", 83.2], ["2026-07-08", 81.5]));
    expect(goalResult(maintain, untouched, "kg")).toEqual([{ kind: "noReading" }]);
    expect(goalResult({ ...maintain, status: "current", endsOn: null }, weights(days(["2026-04-30", 83.2])), "kg")).toEqual([
      { kind: "noReading" },
    ]);
  });
});
