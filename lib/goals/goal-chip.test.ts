import { describe, it, expect } from "vitest";
import { goalProgressChip } from "./goal-chip";

// The words the coach's goal card and the client's goal card both use for how
// far a client is from a target — one function, so the two cannot disagree.
describe("goalProgressChip", () => {
  it("says how far there is to go, as a warning", () => {
    expect(
      goalProgressChip({ type: "lose_weight", metric: "weight", start: 95.2, current: 90.6, target: 86.4, unit: "kg" })
    ).toEqual({ text: "4.2 kg to go", tone: "warning" });
  });

  it("says the goal is reached within the tolerance", () => {
    expect(
      goalProgressChip({ type: "lose_weight", metric: "weight", start: 95.2, current: 86.43, target: 86.4, unit: "kg" })
    ).toEqual({ text: "Goal reached", tone: "positive" });
  });

  it("says under a loss target once past it, and over a gain target once past it", () => {
    expect(
      goalProgressChip({ type: "lose_weight", metric: "weight", start: 95.2, current: 84.1, target: 86.4, unit: "kg" })
    ).toEqual({ text: "2.3 kg under goal", tone: "positive" });
    expect(
      goalProgressChip({ type: "build_muscle", metric: "weight", start: 70.3, current: 76.8, target: 75.1, unit: "lbs" })
    ).toEqual({ text: "1.7 lbs over goal", tone: "positive" });
  });

  it("hugs the percent sign to a body-fat amount", () => {
    expect(
      goalProgressChip({ type: "recomposition", metric: "bodyFat", start: 25.9, current: 22.6, target: 19.8, unit: "%" })
    ).toEqual({ text: "2.8% to go", tone: "warning" });
  });

  it("says nothing without a target or a current reading", () => {
    expect(
      goalProgressChip({ type: "lose_weight", metric: "weight", start: 95.2, current: 90.6, target: null, unit: "kg" })
    ).toBeNull();
    expect(
      goalProgressChip({ type: "lose_weight", metric: "weight", start: 95.2, current: undefined, target: 86.4, unit: "kg" })
    ).toBeNull();
  });
});
