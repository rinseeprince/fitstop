import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { HabitsCardSummary } from "./habits-card-summary";
import { getDateDaysFrom, getTodayDateString } from "@/lib/date-helpers";
import type { HabitDaySummary } from "@/types/habits";

const PAST = "2026-05-08";
const TODAY = getTodayDateString();
const FUTURE_DATE = getDateDaysFrom(new Date(TODAY + "T00:00:00"), 1);

const habits = (over: Partial<HabitDaySummary>): HabitDaySummary => ({
  plannedToday: 0,
  doneToday: 0,
  running: 3,
  toDoThisWeek: 0,
  ...over,
});

describe("HabitsCardSummary", () => {
  beforeEach(() => cleanup());

  it("renders 'No habits to track' with no link when no habit runs on the day", () => {
    render(<HabitsCardSummary habits={habits({ running: 0, toDoThisWeek: 2 })} date={TODAY} editable />);

    expect(screen.getByText("No habits to track")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("names its row in words a screen reader reads as one: 'Habits:', then what the row leads with", () => {
    render(<HabitsCardSummary habits={habits({ plannedToday: 3, doneToday: 2 })} date={TODAY} editable />);

    expect(screen.getByRole("link")).toHaveAttribute("aria-label", "Habits: 2 of 3 done today");
  });

  describe("today", () => {
    it("says how many of today's planned habits are done, and asks for the rest", () => {
      render(<HabitsCardSummary habits={habits({ plannedToday: 3, doneToday: 2, toDoThisWeek: 4 })} date={TODAY} editable />);

      expect(screen.getByText("2 of 3 done today")).toBeInTheDocument();
      expect(screen.getByText("Tap to log")).toBeInTheDocument();
      expect(screen.getByRole("link")).toHaveAttribute("href", `/client/habits?date=${TODAY}`);
    });

    it("offers a view once every planned habit is done, whatever the week still asks", () => {
      render(<HabitsCardSummary habits={habits({ plannedToday: 3, doneToday: 3, toDoThisWeek: 2 })} date={TODAY} editable />);

      expect(screen.getByText("3 of 3 done today")).toBeInTheDocument();
      expect(screen.getByText("Tap to view")).toBeInTheDocument();
    });

    it("says nothing is planned today and, on a line of its own, what the week still asks, and asks for it", () => {
      // A habit done a number of times a week, or a set-days habit on another
      // weekday: the client can still make an entry today, and the week waits.
      render(<HabitsCardSummary habits={habits({ toDoThisWeek: 1 })} date={TODAY} editable />);

      const leading = screen.getByText("Nothing planned today");
      const trailing = screen.getByText("1 to do this week");
      expect(leading).not.toBe(trailing);
      expect(screen.getByText("Tap to log")).toBeInTheDocument();
      expect(screen.getByRole("link")).toHaveAttribute("href", `/client/habits?date=${TODAY}`);
      expect(screen.getByRole("link")).toHaveAttribute("aria-label", "Habits: Nothing planned today, 1 to do this week");
    });

    it("says only that nothing is planned today once the week asks for nothing more", () => {
      render(<HabitsCardSummary habits={habits({ toDoThisWeek: 0 })} date={TODAY} editable />);

      expect(screen.getByText("Nothing planned today")).toBeInTheDocument();
      expect(screen.queryByText(/to do this week/)).toBeNull();
      expect(screen.getByText("Tap to view")).toBeInTheDocument();
    });

    it("asks nothing on a locked today: the count stands, the week's to-do goes, and the row offers a view", () => {
      // The client sent their check-in this morning: today's week is closed.
      const { unmount } = render(
        <HabitsCardSummary habits={habits({ plannedToday: 3, doneToday: 2, toDoThisWeek: 4 })} date={TODAY} editable={false} />
      );
      expect(screen.getByText("2 of 3 done today")).toBeInTheDocument();
      expect(screen.getByText("Tap to view")).toBeInTheDocument();
      unmount();

      render(<HabitsCardSummary habits={habits({ toDoThisWeek: 1 })} date={TODAY} editable={false} />);
      expect(screen.getByText("Nothing planned today")).toBeInTheDocument();
      expect(screen.queryByText(/to do this week/)).toBeNull();
      expect(screen.getByText("Tap to view")).toBeInTheDocument();
    });
  });

  describe("another day", () => {
    it("names no day: the planned habits done, no 'today'", () => {
      render(<HabitsCardSummary habits={habits({ plannedToday: 3, doneToday: 1, toDoThisWeek: 5 })} date={PAST} editable />);

      expect(screen.getByText("1 of 3 done")).toBeInTheDocument();
      expect(screen.queryByText(/today/)).toBeNull();
      expect(screen.getByText("Tap to log")).toBeInTheDocument();
      expect(screen.getByRole("link")).toHaveAttribute("href", `/client/habits?date=${PAST}`);
    });

    it("asks nothing of a locked past day", () => {
      render(<HabitsCardSummary habits={habits({ plannedToday: 3, doneToday: 1 })} date={PAST} editable={false} />);

      expect(screen.getByText("1 of 3 done")).toBeInTheDocument();
      expect(screen.getByText("Tap to view")).toBeInTheDocument();
    });

    it("says only that nothing is planned, with no week's to-do, and still opens the page", () => {
      render(<HabitsCardSummary habits={habits({ toDoThisWeek: 2 })} date={PAST} editable />);

      expect(screen.getByText("Nothing planned")).toBeInTheDocument();
      expect(screen.queryByText(/to do/)).toBeNull();
      expect(screen.getByText("Tap to view")).toBeInTheDocument();
      expect(screen.getByRole("link")).toHaveAttribute("href", `/client/habits?date=${PAST}`);
    });

    it("renders a future day as info only, with no link and no hint", () => {
      render(<HabitsCardSummary habits={habits({ plannedToday: 3, toDoThisWeek: 3 })} date={FUTURE_DATE} editable={false} />);

      expect(screen.getByText("0 of 3 done")).toBeInTheDocument();
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.queryByText("Tap to log")).toBeNull();
      expect(screen.queryByText("Tap to view")).toBeNull();
    });
  });
});
