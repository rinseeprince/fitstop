import { describe, expect, it } from "vitest";
import type { SetSpec } from "./exercise-set-specs";
import {
  boxHeader,
  formatBoxActual,
  formatBoxTarget,
  formatMeasureReadout,
  formatTempoReadout,
} from "./measure-readout";
import { emptyLoggedActuals, type LoggedActuals } from "./set-log-measures";
import { buildPrescribedRows, type PrescribedRow } from "./set-spec-rows";

// One grammar for how a measure reads — a target range or a logged value with
// its word, in the viewer's units — so every surface spells "5 km",
// "3:45–3:50 /km" and "RPE 7–8" the same way.
describe("formatMeasureReadout", () => {
  it("reads a range with an en dash and a single value as itself", () => {
    expect(formatMeasureReadout("reps", { min: 8, max: 10 }, "metric")).toBe("8–10");
    expect(formatMeasureReadout("reps", { min: 8, max: 8 }, "metric")).toBe("8");
    expect(formatMeasureReadout("reps", { min: null, max: null }, "metric")).toBeNull();
  });

  it("reads a load in the viewer's unit, snapped, or as a percentage", () => {
    expect(formatMeasureReadout("load", { min: 100, max: 105 }, "metric", "absolute")).toBe("100–105 kg");
    expect(formatMeasureReadout("load", { min: 100, max: 105 }, "imperial", "absolute")).toBe("220–232.5 lbs");
    expect(formatMeasureReadout("load", { min: 70, max: 75 }, "metric", "pct_1rm")).toBe("70–75% 1RM");
    expect(formatMeasureReadout("load", { min: 80, max: 80 }, "metric", "pct_top")).toBe("80% top set");
    expect(formatMeasureReadout("load", { min: 100, max: 105 }, "metric", null)).toBeNull();
  });

  it("puts the word before RPE, RIR, cadence and resistance", () => {
    expect(formatMeasureReadout("rpe", { min: 7, max: 8 }, "metric")).toBe("RPE 7–8");
    expect(formatMeasureReadout("rir", { min: 2, max: 2 }, "metric")).toBe("RIR 2");
    expect(formatMeasureReadout("cadence", { min: 90, max: 90 }, "metric")).toBe("cadence 90");
    expect(formatMeasureReadout("resistance", { min: 7, max: 7 }, "metric")).toBe("resistance 7");
  });

  it("reads the converting measures in the viewer's units, the unit once per range", () => {
    expect(formatMeasureReadout("distance", { min: 800, max: 800 }, "metric")).toBe("800 m");
    expect(formatMeasureReadout("distance", { min: 800, max: 999 }, "metric")).toBe("800–999 m");
    expect(formatMeasureReadout("distance", { min: 800, max: 1000 }, "metric")).toBe("800 m–1 km");
    expect(formatMeasureReadout("distance", { min: 5000, max: 6000 }, "metric")).toBe("5–6 km");
    expect(formatMeasureReadout("distance", { min: 800, max: 1200 }, "metric")).toBe("800 m–1.2 km");
    expect(formatMeasureReadout("distance", { min: 5000, max: 5000 }, "imperial")).toBe("3.11 mi");
    expect(formatMeasureReadout("duration", { min: 1500, max: 1620 }, "metric")).toBe("25:00–27:00");
    expect(formatMeasureReadout("pace", { min: 225, max: 230 }, "metric")).toBe("3:45–3:50 /km");
    expect(formatMeasureReadout("pace", { min: 300, max: 320 }, "imperial")).toBe("8:03–8:35 /mi");
    expect(formatMeasureReadout("split", { min: 110, max: 115 }, "metric")).toBe("1:50–1:55 /500m");
    expect(formatMeasureReadout("heart_rate_zone", { min: 2, max: 3 }, "metric")).toBe("Z2–Z3");
  });

  it("puts the unit after calories, stroke rate, heart rate, power and % FTP", () => {
    expect(formatMeasureReadout("calories", { min: 300, max: 300 }, "metric")).toBe("300 kcal");
    expect(formatMeasureReadout("stroke_rate", { min: 28, max: 30 }, "metric")).toBe("28–30 spm");
    expect(formatMeasureReadout("heart_rate", { min: 150, max: 160 }, "metric")).toBe("150–160 bpm");
    expect(formatMeasureReadout("power", { min: 250, max: 250 }, "metric")).toBe("250 W");
    expect(formatMeasureReadout("ftp_percent", { min: 80, max: 90 }, "metric")).toBe("80–90% FTP");
  });

  it("reads a half-open range as a floor or a ceiling", () => {
    expect(formatMeasureReadout("distance", { min: 5000, max: null }, "metric")).toBe("5 km+");
    expect(formatMeasureReadout("reps", { min: null, max: 12 }, "metric")).toBe("≤12");
  });

  it("reads a tempo after its word", () => {
    expect(formatTempoReadout("3-1-X-0")).toBe("tempo 3-1-X-0");
    expect(formatTempoReadout(null)).toBeNull();
  });
});

function row(spec: Partial<SetSpec>): PrescribedRow {
  return buildPrescribedRows([{ set_number: 1, set_type: "working", ...spec }])[0];
}

function did(actuals: Partial<LoggedActuals>): LoggedActuals {
  return { ...emptyLoggedActuals(), ...actuals };
}

// A box's words in the client's grid and the coach's table: its header, the
// coach's target (the client's hint; the table's top line) and what the set
// recorded (the table's bottom line).
describe("boxHeader", () => {
  it("names the unit a bare load is in, and every other box by its label", () => {
    expect(boxHeader("load", "metric")).toBe("Load (kg)");
    expect(boxHeader("load", "imperial")).toBe("Load (lbs)");
    expect(boxHeader("distance", "imperial")).toBe("Distance");
    expect(boxHeader("heart_rate_zone", "metric")).toBe("HR zone");
  });
});

describe("formatBoxTarget", () => {
  it("reads the bare number where the header carries the word", () => {
    const set = row({ reps_min: 8, reps_max: 10, rpe_min: 7, rpe_max: 8, rir_min: 2, rir_max: 2 });
    expect(formatBoxTarget("reps", set, "metric")).toBe("8–10");
    expect(formatBoxTarget("rpe", set, "metric")).toBe("7–8");
    expect(formatBoxTarget("rir", set, "metric")).toBe("2");
    expect(formatBoxTarget("cadence", row({ cadence_min: 90, cadence_max: 90 }), "metric")).toBe("90");
  });

  it("reads a unit-bearing measure with its unit, in the viewer's units", () => {
    const set = row({
      load_type: "absolute",
      load_min: 100,
      load_max: 105,
      distance_meters_min: 5000,
      distance_meters_max: 5000,
      pace_seconds_per_km_min: 225,
      pace_seconds_per_km_max: 230,
      calories_min: 300,
      calories_max: 300,
    });
    expect(formatBoxTarget("load", set, "metric")).toBe("100–105 kg");
    expect(formatBoxTarget("load", set, "imperial")).toBe("220–232.5 lbs");
    expect(formatBoxTarget("distance", set, "metric")).toBe("5 km");
    expect(formatBoxTarget("pace", set, "metric")).toBe("3:45–3:50 /km");
    expect(formatBoxTarget("calories", set, "metric")).toBe("300 kcal");
    expect(formatBoxTarget("load", row({ load_type: "pct_1rm", load_min: 75, load_max: 80 }), "metric")).toBe(
      "75–80% 1RM",
    );
  });

  it("reads a tempo as written and the legacy free-text reps as typed", () => {
    expect(formatBoxTarget("tempo", row({ tempo: "3-1-X-0" }), "metric")).toBe("3-1-X-0");
    expect(formatBoxTarget("reps", row({ reps_target: "8-12 each" }), "metric")).toBe("8-12 each");
  });

  it("is null when the row sets nothing there, or there is no row", () => {
    expect(formatBoxTarget("rpe", row({}), "metric")).toBeNull();
    expect(formatBoxTarget("tempo", row({}), "metric")).toBeNull();
    expect(formatBoxTarget("reps", row({ reps_target: "" }), "metric")).toBeNull();
    expect(formatBoxTarget("reps", null, "metric")).toBeNull();
    // An AMRAP set prescribes no rep count, whatever its spec still carries.
    expect(formatBoxTarget("reps", row({ set_type: "amrap", reps_min: 8, reps_max: 8 }), "metric")).toBeNull();
  });
});

describe("formatBoxActual", () => {
  it("reads a load as a bare number in the viewer's unit, snapped like every read-only load", () => {
    expect(formatBoxActual("load", did({ weight: 102.5 }), "metric")).toBe("102.5");
    expect(formatBoxActual("load", did({ weight: 99.79 }), "metric")).toBe("99.79");
    expect(formatBoxActual("load", did({ weight: 100 }), "imperial")).toBe("220");
  });

  it("reads every other measure the way the client's box read it back", () => {
    const set = did({
      reps: 5,
      rpe: 8.5,
      distanceMeters: 5020,
      durationSeconds: 1570,
      paceSecondsPerKm: 313,
      splitSecondsPer500m: 112.3,
      heartRateZone: 4,
      calories: 310,
      tempo: "3-0-X-0",
    });
    expect(formatBoxActual("reps", set, "metric")).toBe("5");
    expect(formatBoxActual("rpe", set, "metric")).toBe("8.5");
    expect(formatBoxActual("distance", set, "metric")).toBe("5.02 km");
    expect(formatBoxActual("distance", set, "imperial")).toBe("3.12 mi");
    expect(formatBoxActual("duration", set, "metric")).toBe("26:10");
    expect(formatBoxActual("pace", set, "metric")).toBe("5:13 /km");
    expect(formatBoxActual("split", set, "metric")).toBe("1:52.3 /500m");
    expect(formatBoxActual("heart_rate_zone", set, "metric")).toBe("Z4");
    expect(formatBoxActual("calories", set, "metric")).toBe("310");
    expect(formatBoxActual("tempo", set, "metric")).toBe("3-0-X-0");
  });

  it("is null for a box nothing was recorded in, and with no set", () => {
    expect(formatBoxActual("power", did({ reps: 5 }), "metric")).toBeNull();
    expect(formatBoxActual("tempo", did({}), "metric")).toBeNull();
    expect(formatBoxActual("reps", null, "metric")).toBeNull();
  });
});
