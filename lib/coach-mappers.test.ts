import { describe, it, expect } from "vitest";
import { mapSavedPlanRow } from "./coach-mappers";
import type { CoachSavedPlanRow } from "./database-helpers";

function makeRow(overrides: Partial<CoachSavedPlanRow> = {}): CoachSavedPlanRow {
  return {
    id: "plan-1",
    coach_id: "coach-1",
    name: "P",
    description: null,
    split_type: null,
    frequency_per_week: null,
    status: "saved",
    default_surplus_percentage: null,
    source: "manual",
    coach_prompt: null,
    program_duration_weeks: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as CoachSavedPlanRow;
}

describe("mapSavedPlanRow default_surplus_percentage", () => {
  it("preserves an explicit 0 (falsy-check regression: 0 must not read as null)", () => {
    const plan = mapSavedPlanRow(makeRow({ default_surplus_percentage: 0 }));
    expect(plan.defaultSurplusPercentage).toBe(0);
  });

  it("coerces numeric strings and passes null through", () => {
    expect(
      mapSavedPlanRow(makeRow({ default_surplus_percentage: "12.5" as unknown as number }))
        .defaultSurplusPercentage,
    ).toBe(12.5);
    expect(mapSavedPlanRow(makeRow()).defaultSurplusPercentage).toBeNull();
  });
});
