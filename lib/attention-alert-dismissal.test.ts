import { describe, it, expect } from "vitest";
import { alertDismissalKey } from "./attention-alert-dismissal";

describe("alertDismissalKey", () => {
  it("keys an alert by its type", () => {
    expect(alertDismissalKey({ type: "training_missed" })).toBe("training_missed");
    expect(alertDismissalKey({ type: "no_engagement" })).toBe("no_engagement");
  });

  it("keys a missed-habit line by its type and its habit, so each habit's line is dismissed on its own", () => {
    const water = alertDismissalKey({ type: "habit_missed", habitId: "h-water" });
    const walk = alertDismissalKey({ type: "habit_missed", habitId: "h-walk" });
    expect(water).toBe("habit_missed:h-water");
    expect(walk).not.toBe(water);
  });
});
