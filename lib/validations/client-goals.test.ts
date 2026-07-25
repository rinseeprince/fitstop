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
});
