import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { HabitsSection } from "./habits-section";
import { readSentSnapshot, type SentHabitWeek } from "@/lib/check-in/sent-snapshot";

const DATES = ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"];
const EVERY_DAY = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
type Habit = SentHabitWeek["habits"][number];
type Day = Habit["days"][number];

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

const day = (date: string, facts: Partial<Day> = {}): Day => ({
  date,
  covered: true,
  planned: true,
  target: null,
  entry: null,
  met: false,
  ...facts,
});

// The plan's review (docs/HABITS-REBUILD-PLAN.md §2.5): the client's week,
// Thursday 24 to Wednesday 30 September, after they entered Wednesday's.
const VALUES = [3.1, 3.0, 2.1, 3.2, 2.5, 3.0, 3.0];
const water: Habit = {
  id: "water",
  name: "Water",
  measure: "number",
  unit: "L",
  direction: "at_least",
  firstStartsOn: "2026-09-01",
  versions: [{ startsOn: "2026-09-01", endsOn: null, target: 3, timesPerWeek: null, weekdays: [...EVERY_DAY] }],
  days: DATES.map((date, i) =>
    day(date, {
      target: 3,
      entry: { done: null, value: VALUES[i], note: date === "2026-09-26" ? "Travelling, only had the one bottle" : null },
      met: VALUES[i] >= 3,
    })
  ),
  figures: { planned: 7, done: 5, met: 5 },
};
const mobility: Habit = {
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
    const done = ["2026-09-25", "2026-09-29", "2026-09-30"].includes(date);
    return day(date, { planned, entry: done ? { done: true, value: null, note: null } : null, met: done });
  }),
  figures: { planned: 3, done: 3, met: 3 },
};
const sauna: Habit = {
  id: "sauna",
  name: "Sauna",
  measure: "tick",
  unit: null,
  direction: null,
  firstStartsOn: "2026-09-01",
  versions: [{ startsOn: "2026-09-01", endsOn: null, target: null, timesPerWeek: 3, weekdays: [] }],
  days: DATES.map((date) => {
    const done = ["2026-09-25", "2026-09-27", "2026-09-30"].includes(date);
    return day(date, { planned: false, entry: done ? { done: true, value: null, note: null } : null, met: done });
  }),
  figures: { planned: 3, done: 3, met: 3 },
};
const PLAN_WEEK: SentHabitWeek = { habits: [water, mobility, sauna], totals: { planned: 13, done: 11, met: 11 } };

/** Long walk, Sundays, added on the Monday: it ran three days of the week and was planned on none. */
const longWalk = (tuesday: Day["entry"]): Habit => ({
  id: "walk",
  name: "Long walk",
  measure: "tick",
  unit: null,
  direction: null,
  firstStartsOn: "2026-09-28",
  versions: [{ startsOn: "2026-09-28", endsOn: null, target: null, timesPerWeek: null, weekdays: ["sunday"] }],
  days: DATES.map((date) =>
    date < "2026-09-28"
      ? day(date, { covered: false, planned: false })
      : day(date, {
          planned: false,
          entry: date === "2026-09-29" ? tuesday : null,
          met: date === "2026-09-29" && tuesday !== null,
        })
  ),
  figures: { planned: 0, done: tuesday ? 1 : 0, met: 0 },
});

/** The row a habit's name heads. */
const rowOf = (name: string) => screen.getByText(name).closest("tr")!;

afterEach(cleanup);

describe("HabitsSection — the week as it was prescribed and as it happened", () => {
  it("rails the week's total: the habit days met over the days planned", () => {
    render(<HabitsSection habitWeek={PLAN_WEEK} />);

    expect(screen.getByText("Habits")).toBeInTheDocument();
    expect(screen.getByText("11/13 done")).toBeInTheDocument();
  });

  it("heads each row with the habit's name and its days, then its target, as they stood", () => {
    render(<HabitsSection habitWeek={PLAN_WEEK} />);

    expect(within(rowOf("Water")).getByText("Every day · at least 3 L")).toBeInTheDocument();
    expect(within(rowOf("Mobility")).getByText("Mon, Wed, Fri")).toBeInTheDocument();
    expect(within(rowOf("Sauna")).getByText("3 times a week")).toBeInTheDocument();
  });

  it("puts a number habit's numbers in its days, teal where they met the day's target and muted where they fell short", () => {
    const { container } = render(<HabitsSection habitWeek={PLAN_WEEK} />);

    const saturday = container.querySelector('[data-habit="water"] [data-day="2026-09-26"]')!;
    expect(saturday).toHaveTextContent("2.1");
    expect(saturday.querySelector(".text-\\[\\#93b0b4\\]")).not.toBeNull();
    expect(saturday.querySelector('[title="Missed, target at least 3 L"]')).not.toBeNull();
    const thursday = container.querySelector('[data-habit="water"] [data-day="2026-09-24"]')!;
    expect(thursday).toHaveTextContent("3.1");
    expect(thursday.querySelector(".text-\\[\\#0d9488\\]")).not.toBeNull();
  });

  it("gives a number habit's week its figure with its average under it, and a tick habit's its figure alone", () => {
    const { container } = render(<HabitsSection habitWeek={PLAN_WEEK} />);

    const lines = (habitId: string) =>
      [...container.querySelector(`[data-habit="${habitId}"] [data-col="week"]`)!.children].map((line) => line.textContent);
    expect(lines("water")).toEqual(["5/7", "avg 2.8 L"]);
    expect(lines("mobility")).toEqual(["3/3"]);
    expect(lines("sauna")).toEqual(["3/3"]);
  });

  it("sets the average in the type of the habit's words under its name: a phrase, not a bare number", () => {
    const { container } = render(<HabitsSection habitWeek={PLAN_WEEK} />);

    const average = container.querySelector('[data-habit="water"] [data-col="week"]')!.lastElementChild!;
    const words = within(rowOf("Water")).getByText("Every day · at least 3 L");
    for (const type of ["text-xs", "text-[#93b0b4]"]) {
      expect(words).toHaveClass(type);
      expect(average).toHaveClass(type);
    }
    expect(average.className).not.toMatch(/font-mono|text-\[12\.5px\]/);
  });

  it("gives the habit and the week set widths, and the seven days the rest of the card in equal shares", () => {
    const { container } = render(<HabitsSection habitWeek={PLAN_WEEK} />);

    expect(container.querySelector("table")).toHaveClass("table-fixed");
    const headings = [...container.querySelectorAll("thead th")];
    expect(headings[0]).toHaveClass("w-[220px]");
    expect(headings.at(-1)).toHaveClass("w-[140px]");
    // No day sets its own width: in a fixed layout they share what is left equally.
    for (const day of headings.slice(1, -1)) expect(day.className).not.toMatch(/\bw-|min-w-/);
  });

  it("draws a set-days habit's unplanned days as dashes, and a day made up on one of them as done", () => {
    const { container } = render(<HabitsSection habitWeek={PLAN_WEEK} />);

    const marks = DATES.map((date) => container.querySelector(`[data-habit="mobility"] [data-day="${date}"] [title]`)!.getAttribute("title"));
    // Thursday to Wednesday: Monday planned and missed, Tuesday not planned and done.
    expect(marks).toEqual(["Not planned", "Done", "Not planned", "Not planned", "Missed", "Done", "Done"]);
  });

  it("titles the days a habit done N times a week was not done \"Any day of the week\", never Not planned", () => {
    const { container } = render(<HabitsSection habitWeek={PLAN_WEEK} />);

    const marks = DATES.map((date) => container.querySelector(`[data-habit="sauna"] [data-day="${date}"] [title]`)!.getAttribute("title"));
    const anyDay = "Any day of the week";
    expect(marks).toEqual([anyDay, "Done", anyDay, "Done", anyDay, anyDay, "Done"]);
  });

  it("lists the client's notes under the table, the day and the habit beside each", () => {
    render(<HabitsSection habitWeek={PLAN_WEEK} />);

    const note = screen.getByText("“Travelling, only had the one bottle”").closest("li")!;
    expect(note).toHaveTextContent("Sat 26 · Water:");
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
          versions: [{ startsOn: restart, endsOn: null, target: null, timesPerWeek: null, weekdays: [...EVERY_DAY] }],
          days: DATES.map((date) =>
            date < restart
              ? day(date, { covered: false, planned: false })
              : day(date, { entry: { done: true, value: null, note: null }, met: true })
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

  it("hides a habit the week neither planned nor saw entered", () => {
    render(<HabitsSection habitWeek={{ habits: [water, longWalk(null)], totals: water.figures }} />);

    expect(screen.getByText("Water")).toBeInTheDocument();
    expect(screen.queryByText("Long walk")).not.toBeInTheDocument();
  });

  it("shows a habit done on a day the week did not plan: Nothing planned for its week, and its note under the table", () => {
    // The client's step lists every habit that ran, so a note left on it
    // reaches the coach here.
    const walk = longWalk({ done: true, value: null, note: "Hotel gym" });
    const { container } = render(<HabitsSection habitWeek={{ habits: [water, walk], totals: water.figures }} />);

    expect(container.querySelector('[data-habit="walk"] [data-col="week"]')!.textContent).toBe("Nothing planned");
    expect(container.querySelector('[data-habit="walk"] [data-day="2026-09-29"] [title]')!.getAttribute("title")).toBe("Done");
    expect(screen.getByText("“Hotel gym”").closest("li")).toHaveTextContent("Tue 29 · Long walk:");
    // A habit with nothing planned adds nothing to the week's total.
    expect(screen.getByText("5/7 done")).toBeInTheDocument();
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
