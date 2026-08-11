import { describe, expect, it } from "vitest";
import { buildClientTabUrl } from "./client-tabs";

// The pair that regressed when tab switches briefly preserved the SHARED
// `subtab` key (Session 3.1's first cut): Training on Plans → Nutrition
// carried `subtab=plans`, satisfied Nutrition's pane guard, and opened its
// Plans calendar instead of Data. These tests pin the corrected model:
// shared `subtab` drops on every tab change; single-owner `journey` rides.

describe("buildClientTabUrl", () => {
  it("drops subtab on a Training → Nutrition switch (the regressed pair)", () => {
    expect(buildClientTabUrl("c1", "nutrition", "tab=training&subtab=plans")).toBe(
      "/clients/c1?tab=nutrition"
    );
  });

  it("drops subtab on the Nutrition → Training return trip", () => {
    expect(buildClientTabUrl("c1", "training", "tab=nutrition&subtab=plans")).toBe(
      "/clients/c1?tab=training"
    );
  });

  it("carries the Journey-owned journey param through a full round trip", () => {
    const away = buildClientTabUrl("c1", "training", "tab=metrics&journey=blocks");
    expect(away).toContain("tab=training");
    expect(away).toContain("journey=blocks");
    const back = buildClientTabUrl("c1", "metrics", away.split("?")[1]);
    expect(back).toContain("journey=blocks");
    expect(back).toContain("tab=metrics");
  });

  it("drops a Training subtab while carrying journey", () => {
    const url = buildClientTabUrl(
      "c1",
      "metrics",
      "tab=training&subtab=exercise-data&journey=wellness"
    );
    expect(url).not.toContain("subtab");
    expect(url).toContain("journey=wellness");
  });
});
