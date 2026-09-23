import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { NutritionEvent } from "@/types/check-in";
import { NutritionCalendarDayCell } from "./nutrition-calendar-day-cell";

afterEach(cleanup);

function day(overrides: Partial<NutritionEvent>): NutritionEvent {
  return {
    id: "2026-09-19",
    clientId: "client-1",
    nutritionPlanId: "plan-1",
    date: "2026-09-19",
    dayOfWeek: "saturday",
    baselineCalories: 2260,
    trainingBurnCalories: 0,
    proteinG: 171,
    carbG: 231,
    fatG: 69,
    dietType: "balanced",
    isTrainingDay: true,
    calorieSurplusPercentage: 13,
    includeActivityBurn: true,
    surplusAsCarbs: false,
    isModified: false,
    note: null,
    coachNote: null,
    status: "scheduled",
    ...overrides,
  };
}

function renderCell(event: NutritionEvent) {
  render(
    <NutritionCalendarDayCell
      date={event.date}
      dayOfMonth={Number(event.date.slice(8))}
      event={event}
      isToday={false}
      isPast
    />
  );
}

describe("NutritionCalendarDayCell", () => {
  it("prices a training day with its own version's surplus on", () => {
    renderCell(day({}));
    expect(screen.getByText(Math.round(2260 * 1.13).toLocaleString())).toBeTruthy();
  });

  it("shows the baseline on a training day whose own version has the surplus off", () => {
    renderCell(day({ includeActivityBurn: false }));
    expect(screen.getByText((2260).toLocaleString())).toBeTruthy();
    expect(screen.queryByText(Math.round(2260 * 1.13).toLocaleString())).toBeNull();
  });
});
