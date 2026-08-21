import { describe, expect, it } from "vitest";
import {
  buildClientTabUrl,
  paneParamSearch,
  resolvePaneParam,
} from "./client-tabs";

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

  it("extraParams address a pane on arrival, overriding a carried value", () => {
    const url = buildClientTabUrl("c1", "metrics", "tab=overview&journey=wellness", {
      journey: "blocks",
    });
    expect(url).toContain("tab=metrics");
    expect(url).toContain("journey=blocks");
    expect(url).not.toContain("journey=wellness");
  });

  it("a null extraParam DELETES a carried key rather than leaving it to win", () => {
    // The exercise drill-down: the destination prefers exerciseId over
    // exerciseName, so a freehand log (no id) must clear the previous trip's.
    const url = buildClientTabUrl(
      "c1",
      "metrics",
      "tab=training&exerciseId=ex-1&exerciseName=Bench",
      { journey: "training", exerciseId: null, exerciseName: "Zercher squat" }
    );
    expect(url).not.toContain("exerciseId");
    expect(url).toContain("exerciseName=Zercher+squat");
    expect(url).toContain("journey=training");
  });

  it("omitted extraParams leave the URL byte-identical to the three-arg call", () => {
    expect(buildClientTabUrl("c1", "nutrition", "tab=training&subtab=plans")).toBe(
      buildClientTabUrl("c1", "nutrition", "tab=training&subtab=plans", undefined)
    );
  });
});

// Session 7.2: Training and Nutrition each own a param named after themselves,
// the way Journey owns ?journey=. The shared ?subtab= is nobody's writer any
// more, but old links can still carry one — so it stays readable, and stays
// guarded.
describe("resolvePaneParam", () => {
  const search = (q: string) => new URLSearchParams(q);

  it("reads its own param with NO tab-match guard", () => {
    // The deep-link case: activeTab flips before router.replace lands, so the
    // builder mounts while the URL still names the previous tab. Guarding here
    // would return null and flash the default pane before swapping.
    expect(resolvePaneParam(search("tab=metrics&training=plans"), "training")).toBe(
      "plans"
    );
    expect(
      resolvePaneParam(search("tab=metrics&nutrition=plans"), "nutrition")
    ).toBe("plans");
  });

  it("cannot read the OTHER tab's single-owner param", () => {
    expect(resolvePaneParam(search("tab=training&nutrition=plans"), "training")).toBe(
      null
    );
  });

  it("falls back to a legacy ?subtab= link — the bookmark must still resolve", () => {
    expect(resolvePaneParam(search("tab=training&subtab=plans"), "training")).toBe(
      "plans"
    );
    expect(
      resolvePaneParam(search("tab=nutrition&subtab=plans"), "nutrition")
    ).toBe("plans");
  });

  it("keeps the tab-match guard on the SHARED legacy param", () => {
    // The Session 3.1 regression: Training on Plans → Nutrition carried
    // subtab=plans and opened Nutrition's calendar instead of its Data pane.
    expect(resolvePaneParam(search("tab=training&subtab=plans"), "nutrition")).toBe(
      null
    );
  });

  it("prefers its own param over a stale legacy one", () => {
    expect(
      resolvePaneParam(search("tab=training&training=data&subtab=plans"), "training")
    ).toBe("data");
  });
});

describe("paneParamSearch", () => {
  it("writes the tab's own param and drops the legacy shared one", () => {
    const q = paneParamSearch("tab=training&subtab=plans", "training", "data");
    expect(new URLSearchParams(q).get("training")).toBe("data");
    expect(q).not.toContain("subtab");
  });

  it("leaves the other tab's pane param alone", () => {
    const q = paneParamSearch("tab=training&nutrition=plans", "training", "plans");
    expect(new URLSearchParams(q).get("nutrition")).toBe("plans");
  });
});

describe("buildClientTabUrl + the single-owner pane params", () => {
  it("carries both new params through a tab switch", () => {
    const url = buildClientTabUrl(
      "c1",
      "nutrition",
      "tab=training&training=plans&nutrition=plans"
    );
    expect(url).toContain("training=plans");
    expect(url).toContain("nutrition=plans");
  });

  it("still drops the shared subtab even beside them", () => {
    const url = buildClientTabUrl(
      "c1",
      "nutrition",
      "tab=training&training=plans&subtab=plans"
    );
    expect(url).not.toContain("subtab");
    expect(url).toContain("training=plans");
  });
});

