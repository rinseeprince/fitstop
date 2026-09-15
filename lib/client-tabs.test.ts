import { describe, expect, it } from "vitest";
import {
  buildClientTabUrl,
  checkInReviewUrl,
  journeyPlanTripParams,
  paneParamSearch,
  readJourneyReturnBlock,
  resolvePaneParam,
  stripJourneyReturn,
  stripJourneyTrip,
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

  it("drops the Training tab's apply tray and its two editors on a tab change — places, not panes", () => {
    const url = buildClientTabUrl(
      "c1",
      "metrics",
      "tab=training&training=plans&apply=1&editor=sp-1&plan=p-1"
    );
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.has("apply")).toBe(false);
    expect(params.has("editor")).toBe(false);
    expect(params.has("plan")).toBe(false);
    expect(params.get("training")).toBe("plans");
    expect(params.get("tab")).toBe("metrics");
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

describe("the round trip's strips", () => {
  const trip = "tab=training&training=plans&apply=1&returnTo=journey&returnBlock=blk-7";

  it("stripJourneyReturn removes the two return params and keeps the surface's address", () => {
    expect(stripJourneyReturn(trip)).toBe("tab=training&training=plans&apply=1");
  });

  it("stripJourneyTrip removes the surface's one-shot as well", () => {
    expect(stripJourneyTrip(trip, "apply")).toBe("tab=training&training=plans");
  });
});

// Journey's "edit plan": the block card sends the coach to the plan editor on
// the plan it heads, knowing the way back to the block.
describe("journeyPlanTripParams", () => {
  it("addresses the plan editor on the plan, with the trip back to the block", () => {
    expect(journeyPlanTripParams("p-9", "blk-7")).toEqual({
      plan: "p-9",
      returnTo: "journey",
      returnBlock: "blk-7",
    });
  });

  it("lands through the tab change with the plan editor open: a carried plan goes, the addressed one stays", () => {
    const url = buildClientTabUrl("c1", "training", "tab=metrics&journey=blocks&plan=p-old", {
      training: "plans",
      ...journeyPlanTripParams("p-9", "blk-7"),
    });
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("tab")).toBe("training");
    expect(params.get("training")).toBe("plans");
    expect(params.getAll("plan")).toEqual(["p-9"]);
    expect(params.get("returnTo")).toBe("journey");
    expect(params.get("returnBlock")).toBe("blk-7");
    // The plan editor is its own place: the trip opens no tray.
    expect(params.has("apply")).toBe(false);
  });
});

describe("readJourneyReturnBlock", () => {
  const search = (q: string) => new URLSearchParams(q);

  it("returns the block a Journey trip names, whatever surface it opened", () => {
    expect(readJourneyReturnBlock(search("apply=1&returnTo=journey&returnBlock=blk-7"))).toBe(
      "blk-7"
    );
    expect(readJourneyReturnBlock(search("plan=p-9&returnTo=journey&returnBlock=blk-7"))).toBe(
      "blk-7"
    );
  });

  it("returns null for a return target naming something else, or none", () => {
    expect(readJourneyReturnBlock(search("plan=p-9&returnTo=elsewhere&returnBlock=blk-7"))).toBe(
      null
    );
    expect(readJourneyReturnBlock(search("plan=p-9&returnBlock=blk-7"))).toBe(null);
    expect(readJourneyReturnBlock(search("plan=p-9&returnTo=journey"))).toBe(null);
  });
});

describe("checkInReviewUrl", () => {
  it("builds the canonical deep link: the tab plus its single-owner checkIn param", () => {
    expect(checkInReviewUrl("c1", "ci-9")).toBe("/clients/c1?tab=check-ins&checkIn=ci-9");
  });

  it("rides through a tab round trip like every single-owner param", () => {
    const away = buildClientTabUrl("c1", "training", "tab=check-ins&checkIn=ci-9");
    expect(away).toBe("/clients/c1?tab=training&checkIn=ci-9");
    const back = buildClientTabUrl("c1", "check-ins", away.split("?")[1]);
    expect(back).toBe("/clients/c1?tab=check-ins&checkIn=ci-9");
  });

  it("is cleared by a null extraParam — the detail's back row", () => {
    expect(
      buildClientTabUrl("c1", "check-ins", "tab=check-ins&checkIn=ci-9", { checkIn: null })
    ).toBe("/clients/c1?tab=check-ins");
  });
});
