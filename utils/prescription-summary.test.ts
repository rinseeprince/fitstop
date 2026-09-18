import { describe, expect, it } from "vitest";
import type { SetSpec } from "./exercise-set-specs";
import { buildPrescribedRows } from "./set-spec-rows";
import { formatPrescriptionSummary } from "./prescription-summary";
import type { PrescribedField } from "./prescribed-fields";

const FIVE: PrescribedField[] = ["set_type", "reps", "load", "rpe", "rest"];

function spec(over: Partial<SetSpec> & { set_number: number }): SetSpec {
  return { set_type: "working", ...over };
}

function line(
  specs: SetSpec[],
  fields: PrescribedField[],
  over: { restSeconds?: number | null; roundsAreRows?: boolean; viewer?: "metric" | "imperial" } = {},
) {
  return formatPrescriptionSummary({
    rows: buildPrescribedRows(specs),
    fields: new Set(fields),
    restSeconds: over.restSeconds ?? null,
    roundsAreRows: over.roundsAreRows ?? false,
    viewer: over.viewer ?? "metric",
  });
}

const strength = [1, 2, 3].map((n) =>
  spec({
    set_number: n,
    reps_min: 8,
    reps_max: 12,
    load_type: "absolute",
    load_min: 100,
    load_max: 105,
    rpe_min: 7,
    rpe_max: 8,
    tempo: "3-1-X-0",
  }),
);

describe("formatPrescriptionSummary", () => {
  it("reads a strength prescription as every prescribed measure, in the columns' order", () => {
    expect(line(strength, FIVE, { restSeconds: 90 })).toBe("3 × 8–12 · 100–105 kg · RPE 7–8 · 1m 30s rest");
  });

  it("reads an endurance prescription with the distance leading", () => {
    const run = Array.from({ length: 6 }, (_, i) =>
      spec({ set_number: i + 1, distance_meters_min: 800, distance_meters_max: 800, pace_seconds_per_km_min: 225, pace_seconds_per_km_max: 230 }),
    );
    expect(line(run, ["set_type", "distance", "pace", "rest"])).toBe("6 × 800 m · 3:45–3:50 /km");
    expect(line(run, ["set_type", "distance", "pace", "rest"], { viewer: "imperial" })).toBe("6 × 875 yd · 6:02–6:10 /mi");
  });

  it("shows only the columns the coach prescribes", () => {
    expect(line(strength, ["set_type", "reps", "rest"])).toBe("3 × 8–12");
    expect(line(strength, ["set_type", "reps", "tempo"])).toBe("3 × 8–12 · tempo 3-1-X-0");
    expect(line(strength, ["set_type", "rpe"])).toBe("3 sets · RPE 7–8");
  });

  it("reads each measure's span across the working sets, warm-ups and drops left out", () => {
    const specs = [
      spec({ set_number: 1, set_type: "warmup", reps_min: 15, reps_max: 20 }),
      spec({ set_number: 2, reps_min: 10, reps_max: 12 }),
      spec({ set_number: 3, reps_min: 8, reps_max: 10 }),
      spec({ set_number: 4, set_type: "drop", reps_min: 8, reps_max: 8, load_type: "absolute", load_min: 80, load_max: 80, drops: [{ load_value: 60, reps: 8 }] }),
    ];
    expect(line(specs, FIVE)).toBe("3 × 8–12 · 80 kg");
  });

  it("omits a load whose sets mix units", () => {
    const mixed = [
      spec({ set_number: 1, reps_min: 5, reps_max: 5, load_type: "absolute", load_min: 100, load_max: 100 }),
      spec({ set_number: 2, reps_min: 5, reps_max: 5, load_type: "pct_1rm", load_min: 80, load_max: 80 }),
    ];
    expect(line(mixed, FIVE)).toBe("2 × 5");
  });

  it("where rows are rounds, reads the reps round by round and no rest of its own", () => {
    const rounds = [21, 15, 9].map((r, i) => spec({ set_number: i + 1, reps_min: r, reps_max: r, rpe_min: 8, rpe_max: 8 }));
    expect(line(rounds, FIVE, { restSeconds: 90, roundsAreRows: true })).toBe("21-15-9 reps · RPE 8");
  });

  it("leads with a duration when that is what the sets are of, else counts sets", () => {
    const holds = [1, 2].map((n) => spec({ set_number: n, duration_seconds_min: 45, duration_seconds_max: 60 }));
    expect(line(holds, ["set_type", "duration"])).toBe("2 × 0:45–1:00");
    const erg = [spec({ set_number: 1, calories_min: 300, calories_max: 300 })];
    expect(line(erg, ["set_type", "calories"])).toBe("1 sets · 300 kcal".replace("1 sets", "1 sets"));
  });

  it("keeps a legacy free-text rep target as the head", () => {
    expect(line([spec({ set_number: 1, reps_target: "AMRAP" })], FIVE)).toBe("1 × AMRAP");
  });

  it("reads nothing for an exercise with no rows", () => {
    expect(line([], FIVE)).toBe("");
  });
});
