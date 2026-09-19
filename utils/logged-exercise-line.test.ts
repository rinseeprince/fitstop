import { describe, expect, it } from "vitest";
import type { SetSpec } from "./exercise-set-specs";
import type { LoggedSetInput } from "./logged-set-rows";
import { describeLoggedExercise } from "./logged-exercise-line";

// The check-in AI's line for one logged exercise (owner, 2026-09-18): the
// prescription and the result measure by measure, every measure outside its
// target named, the coach's units, and nothing missing printed as a zero.

function spec(overrides: Partial<SetSpec>): SetSpec {
  return { set_number: 1, set_type: "working", ...overrides };
}

function set(setNumber: number, actuals: Omit<LoggedSetInput, "setNumber"> = {}): LoggedSetInput {
  return { setNumber, ...actuals };
}

const squat = {
  name: "Barbell Back Squat",
  prescribed_fields: ["set_type", "load", "reps", "rpe", "rest"],
  set_specs: [
    spec({ set_number: 1, set_type: "warmup", reps_min: 5, reps_max: 5, load_type: "absolute", load_min: 60, load_max: 60 }),
    ...[2, 3, 4].map((n) =>
      spec({ set_number: n, reps_min: 5, reps_max: 5, load_type: "absolute", load_min: 100, load_max: 105, rpe_min: 8, rpe_max: 8, rest_seconds: 120 }),
    ),
  ],
};

describe("describeLoggedExercise", () => {
  it("gives the working sets done, then each measure beside its target, naming every one outside it", () => {
    const line = describeLoggedExercise({
      performedName: null,
      snapshot: squat,
      sets: [
        // The warm-up is recorded but never scored: it is left out entirely.
        set(1, { reps: 5, weight: 70, rpe: 6 }),
        set(2, { reps: 5, weight: 102.5, rpe: 8 }),
        set(3, { reps: 5, weight: 102.5, rpe: 9 }),
        set(4, { reps: 4, weight: 107.5, rpe: 10 }),
      ],
      viewer: "metric",
    });
    expect(line).toBe(
      "Barbell Back Squat — 3 of 3 working sets: " +
        "Load (kg) 102.5, 102.5, 107.5 (target 100–105 kg; 1 of 3 above target); " +
        "Reps 5, 5, 4 (target 5; 1 of 3 below target); " +
        "RPE 8, 9, 10 (target 8; 2 of 3 above target)",
    );
  });

  it("reads in the coach's units", () => {
    const line = describeLoggedExercise({
      performedName: null,
      snapshot: squat,
      sets: [set(2, { reps: 5, weight: 102.5 })],
      viewer: "imperial",
    });
    expect(line).toContain("Load (lbs) 225 (target 220–232.5 lbs)");
  });

  it("prints a measure nobody recorded as not recorded, and never a zero", () => {
    const line = describeLoggedExercise({
      performedName: null,
      snapshot: squat,
      sets: [set(2, { reps: 5 }), set(3, { reps: 5, weight: 100 })],
      viewer: "metric",
    });
    expect(line).toBe(
      "Barbell Back Squat — 2 of 3 working sets: " +
        "Load (kg) —, 100 (target 100–105 kg); " +
        "Reps 5, 5 (target 5); " +
        "RPE not recorded (target 8)",
    );
    expect(line).not.toMatch(/\b0x0\b|\btop\b/);
  });

  it("never marks a % load, which can't be compared with kilograms", () => {
    const line = describeLoggedExercise({
      performedName: null,
      snapshot: {
        name: "Bench Press",
        prescribed_fields: ["set_type", "load", "reps"],
        set_specs: [spec({ reps_min: 5, reps_max: 5, load_type: "pct_1rm", load_min: 75, load_max: 80 })],
      },
      sets: [set(1, { reps: 5, weight: 140 })],
      viewer: "metric",
    });
    expect(line).toBe("Bench Press — 1 of 1 working set: Load (kg) 140 (target 75–80% 1RM); Reps 5 (target 5)");
  });

  it("describes a run in its own measures, with their units", () => {
    const line = describeLoggedExercise({
      performedName: null,
      snapshot: {
        name: "Running",
        prescribed_fields: ["set_type", "distance", "duration", "pace", "heart_rate_zone", "rest"],
        set_specs: [
          spec({
            distance_meters_min: 5000,
            distance_meters_max: 5000,
            duration_seconds_min: 1500,
            duration_seconds_max: 1620,
            pace_seconds_per_km_min: 300,
            pace_seconds_per_km_max: 320,
            heart_rate_zone_min: 3,
            heart_rate_zone_max: 3,
          }),
        ],
      },
      sets: [set(1, { distanceMeters: 5020, durationSeconds: 1570, paceSecondsPerKm: 313, heartRateZone: 4 })],
      viewer: "metric",
    });
    expect(line).toBe(
      "Running — 1 of 1 working set: " +
        "Distance 5.02 km (target 5 km; above target); " +
        "Duration 26:10 (target 25:00–27:00); " +
        "Pace 5:13 /km (target 5:00–5:20 /km); " +
        "HR zone Z4 (target Z3; above target)",
    );
  });

  it("lists each set's target when the targets differ, and names a differing tempo", () => {
    const line = describeLoggedExercise({
      performedName: null,
      snapshot: {
        name: "Front Squat",
        prescribed_fields: ["set_type", "reps", "tempo"],
        set_specs: [
          spec({ set_number: 1, reps_min: 12, reps_max: 12, tempo: "3-1-X-0" }),
          spec({ set_number: 2, reps_min: 10, reps_max: 10, tempo: "3-1-X-0" }),
          spec({ set_number: 3, reps_min: 8, reps_max: 8, tempo: "3-1-X-0" }),
        ],
      },
      sets: [
        set(1, { reps: 12, tempo: "3-1-X-0" }),
        set(2, { reps: 10, tempo: "2-0-X-0" }),
        set(3, { reps: 8, tempo: "2-0-X-0" }),
      ],
      viewer: "metric",
    });
    expect(line).toBe(
      "Front Squat — 3 of 3 working sets: " +
        "Reps 12, 10, 8 (target 12, 10, 8); " +
        "Tempo 3-1-X-0, 2-0-X-0, 2-0-X-0 (target 3-1-X-0; 2 of 3 differ from target)",
    );
  });

  it("says when every set fell on one side", () => {
    const line = describeLoggedExercise({
      performedName: null,
      snapshot: {
        name: "Push Up",
        prescribed_fields: ["set_type", "reps"],
        set_specs: [1, 2].map((n) => spec({ set_number: n, reps_min: 15, reps_max: 15 })),
      },
      sets: [set(1, { reps: 12 }), set(2, { reps: 10 })],
      viewer: "metric",
    });
    expect(line).toBe("Push Up — 2 of 2 working sets: Reps 12, 10 (target 15; both below target)");
  });

  it("adds a measure the client recorded that the coach didn't prescribe", () => {
    const line = describeLoggedExercise({
      performedName: null,
      snapshot: {
        name: "Push Up",
        prescribed_fields: ["set_type", "reps"],
        set_specs: [spec({ reps_min: 15, reps_max: 15 })],
      },
      sets: [set(1, { reps: 15, rir: 1 })],
      viewer: "metric",
    });
    expect(line).toBe("Push Up — 1 of 1 working set: Reps 15 (target 15); RIR 1");
  });

  it("gives the rest taken beside the rest the set prescribes, when the app recorded one", () => {
    const line = describeLoggedExercise({
      performedName: null,
      snapshot: squat,
      sets: [set(2, { reps: 5, weight: 102.5, rpe: 8, restSeconds: 150 })],
      viewer: "metric",
    });
    expect(line).toContain("; Rest 2m 30s (target 2m; above target)");
  });

  it("gives no rest target where the rows are a superset's rounds, whose rests are the group's", () => {
    const line = describeLoggedExercise({
      performedName: null,
      snapshot: {
        name: "Barbell Row",
        prescribed_fields: ["set_type", "reps", "rest"],
        group: { id: "g-1", order_index: 2, format: "circuit", rounds: 2, rest_between_exercises_seconds: 30 },
        set_specs: [1, 2].map((n) => spec({ set_number: n, reps_min: 8, reps_max: 8, rest_seconds: 90 })),
      },
      sets: [set(1, { reps: 8, restSeconds: 40 }), set(2, { reps: 8 })],
      viewer: "metric",
    });
    expect(line).toBe("Barbell Row — 2 of 2 working sets: Reps 8, 8 (target 8); Rest 40s, —");
  });

  it("names the exercise a swap replaced", () => {
    const line = describeLoggedExercise({
      performedName: "Dumbbell Bench Press",
      snapshot: {
        name: "Barbell Bench Press",
        prescribed_fields: ["set_type", "reps"],
        set_specs: [spec({ reps_min: 8, reps_max: 8 })],
      },
      sets: [set(1, { reps: 8 })],
      viewer: "metric",
    });
    expect(line).toBe(
      "Dumbbell Bench Press, in place of Barbell Bench Press — 1 of 1 working set: Reps 8 (target 8)",
    );
  });

  it("describes an exercise logged outside the plan by what was recorded", () => {
    const line = describeLoggedExercise({
      performedName: "Farmer Carry",
      snapshot: null,
      sets: [set(1, { weight: 40, distanceMeters: 20 }), set(2, { weight: 40, distanceMeters: 20 })],
      viewer: "metric",
    });
    expect(line).toBe("Farmer Carry — 2 sets, not in the plan: Load (kg) 40, 40; Distance 20 m, 20 m");
  });

  it("counts sets logged past the prescription against what was prescribed", () => {
    const line = describeLoggedExercise({
      performedName: null,
      snapshot: { name: "Plank", prescribed_fields: ["set_type", "reps"], set_specs: [spec({})] },
      sets: [set(1), set(2)],
      viewer: "metric",
    });
    expect(line).toBe("Plank — 2 working sets (1 prescribed), no values recorded");
  });

  it("says when only warm-ups were logged", () => {
    const line = describeLoggedExercise({
      performedName: null,
      snapshot: squat,
      sets: [set(1, { reps: 5, weight: 60 })],
      viewer: "metric",
    });
    expect(line).toBe("Barbell Back Squat — warm-up sets only");
  });

  it("sanitises a free-text rep target a coach typed", () => {
    const line = describeLoggedExercise({
      performedName: null,
      snapshot: { name: "Lunge", prescribed_fields: ["set_type", "reps"], sets: 1, reps_target: "10\u200Beach\u0007" },
      sets: [set(1, { reps: 10 })],
      viewer: "metric",
    });
    expect(line).toBe("Lunge — 1 of 1 working set: Reps 10 (target 10each)");
  });

  it("sanitises the names it prints", () => {
    const line = describeLoggedExercise({
      performedName: "Squat​",
      snapshot: null,
      sets: [set(1, { reps: 5 })],
      viewer: "metric",
    });
    expect(line.startsWith("Squat — 1 set, not in the plan")).toBe(true);
  });
});

// An exercise in a group done by its score — an AMRAP or a For time — reads
// its rows as the work of a round, never as a count of sets done: the group's
// own line carries the score.
describe("an exercise in an AMRAP or For time", () => {
  const swing = {
    name: "Kettlebell Swing",
    order_index: 0,
    group: { id: "g-amrap", order_index: 0, format: "amrap", rounds: null, time_cap_seconds: 720 },
    prescribed_fields: ["set_type", "reps", "load"],
    set_specs: [spec({ set_number: 1, reps_min: 10, reps_max: 10, load_type: "absolute", load_min: 24, load_max: 24 })],
  };

  it("reads per round, with the values recorded, and never a set count", () => {
    expect(
      describeLoggedExercise({ performedName: null, snapshot: swing, sets: [set(1, { reps: 10, weight: 24 })], viewer: "metric" }),
    ).toBe("Kettlebell Swing — per round: Load (kg) 24 (target 24 kg); Reps 10 (target 10)");
    // The client added rounds: each row is one; a row past the one prescribed carries no target of its own.
    expect(
      describeLoggedExercise({
        performedName: null,
        snapshot: swing,
        sets: [set(1, { reps: 10 }), set(2, { reps: 10 }), set(3, { reps: 8 })],
        viewer: "metric",
      }),
    ).toBe(
      "Kettlebell Swing — per round: Load (kg) not recorded (target 24 kg, —, —); Reps 10, 10, 8 (target 10, —, —)",
    );
    expect(
      describeLoggedExercise({ performedName: null, snapshot: swing, sets: [set(1)], viewer: "metric" }),
    ).toBe("Kettlebell Swing — per round: Load (kg) not recorded (target 24 kg); Reps not recorded (target 10)");
  });

  it("an EMOM's exercise keeps the set count, as a circuit's does", () => {
    const burpee = { ...swing, name: "Burpee", group: { ...swing.group, format: "emom", rounds: 3, interval_seconds: 60 }, prescribed_fields: ["set_type", "reps"], set_specs: [1, 2, 3].map((n) => spec({ set_number: n, reps_min: 5, reps_max: 5 })) };
    expect(
      describeLoggedExercise({ performedName: null, snapshot: burpee, sets: [set(1, { reps: 5 }), set(2, { reps: 5 })], viewer: "metric" }),
    ).toBe("Burpee — 2 of 3 working sets: Reps 5, 5 (target 5)");
  });
});
