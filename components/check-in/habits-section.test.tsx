import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { HabitsSection } from "./habits-section";
import type { HabitBreakdown } from "@/types/coach-overview";

function habit(overrides: Partial<HabitBreakdown> = {}): HabitBreakdown {
  return {
    id: "h1",
    name: "Water",
    eligibleDays: 7,
    completedDays: 5,
    pct: 71,
    rail: [true, true, false, true, true, false, true],
    ...overrides,
  };
}

afterEach(cleanup);

describe("HabitsSection", () => {
  it("scores a habit over its eligible days", () => {
    render(<HabitsSection perHabit={[habit()]} />);

    expect(screen.getByText("Water")).toBeInTheDocument();
    expect(screen.getByText("5/7")).toBeInTheDocument();
  });

  it("shows a habit the client ignored ALL week, at 0/7", () => {
    // The defect this replaced: the grid came from /habits/logs, `logHabit`
    // writes a row only when the client acts, so the habit they never touched
    // had no rows and vanished — the one a coach most needs to see.
    render(
      <HabitsSection
        perHabit={[
          habit({ completedDays: 0, pct: 0, rail: [false, false, false, false, false, false, false] }),
        ]}
      />,
    );

    expect(screen.getByText("Water")).toBeInTheDocument();
    expect(screen.getByText("0/7")).toBeInTheDocument();
  });

  it("counts a mid-week habit over its OWN days, not the whole week", () => {
    // Added on the Thursday: 2/4, never 2/7. It has not missed Monday.
    render(
      <HabitsSection
        perHabit={[
          habit({
            name: "Steps",
            eligibleDays: 4,
            completedDays: 2,
            pct: 50,
            rail: [null, null, null, true, false, true, false],
          }),
        ]}
      />,
    );

    expect(screen.getByText("2/4")).toBeInTheDocument();
    // Three leading dashes for the days before it existed — not empty dots,
    // which would read as three misses.
    expect(screen.getAllByTitle("Not yet added")).toHaveLength(3);
  });

  it("hides a habit that was never eligible in the period", () => {
    render(
      <HabitsSection
        perHabit={[habit({ eligibleDays: 0, completedDays: 0, pct: null, rail: [null, null] })]}
      />,
    );

    expect(screen.queryByText("Water")).not.toBeInTheDocument();
  });

  it("renders nothing when the client has no habits — the rail goes with it", () => {
    // The section owns its own rail rather than the page owning it, and this
    // is the reason: on a one-page review a rail rendered by the parent would
    // leave a bare HABITS label over empty space, and hiding it there would
    // mean a second copy of this component's "do I have anything" predicate.
    const { container } = render(<HabitsSection perHabit={[]} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Habits")).not.toBeInTheDocument();
  });
});
