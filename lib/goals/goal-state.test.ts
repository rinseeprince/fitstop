import { describe, it, expect } from "vitest";
import { goalState, GOAL_REACHED_TOLERANCE } from "./goal-state";

describe("goalState", () => {
  it("returns null when current or goal is missing", () => {
    expect(goalState({ start: 90, current: null, goal: 80 })).toBeNull();
    expect(goalState({ start: 90, current: 85, goal: null })).toBeNull();
  });

  describe("loss direction (weight cut: 90 → goal 80)", () => {
    it("reports the remaining gap while above the goal", () => {
      expect(goalState({ start: 90, current: 84.5, goal: 80 })).toEqual({
        state: "gap",
        amount: 4.5,
      });
    });

    it("reports reached within tolerance", () => {
      expect(goalState({ start: 90, current: 80.04, goal: 80 })).toEqual({ state: "reached" });
      expect(goalState({ start: 90, current: 80 - GOAL_REACHED_TOLERANCE, goal: 80 })).toEqual({
        state: "reached",
      });
    });

    it("reports beyond with the overshoot once past the goal", () => {
      expect(goalState({ start: 90, current: 78, goal: 80 })).toEqual({
        state: "beyond",
        amount: 2,
      });
    });
  });

  describe("gain direction (muscle gain: 70 → goal 75)", () => {
    it("reports the remaining gap while below the goal", () => {
      expect(goalState({ start: 70, current: 72, goal: 75 })).toEqual({
        state: "gap",
        amount: 3,
      });
    });

    it("reports beyond once past the goal", () => {
      expect(goalState({ start: 70, current: 76.5, goal: 75 })).toEqual({
        state: "beyond",
        amount: 1.5,
      });
    });
  });

  describe("unknown direction", () => {
    it("never claims beyond without a start value — overshoot reads as gap", () => {
      expect(goalState({ start: null, current: 78, goal: 80 })).toEqual({
        state: "gap",
        amount: 2,
      });
    });

    it("still reports reached without a start value", () => {
      expect(goalState({ start: null, current: 80.02, goal: 80 })).toEqual({ state: "reached" });
    });

    it("treats start === goal as unknowable too", () => {
      expect(goalState({ start: 80, current: 78, goal: 80 })).toEqual({
        state: "gap",
        amount: 2,
      });
    });
  });

  it("handles body-fat shapes (percent scale)", () => {
    expect(goalState({ start: 25, current: 18.5, goal: 15 })).toEqual({
      state: "gap",
      amount: 3.5,
    });
    expect(goalState({ start: 25, current: 14, goal: 15 })).toEqual({
      state: "beyond",
      amount: 1,
    });
  });
});
