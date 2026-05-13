import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { HabitsCardSummary } from "./habits-card-summary";

const DATE = "2026-05-08";

describe("HabitsCardSummary", () => {
  beforeEach(() => cleanup());

  it("renders 'No habits to track' with no link when totalCount is 0", () => {
    render(
      <HabitsCardSummary
        habits={{ totalCount: 0, loggedCount: 0 }}
        date={DATE}
      />,
    );

    expect(screen.getByText("No habits to track")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders X of N + Tap to log when only some habits are logged", () => {
    render(
      <HabitsCardSummary
        habits={{ totalCount: 3, loggedCount: 1 }}
        date={DATE}
      />,
    );

    expect(screen.getByText("1 of 3 logged")).toBeInTheDocument();
    expect(screen.getByText("Tap to log")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `/client/habits?date=${DATE}`,
    );
  });

  it("renders X of N + Tap to view when all habits are logged", () => {
    render(
      <HabitsCardSummary
        habits={{ totalCount: 3, loggedCount: 3 }}
        date={DATE}
      />,
    );

    expect(screen.getByText("3 of 3 logged")).toBeInTheDocument();
    expect(screen.getByText("Tap to view")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `/client/habits?date=${DATE}`,
    );
  });
});
