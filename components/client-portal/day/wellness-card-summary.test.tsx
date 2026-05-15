import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { WellnessCardSummary } from "./wellness-card-summary";
import { getDateDaysFrom, getTodayDateString } from "@/lib/date-helpers";

const DATE = "2026-05-08";
const FUTURE_DATE = getDateDaysFrom(
  new Date(getTodayDateString() + "T00:00:00"),
  1,
);

describe("WellnessCardSummary", () => {
  beforeEach(() => cleanup());

  it("renders Not logged yet + Tap to log + link when hasLog is false", () => {
    render(<WellnessCardSummary wellness={{ hasLog: false }} date={DATE} />);

    expect(screen.getByText("Not logged yet")).toBeInTheDocument();
    expect(screen.getByText("Tap to log")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `/client/wellness?date=${DATE}`,
    );
  });

  it("renders Logged + Tap to view + link when hasLog is true", () => {
    render(<WellnessCardSummary wellness={{ hasLog: true }} date={DATE} />);

    expect(screen.getByText("Logged")).toBeInTheDocument();
    expect(screen.getByText("Tap to view")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `/client/wellness?date=${DATE}`,
    );
  });

  it("renders future-date row as info-only with no link and no hint", () => {
    render(<WellnessCardSummary wellness={{ hasLog: false }} date={FUTURE_DATE} />);

    expect(screen.getByText("Not logged yet")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("Tap to log")).toBeNull();
    expect(screen.queryByText("Tap to view")).toBeNull();
  });
});
