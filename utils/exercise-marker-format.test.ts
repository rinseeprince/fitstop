import { describe, expect, it } from "vitest";
import {
  formatMarkerDelta,
  formatMarkerNumber,
  formatMarkerValue,
  markerSeriesValue,
  markerUnit,
} from "./exercise-marker-format";
import { formatLoad } from "./unit-conversions";

describe("markerSeriesValue", () => {
  it("plots a load in the viewer's unit, snapped like every read-only load", () => {
    expect(markerSeriesValue("load", 100, "metric")).toBe(100);
    expect(markerSeriesValue("load", 100, "imperial")).toBe(formatLoad(100, "imperial").value);
  });

  it("plots a distance in kilometres or miles", () => {
    expect(markerSeriesValue("distance", 5000, "metric")).toBe(5);
    expect(markerSeriesValue("distance", 5000, "imperial")).toBe(3.11);
    expect(markerSeriesValue("distance", 400, "metric")).toBe(0.4);
  });

  it("plots a pace per kilometre or per mile", () => {
    expect(markerSeriesValue("pace", 285, "metric")).toBe(285);
    expect(markerSeriesValue("pace", 285, "imperial")).toBe(459);
  });

  it("plots everything else as stored", () => {
    expect(markerSeriesValue("split", 112.3, "imperial")).toBe(112.3);
    expect(markerSeriesValue("duration", 3722, "imperial")).toBe(3722);
    expect(markerSeriesValue("reps", 12, "imperial")).toBe(12);
    expect(markerSeriesValue("watts", 250, "metric")).toBe(250);
  });
});

describe("markerUnit", () => {
  it("names the unit by readout and viewer", () => {
    expect(markerUnit("load", "metric")).toBe("kg");
    expect(markerUnit("load", "imperial")).toBe("lbs");
    expect(markerUnit("distance", "metric")).toBe("km");
    expect(markerUnit("distance", "imperial")).toBe("mi");
    expect(markerUnit("pace", "metric")).toBe("/km");
    expect(markerUnit("pace", "imperial")).toBe("/mi");
    expect(markerUnit("split", "metric")).toBe("/500m");
    expect(markerUnit("duration", "metric")).toBe("m:ss");
    expect(markerUnit("watts", "metric")).toBe("W");
    expect(markerUnit("reps", "metric")).toBe("reps");
    expect(markerUnit("rpe", "metric")).toBe("");
  });
});

describe("formatMarkerNumber and formatMarkerValue", () => {
  it("reads the time-like readouts as clocks", () => {
    expect(formatMarkerNumber("pace", 285)).toBe("4:45");
    expect(formatMarkerNumber("split", 112.3)).toBe("1:52.3");
    expect(formatMarkerNumber("duration", 3722)).toBe("1:02:02");
    expect(formatMarkerNumber("duration", 90)).toBe("1:30");
  });

  it("reads numbers plainly, to a hundredth", () => {
    expect(formatMarkerNumber("distance", 5.2)).toBe("5.2");
    expect(formatMarkerNumber("load", 102.5)).toBe("102.5");
    expect(formatMarkerNumber("reps", 12)).toBe("12");
  });

  it("gives a KPI its number and its unit, none beside a duration", () => {
    expect(formatMarkerValue("pace", 285, "imperial")).toEqual({ value: "7:39", unit: "/mi" });
    expect(formatMarkerValue("distance", 5200, "metric")).toEqual({ value: "5.2", unit: "km" });
    expect(formatMarkerValue("duration", 120, "metric")).toEqual({ value: "2:00", unit: "" });
    expect(formatMarkerValue("watts", 250, "metric")).toEqual({ value: "250", unit: "W" });
  });
});

describe("formatMarkerDelta", () => {
  it("signs a change and reads the time-like ones as clocks", () => {
    expect(formatMarkerDelta("load", 5)).toBe("+5");
    expect(formatMarkerDelta("load", -2.5)).toBe("-2.5");
    expect(formatMarkerDelta("load", 0)).toBe("0");
    expect(formatMarkerDelta("pace", -15)).toBe("-0:15");
    expect(formatMarkerDelta("duration", 30)).toBe("+0:30");
  });
});
