import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useCanonicalInput, useHeightInput } from "./use-unit-inputs";
import type { UnitSystem } from "@/utils/unit-conversions";

describe("useCanonicalInput", () => {
  describe("the untouched-field guard", () => {
    // The defect this exists to prevent: display rounding is lossy, so a form
    // that re-parses whatever is in the box rewrites values nobody edited — on
    // every save, because the box is pre-populated.
    it("commits the ORIGINAL kilograms when an imperial viewer never touches the box", () => {
      const { result } = renderHook(() =>
        useCanonicalInput("imperial", 100, "weight"),
      );

      expect(result.current.value).toBe("220.5"); // lossy on purpose
      expect(result.current.isPristine).toBe(true);
      expect(result.current.commit).toBe(100);

      // Proof the guard is load-bearing: re-parsing the seeded string does NOT
      // land back on 100.
      expect(result.current.canonical).not.toBe(100);
      expect(result.current.canonical).toBeCloseTo(100.017, 3);
    });

    it("commits the ORIGINAL centimetres for an untouched girth", () => {
      const { result } = renderHook(() =>
        useCanonicalInput("imperial", 86.4, "length"),
      );

      expect(result.current.value).toBe("34");
      expect(result.current.commit).toBe(86.4);
      expect(result.current.canonical).toBeCloseTo(86.36, 2);
    });

    it("commits the converted value once the box is edited", () => {
      const { result } = renderHook(() =>
        useCanonicalInput("imperial", 100, "weight"),
      );

      act(() => result.current.setValue("225"));

      expect(result.current.isPristine).toBe(false);
      expect(result.current.commit).toBeCloseTo(102.058, 3);
    });

    it("treats retyping the seeded string as untouched", () => {
      const { result } = renderHook(() =>
        useCanonicalInput("imperial", 100, "weight"),
      );

      act(() => result.current.setValue("999"));
      act(() => result.current.setValue("220.5"));

      expect(result.current.isPristine).toBe(true);
      expect(result.current.commit).toBe(100);
    });
  });

  describe("a metric viewer", () => {
    it("is an identity path — no conversion, no drift", () => {
      const { result } = renderHook(() =>
        useCanonicalInput("metric", 82.3, "weight"),
      );

      expect(result.current.value).toBe("82.3");
      expect(result.current.commit).toBe(82.3);

      act(() => result.current.setValue("81"));
      expect(result.current.commit).toBe(81);
    });
  });

  describe("switching units mid-edit", () => {
    it("re-renders the same weight rather than reinterpreting the digits", () => {
      const { result, rerender } = renderHook(
        ({ viewer }: { viewer: UnitSystem }) =>
          useCanonicalInput(viewer, 100, "weight"),
        { initialProps: { viewer: "metric" as UnitSystem } },
      );

      expect(result.current.value).toBe("100");

      rerender({ viewer: "imperial" });

      expect(result.current.value).toBe("220.5");
      // Flipping units is not an edit, so the seed still commits verbatim.
      expect(result.current.isPristine).toBe(true);
      expect(result.current.commit).toBe(100);
    });

    it("carries a typed value across the flip and keeps it dirty", () => {
      const { result, rerender } = renderHook(
        ({ viewer }: { viewer: UnitSystem }) =>
          useCanonicalInput(viewer, 100, "weight"),
        { initialProps: { viewer: "metric" as UnitSystem } },
      );

      act(() => result.current.setValue("90"));
      rerender({ viewer: "imperial" });

      expect(result.current.value).toBe("198.4"); // 90 kg, not 90 lbs
      expect(result.current.isPristine).toBe(false);
      expect(result.current.commit).toBeCloseTo(90, 1);
    });
  });

  describe("blank and unparseable input", () => {
    it("reports a blank box as null without flagging a parse error", () => {
      const { result } = renderHook(() =>
        useCanonicalInput("metric", null, "weight"),
      );

      expect(result.current.value).toBe("");
      expect(result.current.commit).toBeNull();
      expect(result.current.hasParseError).toBe(false);
    });

    it("flags text and non-positive numbers", () => {
      const { result } = renderHook(() =>
        useCanonicalInput("metric", null, "weight"),
      );

      act(() => result.current.setValue("abc"));
      expect(result.current.hasParseError).toBe(true);
      expect(result.current.commit).toBeNull();

      act(() => result.current.setValue("0"));
      expect(result.current.hasParseError).toBe(true);

      act(() => result.current.setValue("-5"));
      expect(result.current.hasParseError).toBe(true);
    });
  });

  it("re-seeds on reset, clearing dirtiness", () => {
    const { result } = renderHook(() =>
      useCanonicalInput("metric", 80, "weight"),
    );

    act(() => result.current.setValue("95"));
    expect(result.current.isPristine).toBe(false);

    act(() => result.current.reset(70));
    expect(result.current.value).toBe("70");
    expect(result.current.isPristine).toBe(true);
    expect(result.current.commit).toBe(70);
  });
});

describe("useHeightInput", () => {
  // The 452 cm landmine, inverted. The old dialog seeded a cm value into a box
  // labelled "in" and multiplied by 2.54 on save — 178 became 452 — and it
  // fired on ANY save because the field was pre-populated.
  it("commits the ORIGINAL centimetres for an untouched imperial height", () => {
    const { result } = renderHook(() => useHeightInput("imperial", 178));

    expect(result.current.fields.feet).toBe("5");
    expect(result.current.fields.inches).toBe("10");
    expect(result.current.isPristine).toBe(true);
    expect(result.current.commitCm).toBe(178);

    // 5'10" is 177.8, so committing the re-parsed value would drift.
    expect(result.current.canonicalCm).toBeCloseTo(177.8, 1);
  });

  it("never renders 5'12\" — the inches carry into the next foot", () => {
    // 182.85 cm is 71.99 in: naive rounding gives 5'12".
    const { result } = renderHook(() => useHeightInput("imperial", 182.85));

    expect(result.current.fields.feet).toBe("6");
    expect(result.current.fields.inches).toBe("0");
  });

  it("converts feet + inches on edit", () => {
    const { result } = renderHook(() => useHeightInput("imperial", 178));

    act(() => result.current.setFeet("6"));
    act(() => result.current.setInches("1"));

    expect(result.current.isPristine).toBe(false);
    expect(result.current.commitCm).toBeCloseTo(185.42, 2);
  });

  it("accepts inches alone, treating the missing feet as zero", () => {
    const { result } = renderHook(() => useHeightInput("imperial", null));

    act(() => result.current.setInches("70"));
    expect(result.current.commitCm).toBeCloseTo(177.8, 1);
  });

  it("renders a single cm field for a metric viewer and commits it verbatim", () => {
    const { result } = renderHook(() => useHeightInput("metric", 178));

    expect(result.current.fields.cm).toBe("178");
    expect(result.current.fields.feet).toBe("");
    expect(result.current.commitCm).toBe(178);

    act(() => result.current.setCm("180"));
    expect(result.current.commitCm).toBe(180);
  });

  it("re-renders the same height across a unit flip without reinterpreting it", () => {
    const { result, rerender } = renderHook(
      ({ viewer }: { viewer: UnitSystem }) => useHeightInput(viewer, 178),
      { initialProps: { viewer: "metric" as UnitSystem } },
    );

    expect(result.current.fields.cm).toBe("178");

    rerender({ viewer: "imperial" });

    expect(result.current.fields.feet).toBe("5");
    expect(result.current.fields.inches).toBe("10");
    expect(result.current.isPristine).toBe(true);
    expect(result.current.commitCm).toBe(178);
  });

  it("reports blank as null and garbage as a parse error", () => {
    const { result } = renderHook(() => useHeightInput("metric", null));

    expect(result.current.commitCm).toBeNull();
    expect(result.current.hasParseError).toBe(false);

    act(() => result.current.setCm("abc"));
    expect(result.current.hasParseError).toBe(true);
    expect(result.current.commitCm).toBeNull();
  });
});

// Regression: the callbacks MUST be referentially stable across renders.
//
// They were not, and it shipped a hang. A consumer that re-seeds on open writes
// `useEffect(..., [open, record, reset])`; with a fresh `reset` each render that
// effect re-runs every render, and since it setStates a brand-new object the
// next render is guaranteed — "Maximum update depth exceeded", every time the
// dialog opened. The isolated hook tests above all passed, because renderHook
// never puts the callbacks in a dependency array. Only mounting a consumer does.
describe("callback identity is stable across renders", () => {
  it("useCanonicalInput keeps setValue and reset stable", () => {
    const { result, rerender } = renderHook(() =>
      useCanonicalInput("metric", 80, "weight"),
    );
    const first = { setValue: result.current.setValue, reset: result.current.reset };

    rerender();
    act(() => result.current.setValue("81"));
    rerender();

    expect(result.current.setValue).toBe(first.setValue);
    expect(result.current.reset).toBe(first.reset);
  });

  it("useHeightInput keeps every setter and reset stable", () => {
    const { result, rerender } = renderHook(() => useHeightInput("metric", 178));
    const first = {
      setCm: result.current.setCm,
      setFeet: result.current.setFeet,
      setInches: result.current.setInches,
      reset: result.current.reset,
    };

    rerender();
    act(() => result.current.setCm("180"));
    rerender();

    expect(result.current.setCm).toBe(first.setCm);
    expect(result.current.setFeet).toBe(first.setFeet);
    expect(result.current.setInches).toBe(first.setInches);
    expect(result.current.reset).toBe(first.reset);
  });

  // reset closes over the viewer, so it MUST change when the viewer does —
  // otherwise a re-seed after a unit flip would write the old unit's display.
  it("reset changes identity when the viewer changes, and only then", () => {
    const { result, rerender } = renderHook(
      ({ viewer }: { viewer: UnitSystem }) =>
        useCanonicalInput(viewer, 80, "weight"),
      { initialProps: { viewer: "metric" as UnitSystem } },
    );
    const beforeFlip = result.current.reset;

    rerender({ viewer: "metric" });
    expect(result.current.reset).toBe(beforeFlip);

    rerender({ viewer: "imperial" });
    expect(result.current.reset).not.toBe(beforeFlip);
  });
});
