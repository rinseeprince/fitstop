import { describe, it, expect } from "vitest";
import {
  buildWrites,
  deadlineForRate,
  parseBlockRows,
  projectPlan,
  rateForDeadline,
  seedBlockRows,
  seedGoalPlan,
  toPhasesBody,
  type GoalPlanFormValues,
} from "./goal-plan-model";
import type { ClientPhase } from "@/services/client-phases-service";
import type { ClientGoal } from "@/types/client-goals";

const TODAY = "2026-08-03";

function phase(over: Partial<ClientPhase> & { id: string }): ClientPhase {
  return {
    name: "Cut 1",
    startsOn: "2026-08-03",
    endsOn: "2026-09-27",
    ratePerWeekKg: -0.5,
    dailyTargets: null,
    ...over,
  };
}

function goal(over: Partial<ClientGoal> = {}): ClientGoal {
  return {
    id: "g1",
    clientId: "c1",
    setBy: "coach",
    effectiveFrom: "2026-07-01",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...over,
  };
}

function values(over: Partial<GoalPlanFormValues> = {}): GoalPlanFormValues {
  return {
    startDate: "2026-08-03",
    goalWeight: "",
    goalBodyFat: "",
    deadline: "",
    blocks: [],
    ...over,
  };
}

describe("seedGoalPlan — the start date comes from the blocks", () => {
  // The seeded value IS the phases PUT's `startDate`. Seeding it from the
  // nullable `goal_start_date` instead would show today for a client whose
  // blocks start next month, and the first save would drag every block to today.
  it("prefers phases[0].startsOn over a null goal_start_date", () => {
    const seed = seedGoalPlan({
      goal: goal({ goalWeight: 80 }),
      phases: [phase({ id: "a", startsOn: "2026-08-04", endsOn: "2026-09-28" })],
      unit: "kg",
      clientToday: TODAY,
    });
    expect(seed.values.startDate).toBe("2026-08-04");
  });

  it("prefers phases[0].startsOn over a DISAGREEING goal_start_date, so saving reconciles", () => {
    const seed = seedGoalPlan({
      goal: goal({ goalStartDate: "2026-07-01" }),
      phases: [phase({ id: "a", startsOn: "2026-08-04", endsOn: "2026-09-28" })],
      unit: "kg",
      clientToday: TODAY,
    });
    expect(seed.values.startDate).toBe("2026-08-04");
  });

  it("falls back to the goal, then to the client's today, when there are no blocks", () => {
    expect(
      seedGoalPlan({
        goal: goal({ goalStartDate: "2026-07-01" }),
        phases: [],
        unit: "kg",
        clientToday: TODAY,
      }).values.startDate
    ).toBe("2026-07-01");

    expect(
      seedGoalPlan({ goal: null, phases: [], unit: "kg", clientToday: TODAY }).values
        .startDate
    ).toBe(TODAY);
  });

  it("refuses a non-conforming chain and seeds no editable rows", () => {
    const seed = seedGoalPlan({
      goal: null,
      // A 10-day span: weeksBetween rounds it to 1, so re-chaining would silently
      // shorten it by three days and null every later block's grid.
      phases: [phase({ id: "a", startsOn: "2026-08-03", endsOn: "2026-08-12" })],
      unit: "kg",
      clientToday: TODAY,
    });
    expect(seed.conforming).toBe(false);
    expect(seed.values.blocks).toEqual([]);
  });
});

describe("seedBlockRows — the rate crosses the kg boundary exactly once", () => {
  it("converts a stored kg rate into the client's display unit", () => {
    const [row] = seedBlockRows([phase({ id: "a", ratePerWeekKg: -0.5 })], "lbs");
    expect(row.ratePerWeek).toBe("-1.1");

    const [kgRow] = seedBlockRows([phase({ id: "a", ratePerWeekKg: -0.5 })], "kg");
    expect(kgRow.ratePerWeek).toBe("-0.5");
  });

  it("derives weeks from the stored dates", () => {
    const [row] = seedBlockRows(
      [phase({ id: "a", startsOn: "2026-08-03", endsOn: "2026-09-27" })],
      "kg"
    );
    expect(row.weeks).toBe("8");
  });
});

describe("projectPlan — display units end to end", () => {
  // The 2.4 class, pinned: a stored -0.5 kg/wk is -1.1 lb/wk, so ten weeks moves
  // an lbs client 11 lb, not 5. Forgetting the conversion understates the change
  // 2.2x and always in the "looks safer" direction.
  it("projects an lbs client from a kg-stored rate", () => {
    const rows = parseBlockRows(seedBlockRows([phase({ id: "a" })], "lbs")).map((r) => ({
      ...r,
      weeks: 10,
    }));
    const result = projectPlan({ rows, startDate: TODAY, currentWeight: 200 });
    expect(result?.projectedWeight).toBe(189);
  });

  it("sums a multi-block chain and reports its window", () => {
    const result = projectPlan({
      rows: [
        { name: "Cut 1", weeks: 8, ratePerWeek: -0.5 },
        { name: "Diet break", weeks: 2, ratePerWeek: 0 },
        { name: "Cut 2", weeks: 5, ratePerWeek: -0.4 },
      ],
      startDate: TODAY,
      currentWeight: 82,
      goalWeight: 76,
    });
    expect(result?.totalWeeks).toBe(15);
    expect(result?.startsOn).toBe("2026-08-03");
    expect(result?.endsOn).toBe("2026-11-15");
    expect(result?.projectedWeight).toBe(76);
    expect(result?.verdict).toEqual({ kind: "reached" });
  });

  it("reports falling short and overshooting, with the amount", () => {
    const short = projectPlan({
      rows: [{ name: "Cut", weeks: 10, ratePerWeek: -0.4 }],
      startDate: TODAY,
      currentWeight: 82,
      goalWeight: 76,
    });
    expect(short?.verdict).toEqual({ kind: "short", amount: 2 });

    const past = projectPlan({
      rows: [{ name: "Cut", weeks: 10, ratePerWeek: -0.8 }],
      startDate: TODAY,
      currentWeight: 82,
      goalWeight: 76,
    });
    expect(past?.verdict).toEqual({ kind: "past", amount: 2 });
  });

  it("returns null for an empty chain — there is no plan to describe", () => {
    expect(projectPlan({ rows: [], startDate: TODAY, currentWeight: 82 })).toBeNull();
  });

  it("renders a projection with no verdict when there is no goal to be on track for", () => {
    const result = projectPlan({
      rows: [{ name: "Cut", weeks: 10, ratePerWeek: -0.5 }],
      startDate: TODAY,
      currentWeight: 82,
    });
    expect(result?.projectedWeight).toBe(77);
    expect(result?.verdict).toBeNull();
  });
});

describe("the undefined-current-weight path never constructs NaN", () => {
  // `weightToKg(undefined)` is NaN, and NaN does not throw: it reaches
  // deriveRateFromTarget and renders as "NaN", and goalState's comparisons are
  // all false against it so it falls through to {gap, NaN}. Asserting only
  // `=== null` would pass while an intermediate NaN leaked, so assert both.
  const noNaN = (v: unknown) =>
    expect(JSON.stringify(v ?? null)).not.toContain("null,\"amount\":null");

  it("projectPlan drops the projection and the verdict, and emits no NaN", () => {
    const result = projectPlan({
      rows: [{ name: "Cut", weeks: 10, ratePerWeek: -0.5 }],
      startDate: TODAY,
      currentWeight: undefined,
      goalWeight: 76,
    });
    expect(result?.projectedWeight).toBeNull();
    expect(result?.verdict).toBeNull();
    expect(result?.totalWeeks).toBe(10);
    // Every numeric field is a real number, not NaN.
    expect(Number.isNaN(result?.totalWeeks)).toBe(false);
    noNaN(result);
    expect(JSON.stringify(result)).not.toContain("NaN");
  });

  it("both widget directions return null rather than a NaN rate or date", () => {
    const rate = rateForDeadline({
      currentWeight: undefined,
      goalWeight: 76,
      deadline: "2026-10-11",
      today: TODAY,
      unit: "lbs",
    });
    expect(rate).toBeNull();

    const deadline = deadlineForRate({
      currentWeight: undefined,
      goalWeight: 76,
      ratePerWeek: -1,
      today: TODAY,
      unit: "lbs",
    });
    expect(deadline).toBeNull();
  });

  it("is equally safe with no goal weight", () => {
    expect(
      rateForDeadline({
        currentWeight: 200,
        goalWeight: undefined,
        deadline: "2026-10-11",
        today: TODAY,
        unit: "lbs",
      })
    ).toBeNull();
    expect(
      deadlineForRate({
        currentWeight: 200,
        goalWeight: undefined,
        ratePerWeek: -1,
        today: TODAY,
        unit: "lbs",
      })
    ).toBeNull();
  });
});

describe("the deadline <-> rate widget round-trips in kg", () => {
  // 200 -> 180 lbs over an inclusive 70 days is exactly -2 lb/wk. The trip only
  // closes if BOTH edges convert: drop either one and the rate comes back as
  // -0.91 (kg leaking into a display field) or the deadline lands ~2.2x out.
  it("target + deadline -> rate -> the same deadline, for an lbs client", () => {
    const rate = rateForDeadline({
      currentWeight: 200,
      goalWeight: 180,
      deadline: "2026-10-11",
      today: TODAY,
      unit: "lbs",
    });
    expect(rate).toBe(-2);

    const back = deadlineForRate({
      currentWeight: 200,
      goalWeight: 180,
      ratePerWeek: rate as number,
      today: TODAY,
      unit: "lbs",
    });
    expect(back).toBe("2026-10-11");
  });

  it("round-trips a kg client identically", () => {
    const rate = rateForDeadline({
      currentWeight: 90,
      goalWeight: 80,
      deadline: "2026-10-11",
      today: TODAY,
      unit: "kg",
    });
    expect(rate).toBe(-1);
    expect(
      deadlineForRate({
        currentWeight: 90,
        goalWeight: 80,
        ratePerWeek: -1,
        today: TODAY,
        unit: "kg",
      })
    ).toBe("2026-10-11");
  });

  it("has no deadline for maintenance or a rate pointing away from the goal", () => {
    const base = { currentWeight: 90, goalWeight: 80, today: TODAY, unit: "kg" as const };
    expect(deadlineForRate({ ...base, ratePerWeek: 0 })).toBeNull();
    expect(deadlineForRate({ ...base, ratePerWeek: 0.5 })).toBeNull();
  });
});

describe("toPhasesBody — lengths only, rate back into kg", () => {
  it("converts the display rate to kg and drops absent ids", () => {
    const body = toPhasesBody(
      "2026-08-03",
      [
        { id: "a", name: " Cut 1 ", weeks: "8", ratePerWeek: "-1.1" },
        { name: "Cut 2", weeks: "6", ratePerWeek: "-0.5" },
      ],
      "lbs"
    );
    expect(body.startDate).toBe("2026-08-03");
    expect(body.phases[0].id).toBe("a");
    expect(body.phases[0].name).toBe("Cut 1");
    expect(body.phases[0].ratePerWeekKg).toBeCloseTo(-0.499, 3);
    expect(body.phases[1]).not.toHaveProperty("id");
    // Lengths only — a date pair would be a 400 against the .strict() schema.
    expect(Object.keys(body.phases[0]).sort()).toEqual([
      "id",
      "name",
      "ratePerWeekKg",
      "weeks",
    ]);
  });
});

describe("buildWrites — two independent writes (invariant 7)", () => {
  const storedGoal = goal({
    goalWeight: 76,
    goalBodyFatPercentage: 18,
    goalDeadline: "2026-11-15",
    goalStartDate: "2026-08-03",
  });
  const storedPhases = [
    phase({ id: "a", name: "Cut 1", startsOn: "2026-08-03", endsOn: "2026-09-27" }),
  ];

  function seededValues(unit: "lbs" | "kg" = "kg"): GoalPlanFormValues {
    return seedGoalPlan({
      goal: storedGoal,
      phases: storedPhases,
      unit,
      clientToday: TODAY,
    }).values;
  }

  // The rate crosses kg->display->kg, so a naive value comparison would report a
  // change on every open. Diffing the PAYLOADS makes an untouched form exact.
  it("writes NOTHING when nothing changed, in either unit", () => {
    for (const unit of ["kg", "lbs"] as const) {
      const writes = buildWrites({
        goal: storedGoal,
        phases: storedPhases,
        values: seededValues(unit),
        unit,
        conforming: true,
      });
      expect(writes).toEqual({});
    }
  });

  it("writes ONLY the goal when a goal field changed", () => {
    const writes = buildWrites({
      goal: storedGoal,
      phases: storedPhases,
      values: { ...seededValues(), goalWeight: "74" },
      unit: "kg",
      conforming: true,
    });
    expect(writes.goal?.goalWeight).toBe(74);
    expect(writes.phases).toBeUndefined();
  });

  it("writes ONLY the blocks when a block changed — renaming must not mint a goal version", () => {
    const seeded = seededValues();
    const writes = buildWrites({
      goal: storedGoal,
      phases: storedPhases,
      values: {
        ...seeded,
        blocks: [{ ...seeded.blocks[0], name: "Cutting phase 1" }],
      },
      unit: "kg",
      conforming: true,
    });
    expect(writes.goal).toBeUndefined();
    expect(writes.phases?.phases[0].name).toBe("Cutting phase 1");
  });

  it("writes BOTH when the shared start date moved", () => {
    const writes = buildWrites({
      goal: storedGoal,
      phases: storedPhases,
      values: { ...seededValues(), startDate: "2026-08-10" },
      unit: "kg",
      conforming: true,
    });
    expect(writes.goal?.goalStartDate).toBe("2026-08-10");
    expect(writes.phases?.startDate).toBe("2026-08-10");
  });

  // The self-heal for a blocks-succeeded/goal-failed save: the seed takes the
  // blocks' start, which no longer matches the goal column, so the retry is
  // detected without the coach touching anything.
  it("retries an outstanding goal write when the two stores disagree", () => {
    const stale = goal({ ...storedGoal, goalStartDate: "2026-07-01" });
    const writes = buildWrites({
      goal: stale,
      phases: storedPhases,
      values: seedGoalPlan({
        goal: stale,
        phases: storedPhases,
        unit: "kg",
        clientToday: TODAY,
      }).values,
      unit: "kg",
      conforming: true,
    });
    expect(writes.goal?.goalStartDate).toBe("2026-08-03");
    expect(writes.phases).toBeUndefined();
  });

  it("never writes blocks for a refused chain, but still allows the goal", () => {
    const writes = buildWrites({
      goal: storedGoal,
      phases: storedPhases,
      values: { ...seededValues(), goalWeight: "74", blocks: [] },
      unit: "kg",
      conforming: false,
    });
    expect(writes.goal?.goalWeight).toBe(74);
    expect(writes.phases).toBeUndefined();
  });

  it("sends no phases write when the client has no blocks and none were added", () => {
    const writes = buildWrites({
      goal: null,
      phases: [],
      values: values({ goalWeight: "76" }),
      unit: "kg",
      conforming: true,
    });
    expect(writes.goal?.goalWeight).toBe(76);
    expect(writes.phases).toBeUndefined();
  });

  it("omits the goal write entirely when no goal weight is set — it cannot be cleared", () => {
    const writes = buildWrites({
      goal: null,
      phases: [],
      values: values({ goalWeight: "", deadline: "2026-11-15" }),
      unit: "kg",
      conforming: true,
    });
    expect(writes.goal).toBeUndefined();
  });
});
