import { describe, it, expect } from "vitest";
import { updateGoalsSchema } from "./client-goals";

// Session 7.8: the goal deadline must persist + be clearable. Session 7.86 made
// the schema format-only — the "not in the past" bound moved to the route, where
// it's judged against the coach's local today (see goals/route.test.ts). A
// server-clock bound in the schema would reject an east-of-UTC coach's own today.
describe("updateGoalsSchema", () => {
  it("accepts a future goal deadline", () => {
    const result = updateGoalsSchema.safeParse({ goalDeadline: "2099-12-31" });
    expect(result.success).toBe(true);
  });

  it("accepts a well-formed past goal deadline (the past-date bound is route-side now)", () => {
    const result = updateGoalsSchema.safeParse({ goalDeadline: "2020-01-01" });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed goal deadline (format-only contract)", () => {
    // Under-padded — fails the YYYY-MM-DD shape regex (the only check left).
    const result = updateGoalsSchema.safeParse({ goalDeadline: "2026-6-1" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("goalDeadline"))).toBe(true);
    }
  });

  // The API-side half of the rule (the form mirrors it for the inline message).
  // This is the copy that binds React Native, whose contract this schema is.
  describe("a goal cannot start after it ends", () => {
    it("rejects a start date after the deadline", () => {
      const result = updateGoalsSchema.safeParse({
        goalStartDate: "2027-01-01",
        goalDeadline: "2026-12-01",
      });
      expect(result.success).toBe(false);
    });

    it("accepts equal dates and the normal order", () => {
      expect(
        updateGoalsSchema.safeParse({ goalStartDate: "2026-12-01", goalDeadline: "2026-12-01" })
          .success
      ).toBe(true);
      expect(
        updateGoalsSchema.safeParse({ goalStartDate: "2026-01-01", goalDeadline: "2026-12-01" })
          .success
      ).toBe(true);
    });

    // The documented hole, pinned so nobody reads the refine as complete: a
    // refine sees only the payload, so a partial update carrying one date can
    // still land an invalid pair against the stored other one. Closing it means
    // checking inside updateGoals after its merge.
    it("cannot catch a partial update against a stored value", () => {
      expect(updateGoalsSchema.safeParse({ goalStartDate: "2099-01-01" }).success).toBe(true);
    });
  });

  it("accepts an explicit null goalDeadline (clearing)", () => {
    const result = updateGoalsSchema.safeParse({ goalDeadline: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.goalDeadline).toBeNull();
  });

  it("accepts a goalStartDate", () => {
    const result = updateGoalsSchema.safeParse({ goalStartDate: "2026-02-01" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.goalStartDate).toBe("2026-02-01");
  });

  it("accepts a null goalBodyFatPercentage (clearing the optional target)", () => {
    const result = updateGoalsSchema.safeParse({ goalBodyFatPercentage: null });
    expect(result.success).toBe(true);
  });

  it("rejects an empty payload (at least one field required)", () => {
    expect(updateGoalsSchema.safeParse({}).success).toBe(false);
  });

  // goalWeight is canonical KILOGRAMS (migration 141) and had no bounds
  // coverage at all while carrying a pounds ceiling of 700 — so a goal of
  // 699 kg validated, and the number only ever made sense as pounds.
  describe("goalWeight is bounded in kilograms", () => {
    it("accepts a plausible kg goal", () => {
      expect(updateGoalsSchema.safeParse({ goalWeight: 82.5 }).success).toBe(true);
    });

    it("rejects a pounds-shaped goal that the old 20-700 range let through", () => {
      expect(updateGoalsSchema.safeParse({ goalWeight: 300 }).success).toBe(false);
      expect(updateGoalsSchema.safeParse({ goalWeight: 699 }).success).toBe(false);
    });

    it("rejects a goal below the kg floor", () => {
      expect(updateGoalsSchema.safeParse({ goalWeight: 15 }).success).toBe(false);
    });
  });
});
