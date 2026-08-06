import { describe, it, expect } from "vitest";
import { METRIC_DEFINITIONS } from "./use-metrics-data";

const byId = (id: string) => METRIC_DEFINITIONS.find((d) => d.id === id)!;
const GIRTHS = ["waist", "hips", "chest", "arms", "thighs"];

// Girths were labelled "in" for every coach while the stored values are
// centimetres (migration 141) — a fixed MEASUREMENT_UNIT constant in
// use-merged-metrics, not a preference. Weight read client.weightUnit, which by
// then was a mapper constant. Both are now the viewer's own unit, and `convert`
// says how the stored value reaches the screen.
describe("METRIC_DEFINITIONS units", () => {
  it("labels weight in the viewer's unit and marks it for conversion", () => {
    const weight = byId("weight");
    expect(weight.getUnit("metric")).toBe("kg");
    expect(weight.getUnit("imperial")).toBe("lbs");
    expect(weight.convert).toBe("weight");
  });

  it("labels every girth cm/in by viewer — never a fixed 'in'", () => {
    for (const id of GIRTHS) {
      const def = byId(id);
      expect(def.getUnit("metric"), id).toBe("cm");
      expect(def.getUnit("imperial"), id).toBe("in");
      expect(def.convert, id).toBe("length");
    }
  });

  it("leaves unitless metrics identical for both viewers and unconverted", () => {
    for (const id of ["bodyFat", "mood", "energy", "sleep", "stress", "soreness"]) {
      const def = byId(id);
      expect(def.getUnit("imperial"), id).toBe(def.getUnit("metric"));
      expect(def.convert, id).toBeUndefined();
    }
  });

  it("marks every body metric except body fat for conversion", () => {
    const convertible = METRIC_DEFINITIONS.filter((d) => d.convert != null).map((d) => d.id);
    expect(convertible.sort()).toEqual(["weight", ...GIRTHS].sort());
  });
});

// Regression: an imperial coach saw "374.7858457142919 lbs" in the hero. The
// stored value is a clean 170 kg; converting it produces the full float, and
// metric-hero renders `latest.value` directly. The pipeline rounds now.
describe("converted values are display-rounded", () => {
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const KG_PER_LB = 0.45359237;

  it("a 170 kg weight reads 374.8 lbs, not fifteen decimals", () => {
    const lbs = 170 / KG_PER_LB;
    expect(lbs.toString()).toContain("374.78584571429");
    expect(round1(lbs)).toBe(374.8);
  });

  it("a 92 cm waist reads 36.2 in", () => {
    expect(round1(92 / 2.54)).toBe(36.2);
  });
});
