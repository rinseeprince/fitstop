import { describe, expect, it } from "vitest";
import type { SetSpec } from "./exercise-set-specs";
import { buildPrescribedRows, type PrescribedRow } from "./set-spec-rows";
import { emptyLoggedActuals, type LoggedActuals } from "./set-log-measures";
import {
  boxGap,
  rangeGap,
  restGap,
  restTarget,
  rpeWellAbove,
  tempoDiffers,
} from "./target-gap";

// The one judgement the coach's table colours by and the check-in AI names:
// where a logged value sits against its target, at the precision both are shown.

function row(spec: Partial<SetSpec>): PrescribedRow {
  return buildPrescribedRows([{ set_number: 1, set_type: "working", ...spec }])[0];
}

function did(actuals: Partial<LoggedActuals>): LoggedActuals {
  return { ...emptyLoggedActuals(), ...actuals };
}

describe("rangeGap", () => {
  it("is null inside the range, at either end included", () => {
    expect(rangeGap({ min: 8, max: 10 }, 8)).toBeNull();
    expect(rangeGap({ min: 8, max: 10 }, 10)).toBeNull();
  });

  it("names the side a value falls outside on", () => {
    expect(rangeGap({ min: 8, max: 10 }, 7)).toBe("below");
    expect(rangeGap({ min: 8, max: 10 }, 11)).toBe("above");
  });

  it("reads a single value as a range with no width", () => {
    expect(rangeGap({ min: 5, max: 5 }, 5)).toBeNull();
    expect(rangeGap({ min: 5, max: 5 }, 6)).toBe("above");
  });

  it("judges a half-open range by the end it has", () => {
    expect(rangeGap({ min: 8, max: null }, 20)).toBeNull();
    expect(rangeGap({ min: 8, max: null }, 7)).toBe("below");
    expect(rangeGap({ min: null, max: 12 }, 1)).toBeNull();
    expect(rangeGap({ min: null, max: 12 }, 13)).toBe("above");
  });
});

describe("boxGap", () => {
  it("marks a value outside its target, below as well as above", () => {
    const reps = row({ reps_min: 8, reps_max: 10 });
    expect(boxGap("reps", reps, did({ reps: 9 }), "metric")).toBeNull();
    expect(boxGap("reps", reps, did({ reps: 7 }), "metric")).toBe("below");
    expect(boxGap("reps", reps, did({ reps: 11 }), "metric")).toBe("above");
  });

  it("compares nothing when either side is missing", () => {
    expect(boxGap("rpe", row({ rpe_min: 8, rpe_max: 8 }), did({}), "metric")).toBeNull();
    expect(boxGap("rpe", row({}), did({ rpe: 9 }), "metric")).toBeNull();
    expect(boxGap("rpe", null, did({ rpe: 9 }), "metric")).toBeNull();
    expect(boxGap("rpe", row({ rpe_min: 8, rpe_max: 8 }), null, "metric")).toBeNull();
  });

  it("never marks the reps of a to-failure set, which prescribes none", () => {
    const failure = row({ set_type: "failure", reps_min: 8, reps_max: 8 });
    expect(boxGap("reps", failure, did({ reps: 20 }), "metric")).toBeNull();
  });

  it("compares a kilogram load with the kilograms lifted", () => {
    const load = row({ load_type: "absolute", load_min: 100, load_max: 105 });
    expect(boxGap("load", load, did({ weight: 102.5 }), "metric")).toBeNull();
    expect(boxGap("load", load, did({ weight: 107.5 }), "metric")).toBe("above");
    expect(boxGap("load", load, did({ weight: 95 }), "metric")).toBe("below");
  });

  it("never marks a % load: a percentage can't be compared with kilograms", () => {
    expect(
      boxGap("load", row({ load_type: "pct_1rm", load_min: 75, load_max: 80 }), did({ weight: 140 }), "metric"),
    ).toBeNull();
    expect(
      boxGap("load", row({ load_type: "pct_top", load_min: 80, load_max: 80 }), did({ weight: 10 }), "metric"),
    ).toBeNull();
    // A load pair with no unit reads as nothing, so it compares with nothing.
    expect(
      boxGap("load", row({ load_type: null, load_min: 100, load_max: 100 }), did({ weight: 10 }), "metric"),
    ).toBeNull();
  });

  it("judges at the precision the viewer is shown, so two values that read the same never disagree", () => {
    // 220 lbs — what an imperial client's "220 lbs" hint for 100 kg asks for —
    // is 99.79 kg. Both read 220 lbs to an imperial coach; a metric coach sees
    // 99.79 against 100, and that IS below.
    const hundred = row({ load_type: "absolute", load_min: 100, load_max: 100 });
    expect(boxGap("load", hundred, did({ weight: 99.79 }), "imperial")).toBeNull();
    expect(boxGap("load", hundred, did({ weight: 99.79 }), "metric")).toBe("below");

    // A run recorded as 5,004.96 m reads "5 km" beside a "5 km" target, and an
    // imperial client's "3.11" mi is that distance.
    const fiveK = row({ distance_meters_min: 5000, distance_meters_max: 5000 });
    expect(boxGap("distance", fiveK, did({ distanceMeters: 5004.96 }), "metric")).toBeNull();
    expect(boxGap("distance", fiveK, did({ distanceMeters: 5004.96 }), "imperial")).toBeNull();
    // 5.02 km reads as more than 5 km, and is marked.
    expect(boxGap("distance", fiveK, did({ distanceMeters: 5020 }), "metric")).toBe("above");
  });

  it("judges the endurance measures in their canonical units", () => {
    const run = row({
      duration_seconds_min: 1500,
      duration_seconds_max: 1620,
      pace_seconds_per_km_min: 300,
      pace_seconds_per_km_max: 320,
      heart_rate_zone_min: 3,
      heart_rate_zone_max: 3,
      split_seconds_per_500m_min: 110,
      split_seconds_per_500m_max: 115,
    });
    expect(boxGap("duration", run, did({ durationSeconds: 1570 }), "metric")).toBeNull();
    expect(boxGap("duration", run, did({ durationSeconds: 1680.5 }), "metric")).toBe("above");
    // A slower pace is MORE seconds per km: above the target's numbers.
    expect(boxGap("pace", run, did({ paceSecondsPerKm: 330 }), "metric")).toBe("above");
    expect(boxGap("pace", run, did({ paceSecondsPerKm: 313 }), "imperial")).toBeNull();
    expect(boxGap("heart_rate_zone", run, did({ heartRateZone: 4 }), "metric")).toBe("above");
    expect(boxGap("split", run, did({ splitSecondsPer500m: 108.4 }), "metric")).toBe("below");
  });

  it("marks a tempo that differs from the prescribed one", () => {
    const tempo = row({ tempo: "3-1-X-0" });
    expect(boxGap("tempo", tempo, did({ tempo: "3-1-X-0" }), "metric")).toBeNull();
    expect(boxGap("tempo", tempo, did({ tempo: "3-0-X-0" }), "metric")).toBe("differs");
    expect(boxGap("tempo", tempo, did({}), "metric")).toBeNull();
    expect(boxGap("tempo", row({}), did({ tempo: "3-0-X-0" }), "metric")).toBeNull();
  });
});

describe("tempoDiffers", () => {
  it("compares phase by phase, so a padded second is the same second", () => {
    expect(tempoDiffers("3-1-X-0", "03-1-X-0")).toBe(false);
    expect(tempoDiffers("3-1-X-0", "3-1-1-0")).toBe(true);
    expect(tempoDiffers("20-0-X-0", "2-0-X-0")).toBe(true);
  });

  it("compares nothing with a missing tempo", () => {
    expect(tempoDiffers(null, "3-1-X-0")).toBe(false);
    expect(tempoDiffers("3-1-X-0", null)).toBe(false);
  });
});

describe("rpeWellAbove", () => {
  it("is true two or more above the top of the target (a single value is its own top)", () => {
    expect(rpeWellAbove(row({ rpe_min: 8, rpe_max: 8 }), did({ rpe: 10 }))).toBe(true);
    expect(rpeWellAbove(row({ rpe_min: 7, rpe_max: 8 }), did({ rpe: 10 }))).toBe(true);
    expect(rpeWellAbove(row({ rpe_min: 7, rpe_max: 8 }), did({ rpe: 9.5 }))).toBe(false);
    expect(rpeWellAbove(row({ rpe_min: 7, rpe_max: 8 }), did({ rpe: 6 }))).toBe(false);
  });

  it("is false with no target or no RPE recorded", () => {
    expect(rpeWellAbove(row({}), did({ rpe: 10 }))).toBe(false);
    expect(rpeWellAbove(row({ rpe_min: 8, rpe_max: 8 }), did({}))).toBe(false);
  });
});

describe("rest", () => {
  it("targets a set's own rest only where the exercise's own rest applies", () => {
    const set = row({ rest_seconds: 90 });
    expect(restTarget(set, true)).toBe(90);
    expect(restTarget(set, false)).toBeNull();
    expect(restTarget(null, true)).toBeNull();
  });

  it("reads any other rest taken as outside its one number", () => {
    expect(restGap(90, 90)).toBeNull();
    expect(restGap(90, 102)).toBe("above");
    expect(restGap(90, 75)).toBe("below");
    expect(restGap(null, 102)).toBeNull();
    expect(restGap(90, null)).toBeNull();
  });
});
