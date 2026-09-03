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

  // A goal has no start of its own (docs/MEASUREMENT-LOG-PLAN.md commit 8bb):
  // the window a nutrition deficit is spread over begins at the day the plan
  // takes effect. A payload still carrying one — an older client build — is
  // accepted with the key dropped: never refused, never validated against the
  // deadline, never stored. Carrying ONLY one is an empty payload.
  it("drops a goalStartDate rather than validating or storing it", () => {
    const result = updateGoalsSchema.safeParse({
      goalStartDate: "2027-01-01",
      goalDeadline: "2026-12-01", // "before the start" — no rule reads the pair any more
    });
    expect(result.success).toBe(true);
    if (result.success) expect("goalStartDate" in result.data).toBe(false);

    expect(updateGoalsSchema.safeParse({ goalStartDate: "2099-01-01" }).success).toBe(false);
  });

  it("accepts an explicit null goalDeadline (clearing)", () => {
    const result = updateGoalsSchema.safeParse({ goalDeadline: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.goalDeadline).toBeNull();
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
