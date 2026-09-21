import { describe, it, expect } from "vitest";
import { computeKpis, computeInsight, usesStrengthAnalytics } from "./exercise-insight";
import type { ExerciseProgressionPoint } from "@/types/training";

// This module carried nine hardcoded "kg" labels, so every coach saw kilograms
// whatever their preference. It is pure, so the viewer arrives as a parameter
// from the nearest client component. Everything here is a read-only readout,
// which is why formatLoad (and its 5 lb snap) is the right helper.

function point(overrides: Partial<ExerciseProgressionPoint> = {}): ExerciseProgressionPoint {
  return {
    date: "2026-05-01T00:00:00Z",
    sessionLogId: "sl-1",
    eventId: null,
    sets: [],
    totalReps: null,
    totalDurationSeconds: null,
    averagePaceSecondsPerKm: null,
    averageSplitSecondsPer500m: null,
    averageStrokeRate: null,
    averagePower: null,
    topSetWeight: 100,
    topSetReps: 5,
    estimatedOneRepMax: 112.5,
    totalVolume: 2000,
    rpe: 8,
    topSetDistanceMeters: null,
    topSetDurationSeconds: null,
    bestSetReps: null,
    totalDistanceMeters: null,
    longestHoldSeconds: null,
    maxHeartRateZone: null,
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
    const kpis = computeKpis("weight", "strength", data, "metric");

    expect(kpis[0]).toMatchObject({ label: "Top Set", value: "100", unit: "kg" });
    expect(kpis[1]).toMatchObject({ label: "Estimated 1RM", unit: "kg" });
    expect(kpis[2]).toMatchObject({ label: "Last PR", value: "100", unit: "kg" });
  });

  it("converts and snaps for an imperial viewer", () => {
    const kpis = computeKpis("weight", "strength", data, "imperial");

    // 100 kg is 220.46 lbs; a loadable readout is 220.
    expect(kpis[0]).toMatchObject({ label: "Top Set", value: "220", unit: "lbs" });
    expect(kpis[2]).toMatchObject({ label: "Last PR", value: "220", unit: "lbs" });
  });

  it("derives the delta from the DISPLAYED values, so the meta line reconciles", () => {
    // 90 kg -> 197.5 lbs and 100 kg -> 220 lbs after snapping, so the period
    // delta a coach can verify by subtracting the two displayed numbers is 22.5.
    // The true difference is 22.05, so the 2.5 lb increment lands within half a
    // pound of it; the old 5 lb increment reported 20.
    const kpis = computeKpis("weight", "strength", data, "imperial");
    expect(kpis[0].meta).toBe("+22.5 over period");

    expect(computeKpis("weight", "strength", data, "metric")[0].meta).toBe("+10 over period");
  });
});

describe("computeKpis — e1RM and volume", () => {
  const data = [
    point({ date: "2026-04-01T00:00:00Z", estimatedOneRepMax: 100, totalVolume: 1000 }),
    point({ date: "2026-05-01T00:00:00Z", estimatedOneRepMax: 120, totalVolume: 2000 }),
  ];

  it("labels e1RM in the viewer's unit", () => {
    expect(computeKpis("e1rm", "strength", data, "metric")[0]).toMatchObject({
      label: "Current e1RM",
      value: "120",
      unit: "kg",
    });
    expect(computeKpis("e1rm", "strength", data, "imperial")[0]).toMatchObject({
      label: "Current e1RM",
      unit: "lbs",
    });
  });

  it("labels volume in the viewer's unit", () => {
    const metric = computeKpis("volume", "strength", data, "metric");
    expect(metric[0]).toMatchObject({ label: "Total Volume", unit: "kg" });

    const imperial = computeKpis("volume", "strength", data, "imperial");
    expect(imperial.every((k) => k.unit === "lbs")).toBe(true);
  });

  it("leaves unitless metrics alone", () => {
    expect(computeKpis("rpe", "strength", data, "imperial").every((k) => k.unit !== "lbs")).toBe(true);
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

  // A run's, a hold's and a bodyweight set's RPE reach the lens too, so its
  // footer names no weights and no strength
  it("words the RPE drift for any exercise", () => {
    const runs = [6, 6, 6, 8, 8, 8].map((rpe, i) =>
      point({ date: `2026-05-0${i + 1}T00:00:00Z`, topSetWeight: null, rpe }),
    );
    expect(computeInsight("rpe", runs, "metric")).toBe("RPE rising across sessions - possible accumulated fatigue.");
    expect(computeInsight("rpe", [...runs].reverse(), "metric")).toBe("RPE falling - adaptation progressing well.");
  });
});

describe("usesStrengthAnalytics", () => {
  it("keeps the worded cards for RPE and Compliance everywhere, and for the load lenses on Strength alone", () => {
    expect(usesStrengthAnalytics("strength", "weight")).toBe(true);
    expect(usesStrengthAnalytics("bodyweight", "weight")).toBe(false);
    expect(usesStrengthAnalytics("endurance", "rpe")).toBe(true);
    expect(usesStrengthAnalytics("holds", "compliance")).toBe(true);
    expect(usesStrengthAnalytics("strength", "pace")).toBe(false);
  });
});

describe("computeKpis — a marker's own three cards", () => {
  const blank: Omit<ExerciseProgressionPoint, "date" | "sessionLogId"> = {
    eventId: null, sets: [],
    topSetWeight: null, topSetReps: null, rpe: null, topSetDistanceMeters: null, topSetDurationSeconds: null,
    estimatedOneRepMax: null, totalVolume: null, bestSetReps: null, totalReps: null,
    totalDistanceMeters: null, totalDurationSeconds: null, averagePaceSecondsPerKm: null,
    averageSplitSecondsPer500m: null, averageStrokeRate: null, averagePower: null, maxHeartRateZone: null,
    longestHoldSeconds: null,
    prescribedSets: null, actualSets: 1, prescribedRepsMin: null, prescribedRepsMax: null,
  };
  const run = (date: string, pace: number): ExerciseProgressionPoint => ({ ...blank, date, sessionLogId: date, averagePaceSecondsPerKm: pace });

  it("reads Latest, the best by the marker's word, and the change in the viewer's units", () => {
    const data = [run("2026-09-01T00:00:00Z", 314), run("2026-09-08T00:00:00Z", 308), run("2026-09-15T00:00:00Z", 301)];
    const kpis = computeKpis("pace", "endurance", data, "metric");
    expect(kpis.map((k) => k.label)).toEqual(["Latest", "Fastest", "Change"]);
    expect(kpis[0]).toMatchObject({ value: "5:01", unit: "/km" });
    expect(kpis[1]).toMatchObject({ value: "5:01", unit: "/km" });
    expect(kpis[2]).toMatchObject({ value: "-0:13", unit: "/km", trend: "down" });
    expect(computeKpis("pace", "endurance", data, "imperial")[0]).toMatchObject({ value: "8:04", unit: "/mi" });
  });

  it("reads a load lens on another type through the same three cards, in the viewer's unit", () => {
    const data = [{ ...blank, date: "2026-09-01T00:00:00Z", sessionLogId: "a", topSetWeight: 60, topSetReps: 3 }];
    const kpis = computeKpis("weight", "carry_sled", data, "imperial");
    expect(kpis.map((k) => k.label)).toEqual(["Latest", "Heaviest", "Change"]);
    expect(kpis[0]).toMatchObject({ value: "132.5", unit: "lbs" });
    expect(kpis[2]).toMatchObject({ value: "-" });
  });
});
