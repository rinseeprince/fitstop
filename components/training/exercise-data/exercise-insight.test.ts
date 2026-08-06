import { describe, it, expect } from "vitest";
import { computeKpis, computeInsight } from "./exercise-insight";
import type { ExerciseProgressionPoint } from "@/types/training";

// This module carried nine hardcoded "kg" labels, so every coach saw kilograms
// whatever their preference. It is pure, so the viewer arrives as a parameter
// from the nearest client component. Everything here is a read-only readout,
// which is why formatLoad (and its 5 lb snap) is the right helper.

function point(overrides: Partial<ExerciseProgressionPoint> = {}): ExerciseProgressionPoint {
  return {
    date: "2026-05-01T00:00:00Z",
    sessionLogId: "sl-1",
    topSetWeight: 100,
    topSetReps: 5,
    estimatedOneRepMax: 112.5,
    totalVolume: 2000,
    topSetRpe: 8,
    prescribedSets: 3,
    actualSets: 3,
    prescribedRepsMin: 5,
    prescribedRepsMax: 5,
    ...overrides,
  };
}

describe("computeKpis — weight", () => {
  const data = [
    point({ date: "2026-04-01T00:00:00Z", topSetWeight: 90, estimatedOneRepMax: 101 }),
    point({ date: "2026-05-01T00:00:00Z", topSetWeight: 100, estimatedOneRepMax: 112.5 }),
  ];

  it("labels a metric viewer's cards in kilograms", () => {
    const kpis = computeKpis("weight", data, "metric");

    expect(kpis[0]).toMatchObject({ label: "Top Set", value: "100", unit: "kg" });
    expect(kpis[1]).toMatchObject({ label: "Estimated 1RM", unit: "kg" });
    expect(kpis[2]).toMatchObject({ label: "Last PR", value: "100", unit: "kg" });
  });

  it("converts and snaps for an imperial viewer", () => {
    const kpis = computeKpis("weight", data, "imperial");

    // 100 kg is 220.46 lbs; a loadable readout is 220.
    expect(kpis[0]).toMatchObject({ label: "Top Set", value: "220", unit: "lbs" });
    expect(kpis[2]).toMatchObject({ label: "Last PR", value: "220", unit: "lbs" });
  });

  it("derives the delta from the DISPLAYED values, so the meta line reconciles", () => {
    // 90 kg -> 197.5 lbs and 100 kg -> 220 lbs after snapping, so the period
    // delta a coach can verify by subtracting the two displayed numbers is 22.5.
    // The true difference is 22.05, so the 2.5 lb increment lands within half a
    // pound of it; the old 5 lb increment reported 20.
    const kpis = computeKpis("weight", data, "imperial");
    expect(kpis[0].meta).toBe("+22.5 over period");

    expect(computeKpis("weight", data, "metric")[0].meta).toBe("+10 over period");
  });
});

describe("computeKpis — e1RM and volume", () => {
  const data = [
    point({ date: "2026-04-01T00:00:00Z", estimatedOneRepMax: 100, totalVolume: 1000 }),
    point({ date: "2026-05-01T00:00:00Z", estimatedOneRepMax: 120, totalVolume: 2000 }),
  ];

  it("labels e1RM in the viewer's unit", () => {
    expect(computeKpis("e1rm", data, "metric")[0]).toMatchObject({
      label: "Current e1RM",
      value: "120",
      unit: "kg",
    });
    expect(computeKpis("e1rm", data, "imperial")[0]).toMatchObject({
      label: "Current e1RM",
      unit: "lbs",
    });
  });

  it("labels volume in the viewer's unit", () => {
    const metric = computeKpis("volume", data, "metric");
    expect(metric[0]).toMatchObject({ label: "Total Volume", unit: "kg" });

    const imperial = computeKpis("volume", data, "imperial");
    expect(imperial.every((k) => k.unit === "lbs")).toBe(true);
  });

  it("leaves unitless metrics alone", () => {
    expect(computeKpis("rpe", data, "imperial").every((k) => k.unit !== "lbs")).toBe(true);
  });
});

describe("computeInsight", () => {
  const data = [
    point({ date: "2026-04-01T00:00:00Z", topSetWeight: 90 }),
    point({ date: "2026-05-01T00:00:00Z", topSetWeight: 100 }),
  ];

  it("states a new PR in the viewer's unit", () => {
    expect(computeInsight("weight", data, "metric")).toContain("new PR of 100kg");
    expect(computeInsight("weight", data, "imperial")).toContain("new PR of 220lbs");
  });
});
