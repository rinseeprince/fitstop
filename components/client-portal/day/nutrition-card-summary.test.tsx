import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { NutritionCardSummary } from "./nutrition-card-summary";

const DATE = "2026-05-08";

describe("NutritionCardSummary", () => {
  beforeEach(() => cleanup());

  it("renders 'No nutrition target today' with no link when nutrition is null", () => {
    render(<NutritionCardSummary nutrition={null} date={DATE} />);

    expect(screen.getByText("No nutrition target today")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders Not logged yet + Tap to log + link to detail when hasLog is false", () => {
    render(
      <NutritionCardSummary nutrition={{ hasLog: false }} date={DATE} />,
    );

    expect(screen.getByText("Not logged yet")).toBeInTheDocument();
    expect(screen.getByText("Tap to log")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `/client/nutrition?date=${DATE}`,
    );
  });

  it("renders Logged + Tap to view + link to detail when hasLog is true", () => {
    render(<NutritionCardSummary nutrition={{ hasLog: true }} date={DATE} />);

    expect(screen.getByText("Logged")).toBeInTheDocument();
    expect(screen.getByText("Tap to view")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `/client/nutrition?date=${DATE}`,
    );
  });
});
