import { describe, it, expect } from "vitest";
import { toCanonicalCheckInMetrics } from "@/utils/check-in-canonical-metrics";

// The check-in submit boundary. Storage is canonical kg/cm (migration 141) while
// the form still collects in its own toggle's unit until Phase 4, so this is the
// one place that reconciles them — and the failure it prevents is silent, because
// the unit tags it replaces no longer exist on the row.
describe("toCanonicalCheckInMetrics", () => {
  it("converts an lbs weight and leaves a kg one alone", () => {
    expect(toCanonicalCheckInMetrics({ weight: 180, weightUnit: "lbs" }).weight)
      .toBeCloseTo(81.6466, 4);
    expect(toCanonicalCheckInMetrics({ weight: 82.5, weightUnit: "kg" }).weight)
      .toBe(82.5);
  });

  // The bug this exists to stop: components/check-in/step-metrics.tsx:81
  // highlights **kg** when the toggle is untouched, so an omitted weightUnit
  // means the client typed kilograms. The old `?? "lbs"` default recorded those
  // as pounds — the mechanism behind the 51 mislabelled rows on Dev.
  it("treats an ABSENT weight unit as kg, never lbs", () => {
    expect(toCanonicalCheckInMetrics({ weight: 82.5 }).weight).toBe(82.5);
  });

  // Girths are the opposite: the toggle and the API default have always agreed
  // on inches, so an absent measurementUnit does mean inches.
  it("treats an absent measurement unit as inches and converts every girth", () => {
    const r = toCanonicalCheckInMetrics({
      waist: 34, hips: 40, chest: 42, arms: 14, thighs: 24,
    });
    expect(r.waist).toBeCloseTo(86.36, 4);
    expect(r.hips).toBeCloseTo(101.6, 4);
    expect(r.chest).toBeCloseTo(106.68, 4);
    expect(r.arms).toBeCloseTo(35.56, 4);
    expect(r.thighs).toBeCloseTo(60.96, 4);
  });

  it("leaves cm girths alone", () => {
    const r = toCanonicalCheckInMetrics({ waist: 86, measurementUnit: "cm" });
    expect(r.waist).toBe(86);
  });

  // exerciseHighlights[].weightValue lands in check_in_exercise_highlights,
  // which migration 141 converted and commented 'Kilograms, always'. It is a
  // separate array from the top-level metrics and was initially missed.
  it("converts exercise-highlight PR weights on their own tag", () => {
    const r = toCanonicalCheckInMetrics({
      weightUnit: "lbs",
      exerciseHighlights: [
        { weightValue: 225, weightUnit: "lbs" },
        { weightValue: 100, weightUnit: "kg" },
      ],
    });
    expect(r.exerciseHighlights?.[0].weightValue).toBeCloseTo(102.0583, 4);
    expect(r.exerciseHighlights?.[1].weightValue).toBe(100);
  });

  it("falls back to the payload's unit for an untagged highlight", () => {
    const r = toCanonicalCheckInMetrics({
      weightUnit: "lbs",
      exerciseHighlights: [{ weightValue: 225 }],
    });
    expect(r.exerciseHighlights?.[0].weightValue).toBeCloseTo(102.0583, 4);
  });

  it("passes through absent values and unrelated fields untouched", () => {
    const r = toCanonicalCheckInMetrics({
      weightUnit: "lbs" as const,
      weight: undefined,
      waist: undefined,
      exerciseHighlights: undefined,
      notes: "felt strong",
      mood: 4,
    });
    expect(r.weight).toBeUndefined();
    expect(r.waist).toBeUndefined();
    expect(r.exerciseHighlights).toBeUndefined();
    // Unrelated fields survive the spread — the routes pass the whole body.
    expect(r.notes).toBe("felt strong");
    expect(r.mood).toBe(4);
  });
});
