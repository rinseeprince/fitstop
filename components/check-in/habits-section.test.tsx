import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { HabitsSection } from "./habits-section";
import { readSentSnapshot, type SentHabitWeek } from "@/lib/check-in/sent-snapshot";

const DATES =["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"];

/** A version 2 copy's habits, read through the reader every surface uses. */
function fromVersion2(
  perHabit: { id: string; name: string; eligibleDays: number; completedDays: number; pct: number | null; rail: (boolean | null)[] }[]
): SentHabitWeek {
  const copy = readSentSnapshot({
    version: 2,
    day: "2026-09-30",
    readings: { weight: null, bodyFat: null, waist: null, hips: null, chest: null, arms: null, thighs: null },
    standing: { weight: null, bodyFat: null },
    goal: null,
    goalProgress: {},
    nutritionPlan: null,
    period: { dates: DATES, loggedDates: [], nutrition: [], habits: { rail: [], avgPct: null, daysBelow50: 0, perHabit } },
    questions: [],
  });
  return copy!.period!.habitWeek;
}

afterEach(cleanup);

describe("HabitsSection", () => {
  it("scores a habit's week: met over planned", () => {
    render(
      <HabitsSection
        habitWeek={fromVersion2([
          { id: "h1", name: "Water", eligibleDays: 7, completedDays: 5, pct: 71, rail: [true, true, false, true, true, false, true] },
        ])}
      />
    );

    expect(screen.getByText("Water")).toBeInTheDocument();
    expect(screen.getByText("5/7")).toBeInTheDocument();
  });

  it("shows a habit the client ignored ALL week, at 0/7", () => {
    // The week is frozen from the habits, not from the entries, so the habit
    // they never touched is there — the one a coach most needs to see.
    render(
      <HabitsSection
        habitWeek={fromVersion2([
          { id: "h1", name: "Water", eligibleDays: 7, completedDays: 0, pct: 0, rail: [false, false, false, false, false, false, false] },
        ])}
      />
    );

    expect(screen.getByText("Water")).toBeInTheDocument();
    expect(screen.getByText("0/7")).toBeInTheDocument();
  });

  it("counts a mid-week habit over its OWN days, not the whole week", () => {
    // Added on the Thursday: 2/4, never 2/7. It has not missed Monday.
    render(
      <HabitsSection
        habitWeek={fromVersion2([
          { id: "h1", name: "Steps", eligibleDays: 4, completedDays: 2, pct: 50, rail: [null, null, null, true, false, true, false] },
        ])}
      />
    );

    expect(screen.getByText("2/4")).toBeInTheDocument();
    // Three leading dashes for the days before it existed — not empty dots,
    // which would read as three misses.
    expect(screen.getAllByTitle("Not yet added")).toHaveLength(3);
  });

  it("draws a set-days habit's unplanned days as dashes, and a day made up on one of them as done", () => {
    const week: SentHabitWeek = {
      habits: [
        {
          id: "mobility",
          name: "Mobility",
          measure: "tick",
          unit: null,
          direction: null,
          firstStartsOn: "2026-09-01",
          versions: [{ startsOn: "2026-09-01", endsOn: null, target: null, timesPerWeek: null, weekdays: ["monday", "wednesday", "friday"] }],
          days: DATES.map((date) => {
            const planned = ["2026-09-25", "2026-09-28", "2026-09-30"].includes(date);
            // Missed the Monday, made it up on the Tuesday.
            const done = ["2026-09-25", "2026-09-29"].includes(date);
            return {
              date,
              covered: true,
              planned,
              target: null,
              entry: done ? { done: true, value: null, note: null } : null,
              met: done,
            };
          }),
          figures: { planned: 3, done: 2, met: 2 },
        },
      ],
      totals: { planned: 3, done: 2, met: 2 },
    };
    const { container } = render(<HabitsSection habitWeek={week} />);

    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(screen.getAllByTitle("Not planned")).toHaveLength(3);
    // Done on the Friday and the Tuesday; missed on the Monday and the Wednesday.
    expect(container.querySelectorAll(".bg-\\[\\#0d9488\\]")).toHaveLength(2);
    expect(container.querySelectorAll(".rounded-full")).toHaveLength(4);
    // Day by day, Thursday to Wednesday: each mark on its own day.
    const marks = [...container.querySelectorAll(".rounded-full, [title]")].map((node) =>
      node.classList.contains("bg-[#0d9488]") ? "done" : node.classList.contains("rounded-full") ? "missed" : node.getAttribute("title")
    );
    expect(marks).toEqual(["Not planned", "done", "Not planned", "Not planned", "missed", "done", "missed"]);
  });

  it("titles the days before a restart inside the week \"Not running\": the habit was added long before it", () => {
    // Added in August and stopped; started again on the Monday, every day.
    const restart = "2026-09-28";
    const week: SentHabitWeek = {
      habits: [
        {
          id: "stretch",
          name: "Stretch",
          measure: "tick",
          unit: null,
          direction: null,
          firstStartsOn: "2026-08-03",
          versions: [{ startsOn: restart, endsOn: null, target: null, timesPerWeek: null, weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] }],
          days: DATES.map((date) =>
            date < restart
              ? { date, covered: false, planned: false, target: null, entry: null, met: false }
              : { date, covered: true, planned: true, target: null, entry: { done: true, value: null, note: null }, met: true }
          ),
          figures: { planned: 3, done: 3, met: 3 },
        },
      ],
      totals: { planned: 3, done: 3, met: 3 },
    };
    render(<HabitsSection habitWeek={week} />);

    expect(screen.getAllByTitle("Not running")).toHaveLength(4);
    expect(screen.queryByTitle("Not yet added")).not.toBeInTheDocument();
  });

  it("hides a habit with nothing planned that week", () => {
    render(
      <HabitsSection
        habitWeek={fromVersion2([
          { id: "h1", name: "Water", eligibleDays: 0, completedDays: 0, pct: null, rail: [null, null, null, null, null, null, null] },
        ])}
      />
    );

    expect(screen.queryByText("Water")).not.toBeInTheDocument();
  });

  it("renders nothing when the client has no habits — the rail goes with it", () => {
    // The section owns its own rail rather than the page owning it, and this
    // is the reason: on a one-page review a rail rendered by the parent would
    // leave a bare HABITS label over empty space, and hiding it there would
    // mean a second copy of this component's "do I have anything" predicate.
    const { container } = render(<HabitsSection habitWeek={{ habits: [], totals: { planned: 0, done: 0, met: 0 } }} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Habits")).not.toBeInTheDocument();
  });

  it("renders nothing for a check-in whose week could not be resolved", () => {
    const { container } = render(<HabitsSection habitWeek={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

