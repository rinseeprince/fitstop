import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { HabitsCardSummary } from "./habits-card-summary";
import { getDateDaysFrom, getTodayDateString } from "@/lib/date-helpers";

const DATE = "2026-05-08";
const FUTURE_DATE = getDateDaysFrom(
  new Date(getTodayDateString() + "T00:00:00"),
  1,
);

describe("HabitsCardSummary", () => {
  beforeEach(() => cleanup());

  it("renders 'No habits to track' with no link when no habit runs on the day", () => {
    render(<HabitsCardSummary habits={{ plannedToday: 0, doneToday: 0, running: 0 }} date={DATE} />);

    expect(screen.getByText("No habits to track")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders X of N done + Tap to log when some of the day's planned habits are done", () => {
    render(<HabitsCardSummary habits={{ plannedToday: 3, doneToday: 1, running: 3 }} date={DATE} />);

    expect(screen.getByText("1 of 3 done")).toBeInTheDocument();
    expect(screen.getByText("Tap to log")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", `/client/habits?date=${DATE}`);
  });

  it("renders X of N done + Tap to view when every planned habit is done", () => {
    render(<HabitsCardSummary habits={{ plannedToday: 3, doneToday: 3, running: 4 }} date={DATE} />);

    expect(screen.getByText("3 of 3 done")).toBeInTheDocument();
    expect(screen.getByText("Tap to view")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", `/client/habits?date=${DATE}`);
  });

  it("says nothing is planned on a day a running habit plans nothing, and still opens the page", () => {
    // A habit done a number of times a week, or a set-days habit on another
    // weekday: the client can still make an entry on the day. The day is any
    // date the home shows (/client?date=), so the words name no day.
    render(<HabitsCardSummary habits={{ plannedToday: 0, doneToday: 0, running: 1 }} date={DATE} />);

    expect(screen.getByText("Nothing planned")).toBeInTheDocument();
    expect(screen.getByText("Tap to view")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", `/client/habits?date=${DATE}`);
  });

  it("renders future-date row as info-only with no link and no hint", () => {
    render(<HabitsCardSummary habits={{ plannedToday: 3, doneToday: 0, running: 3 }} date={FUTURE_DATE} />);

    expect(screen.getByText("0 of 3 done")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("Tap to log")).toBeNull();
    expect(screen.queryByText("Tap to view")).toBeNull();
  });
});
