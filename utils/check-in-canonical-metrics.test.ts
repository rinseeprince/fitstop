import { describe, it, expect } from "vitest";
import {
  toCanonicalCheckInMetrics,
  toCanonicalCheckInSubmission,
  type CheckInMetricPayload,
} from "@/utils/check-in-canonical-metrics";

// The check-in submit boundary, in two halves: the browser converts from the
// viewer's preference and tags the payload, and the server converts on that tag
// for any non-web client. The failure they prevent is silent, because the unit
// columns that would have revealed it no longer exist on the row.
describe("toCanonicalCheckInMetrics", () => {
  it("converts an lbs weight and leaves a kg one alone", () => {
    expect(toCanonicalCheckInMetrics({ weight: 180, weightUnit: "lbs" }).weight)
      .toBeCloseTo(81.6466, 4);
    expect(toCanonicalCheckInMetrics({ weight: 82.5, weightUnit: "kg" }).weight)
      .toBe(82.5);
  });

  // Historically the `?? "lbs"` default here recorded kilogram numbers as
  // pounds — the mechanism behind the 51 mislabelled rows on Dev. The tag is
  // now required alongside the value (submitCheckInSchema), so an untagged
  // weight is a 400 rather than a guess; this pins that nothing converts it if
  // one ever reaches the function anyway.
  it("treats an ABSENT weight unit as kg, never lbs", () => {
    expect(toCanonicalCheckInMetrics({ weight: 82.5 }).weight).toBe(82.5);
  });

  // The `?? "in"` fallback is GONE. It silently multiplied an untagged
  // centimetre payload by 2.54, and it disagreed with the weight branch beside
  // it, which only ever converted on an explicit "lbs" — so the two halves of
  // this function meant different things by the same silence. submitCheckInSchema
  // now rejects an untagged girth outright, so nothing reaches here untagged.
  it("does NOT convert an untagged girth — no fallback decides the unit", () => {
    const r = toCanonicalCheckInMetrics({
      waist: 34, hips: 40, chest: 42, arms: 14, thighs: 24,
    });
    expect(r.waist).toBe(34);
    expect(r.hips).toBe(40);
    expect(r.chest).toBe(42);
    expect(r.arms).toBe(14);
    expect(r.thighs).toBe(24);
  });

  it("converts every girth on an explicit inches tag", () => {
    const r = toCanonicalCheckInMetrics({
      waist: 34, hips: 40, chest: 42, arms: 14, thighs: 24,
      measurementUnit: "in",
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

  // The `?? payload.weightUnit` fallback is gone too: exerciseHighlightSchema
  // requires a highlight's own weightUnit alongside its weightValue, so
  // inheriting the body-weight tag can no longer paper over a missing one.
  it("does NOT inherit the payload's unit for an untagged highlight", () => {
    const r = toCanonicalCheckInMetrics({
      weightUnit: "lbs",
      exerciseHighlights: [{ weightValue: 225 }],
    });
    expect(r.exerciseHighlights?.[0].weightValue).toBe(225);
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

describe("toCanonicalCheckInSubmission", () => {
  // The browser-side half: converts from the VIEWER's preference and stamps the
  // wire tags, so the server-side converter above becomes a no-op for the web.
  it("converts an imperial client's whole payload and tags it canonical", () => {
    const form: CheckInMetricPayload = {
      weight: 180,
      waist: 34,
      thighs: 24,
      exerciseHighlights: [{ weightValue: 225 }],
    };
    const r = toCanonicalCheckInSubmission(form, "imperial");

    expect(r.weight).toBeCloseTo(81.6466, 4);
    expect(r.weightUnit).toBe("kg");
    expect(r.waist).toBeCloseTo(86.36, 4);
    expect(r.thighs).toBeCloseTo(60.96, 4);
    expect(r.measurementUnit).toBe("cm");
    expect(r.exerciseHighlights?.[0].weightValue).toBeCloseTo(102.0583, 4);
    expect(r.exerciseHighlights?.[0].weightUnit).toBe("kg");
  });

  it("is an identity path for a metric client, but still tags", () => {
    const r = toCanonicalCheckInSubmission(
      { weight: 82.5, waist: 86 },
      "metric",
    );

    expect(r.weight).toBe(82.5);
    expect(r.waist).toBe(86);
    expect(r.weightUnit).toBe("kg");
    expect(r.measurementUnit).toBe("cm");
  });

  // The schema requires a tag only when its value is present, so an empty
  // check-in must not invent one.
  it("emits no tag for a value that was never entered", () => {
    // A check-in with no weight and no girths: nothing measured, so no unit to
    // state. Tagging it anyway would assert a measurement that never happened.
    const r = toCanonicalCheckInSubmission({}, "imperial");
    expect(r).not.toHaveProperty("weightUnit");
    expect(r).not.toHaveProperty("measurementUnit");
  });

  it("tags weight without girths, and girths without weight", () => {
    const weightOnly = toCanonicalCheckInSubmission({ weight: 180 }, "imperial");
    expect(weightOnly.weightUnit).toBe("kg");
    expect(weightOnly).not.toHaveProperty("measurementUnit");

    const girthOnly = toCanonicalCheckInSubmission({ arms: 14 }, "imperial");
    expect(girthOnly.measurementUnit).toBe("cm");
    expect(girthOnly).not.toHaveProperty("weightUnit");
  });

  // The round trip that matters: what the browser sends must survive the
  // server-side converter unchanged, or the two halves double-convert.
  it("produces a payload the server-side converter leaves alone", () => {
    const form: CheckInMetricPayload = {
      weight: 180,
      waist: 34,
      exerciseHighlights: [{ weightValue: 225 }],
    };
    const submitted = toCanonicalCheckInSubmission(form, "imperial");
    const afterServer = toCanonicalCheckInMetrics(submitted);

    expect(afterServer.weight).toBe(submitted.weight);
    expect(afterServer.waist).toBe(submitted.waist);
    expect(afterServer.exerciseHighlights?.[0].weightValue).toBe(
      submitted.exerciseHighlights?.[0].weightValue,
    );
  });
});
