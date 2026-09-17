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

  it("opens the log on a day with no target: No target + Tap to log + link", () => {
    render(
      <NutritionCardSummary
        nutrition={{ hasLog: false, caloriesConsumed: null, targetCalories: null, note: null }}
        date={DATE}
      />,
    );

    expect(screen.getByText("No target")).toBeInTheDocument();
    expect(screen.getByText("Tap to log")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `/client/nutrition?date=${DATE}`,
    );
  });

  it("shows the calories alone + Tap to view + link when a day with no target is logged", () => {
    render(
      <NutritionCardSummary
        nutrition={{ hasLog: true, caloriesConsumed: 1850, targetCalories: null, note: null }}
        date={DATE}
      />,
    );

    expect(screen.getByText("1,850 kcal")).toBeInTheDocument();
    expect(screen.getByText("Tap to view")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `/client/nutrition?date=${DATE}`,
    );
  });

  it("keeps a future day with no target info-only", () => {
    render(
      <NutritionCardSummary
        nutrition={{ hasLog: false, caloriesConsumed: null, targetCalories: null, note: null }}
        date={FUTURE_DATE}
      />,
    );

    expect(screen.getByText("No target")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("Tap to log")).toBeNull();
  });

  it("shows the target calories + Tap to log + link when not logged", () => {
    render(
      <NutritionCardSummary
        nutrition={{ hasLog: false, caloriesConsumed: null, targetCalories: 1735, note: null }}
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
        nutrition={{ hasLog: true, caloriesConsumed: 1735, targetCalories: 1735, note: null }}
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

  it("surfaces the coach note on the card (incl. future days that aren't openable)", () => {
    render(
      <NutritionCardSummary
        nutrition={{ hasLog: false, caloriesConsumed: null, targetCalories: 2500, note: "Deload — go easy" }}
        date={FUTURE_DATE}
      />,
    );

    expect(screen.getByText("Deload — go easy")).toBeInTheDocument();
    // Still info-only (future day), but the note is visible without opening it.
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders future-date row as info-only with no link and no hint", () => {
    render(
      <NutritionCardSummary
        nutrition={{ hasLog: false, caloriesConsumed: null, targetCalories: 1735, note: null }}
        date={FUTURE_DATE}
      />,
    );

    expect(screen.getByText("Target 1,735 kcal")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("Tap to log")).toBeNull();
    expect(screen.queryByText("Tap to view")).toBeNull();
  });
});
