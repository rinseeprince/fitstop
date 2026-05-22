import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { NutritionCardSummary } from "./nutrition-card-summary";
import { getDateDaysFrom, getTodayDateString } from "@/lib/date-helpers";

const DATE = "2026-05-08";
const FUTURE_DATE = getDateDaysFrom(
  new Date(getTodayDateString() + "T00:00:00"),
  1,
);

describe("NutritionCardSummary", () => {
  beforeEach(() => cleanup());

  it("renders 'No nutrition target today' with no link when nutrition is null", () => {
    render(<NutritionCardSummary nutrition={null} date={DATE} />);

    expect(screen.getByText("No nutrition target today")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows the target calories + Tap to log + link when not logged", () => {
    render(
      <NutritionCardSummary
        nutrition={{ hasLog: false, caloriesConsumed: null, targetCalories: 1735 }}
        date={DATE}
      />,
    );

    expect(screen.getByText("Target 1,735 kcal")).toBeInTheDocument();
    expect(screen.getByText("Tap to log")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `/client/nutrition?date=${DATE}`,
    );
  });

  it("shows consumed vs target + Tap to view + link when logged", () => {
    render(
      <NutritionCardSummary
        nutrition={{ hasLog: true, caloriesConsumed: 1735, targetCalories: 1735 }}
        date={DATE}
      />,
    );

    expect(screen.getByText("1,735 / 1,735 kcal")).toBeInTheDocument();
    expect(screen.getByText("Tap to view")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `/client/nutrition?date=${DATE}`,
    );
  });

  it("renders future-date row as info-only with no link and no hint", () => {
    render(
      <NutritionCardSummary
        nutrition={{ hasLog: false, caloriesConsumed: null, targetCalories: 1735 }}
        date={FUTURE_DATE}
      />,
    );

    expect(screen.getByText("Target 1,735 kcal")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("Tap to log")).toBeNull();
    expect(screen.queryByText("Tap to view")).toBeNull();
  });
});
