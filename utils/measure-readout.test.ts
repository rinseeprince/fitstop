import { describe, expect, it } from "vitest";
import { formatMeasureReadout, formatTempoReadout } from "./measure-readout";

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
