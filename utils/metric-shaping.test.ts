import { describe, it, expect } from "vitest";
import { getTrend, trendOfChange } from "./metric-shaping";

describe("trendOfChange", () => {
  it("follows the sign of the change rounded to one decimal", () => {
    expect(trendOfChange(0.1)).toBe("up");
    expect(trendOfChange(-0.1)).toBe("down");
    // Under the 0.5 cut-off this module used to apply, both of these were "stable".
    expect(trendOfChange(0.3)).toBe("up");
    expect(trendOfChange(-0.4)).toBe("down");
  });

  it("is stable only when the change rounds to nothing", () => {
    expect(trendOfChange(0)).toBe("stable");
    expect(trendOfChange(0.04)).toBe("stable");
    expect(trendOfChange(-0.04)).toBe("stable");
  });
});

describe("getTrend", () => {
  it("is trendOfChange over the two readings", () => {
    expect(getTrend(80.3, 80)).toBe("up");
    expect(getTrend(80, 80.3)).toBe("down");
    expect(getTrend(80.04, 80)).toBe("stable");
  });

  it("is stable when either reading is missing", () => {
    expect(getTrend(null, 80)).toBe("stable");
    expect(getTrend(80, null)).toBe("stable");
  });
});
