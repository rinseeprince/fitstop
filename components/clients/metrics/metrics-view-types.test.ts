import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOCUS,
  JOURNEY_SUBTABS,
  METRIC_TABS,
  isJourneySubtab,
  toMetricTab,
} from "./metrics-view-types";

describe("isJourneySubtab", () => {
  it("accepts every member of JOURNEY_SUBTABS", () => {
    for (const value of JOURNEY_SUBTABS) {
      expect(isJourneySubtab(value)).toBe(true);
    }
  });

  it("rejects unknown values, null, and the empty string", () => {
    // The old two-way ternary silently resolved every unknown value to "body";
    // the guard makes the fallback an explicit caller decision instead.
    expect(isJourneySubtab("exercise-data")).toBe(false);
    expect(isJourneySubtab("plans")).toBe(false);
    expect(isJourneySubtab("")).toBe(false);
    expect(isJourneySubtab(null)).toBe(false);
  });
});

// The landmine JourneySubtab exists for: MetricTab keys metricsByTab,
// logRowsByTab and DEFAULT_FOCUS, and a Journey pane that keys none of them
// (Training, Blocks) must never index them. The guard whitelists the metric
// panes, so a pane added to JOURNEY_SUBTABS is safe without editing it.
describe("toMetricTab", () => {
  it("maps every Journey pane to a key the metric shapes actually hold", () => {
    for (const pane of JOURNEY_SUBTABS) {
      expect(DEFAULT_FOCUS[toMetricTab(pane)]).toBeDefined();
    }
  });

  it("passes the metric panes through unchanged", () => {
    for (const pane of METRIC_TABS) {
      expect(toMetricTab(pane)).toBe(pane);
    }
  });

  it("idles the non-metric panes on body", () => {
    expect(toMetricTab("training")).toBe("body");
    expect(toMetricTab("blocks")).toBe("body");
  });
});
