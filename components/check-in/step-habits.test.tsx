import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { StepHabits } from "./step-habits";
import { HabitEntryError } from "@/hooks/use-client-habit-entries";
import type { ClientHabitWeek, HabitDayFacts, HabitWeekRow } from "@/types/habits";

// The step over a stubbed week hook: what it draws from the week, and what it
// hands the hook and the page. The hook's own rules run over a real cache in
// hooks/use-check-in-habit-week.test.tsx; the frames in
// step-habits.frames.test.tsx.

const { hook, toastError } = vi.hoisted(() => ({
  hook: { week: null as unknown, save: vi.fn(), clear: vi.fn() },
  toastError: vi.fn(),
}));
vi.mock("@/hooks/use-check-in-habit-week", () => ({ useCheckInHabitWeek: () => hook }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

// The plan's step (docs/HABITS-REBUILD-PLAN.md §2.5): the week Thursday 24 to
// Wednesday 30 September 2026, the client checking in on the Wednesday.
const DATES = ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"];

const day = (date: string, facts: Partial<HabitDayFacts> = {}): HabitDayFacts => ({
  date, covered: true, planned: false, target: null, edited: false, versionId: "v", timesPerWeek: null, entry: null, met: false, ...facts,
});

const VALUES = [3.1, 3.0, 2.1, 3.2, 2.5, 3.0, null];
const water: HabitWeekRow = {
  habit: { id: "water", name: "Water", howTo: null, measure: "number", unit: "L", direction: "at_least" },
  words: { schedule: "Every day", target: "at least 3 L" },
  days: DATES.map((date, i) =>
    day(date, {
      planned: true,
      target: 3,
      entry: VALUES[i] === null ? null : { done: null, value: VALUES[i], note: null },
      met: (VALUES[i] ?? 0) >= 3,
    })
  ),
  figures: { planned: 7, done: 4, met: 4 },
};
const mobility: HabitWeekRow = {
  habit: { id: "mobility", name: "Mobility", howTo: null, measure: "tick", unit: null, direction: null },
  words: { schedule: "Mon, Wed, Fri", target: null },
  days: DATES.map((date) => {
    const planned = ["2026-09-25", "2026-09-28", "2026-09-30"].includes(date);
    const done = ["2026-09-25", "2026-09-29"].includes(date);
    return day(date, { planned, entry: done ? { done: true, value: null, note: null } : null, met: done });
  }),
  figures: { planned: 3, done: 2, met: 2 },
};
// Started on the Saturday: no entry before it.
const stretch: HabitWeekRow = {
  habit: { id: "stretch", name: "Stretch", howTo: null, measure: "tick", unit: null, direction: null },
  words: { schedule: "Sat", target: null },
  days: DATES.map((date) => (date < "2026-09-26" ? day(date, { covered: false, versionId: null }) : day(date, { planned: date === "2026-09-26" }))),
  figures: { planned: 1, done: 0, met: 0 },
};
const WEEK: ClientHabitWeek = {
  start: DATES[0],
  end: DATES[6],
  dates: DATES,
  habits: [water, mobility, stretch],
  totals: { planned: 11, done: 6, met: 6 },
};

const trackWrite = vi.fn();

function renderStep(options: { logsOpenFrom?: string | null; disabled?: boolean } = {}) {
  return render(
    <StepHabits
      habitWeek={WEEK}
      clientTimezone="Europe/London"
      logsOpenFrom={options.logsOpenFrom === undefined ? "2026-09-24" : options.logsOpenFrom}
      trackWrite={trackWrite}
      disabled={options.disabled ?? false}
    />
  );
}

/** The row a habit's name heads. */
const rowOf = (name: string) => screen.getByText(name).closest("tr")!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Wednesday evening, London: every day of the week is open.
  vi.setSystemTime(new Date("2026-09-30T18:00:00Z"));
  hook.week = WEEK;
  hook.save.mockReset().mockResolvedValue(undefined);
  hook.clear.mockReset().mockResolvedValue(undefined);
  trackWrite.mockReset();
  toastError.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("StepHabits — the week the check-in reports on", () => {
  it("names the week and lays it out a column a day, Thursday to Wednesday", () => {
    renderStep();

    expect(screen.getByRole("heading", { name: "Your habits" })).toBeInTheDocument();
    expect(screen.getByText("24 Sept – 30 Sept")).toBeInTheDocument();
    const heads = screen.getAllByRole("columnheader").map((head) => head.textContent);
    expect(heads).toEqual(["Habit", "Thu24", "Fri25", "Sat26", "Sun27", "Mon28", "Tue29", "Wed30", "Week"]);
  });

  it("heads each row with the habit and its days, then its target, and ends it with the week's figure", () => {
    renderStep();

    expect(within(rowOf("Water")).getByText("Every day · at least 3 L")).toBeInTheDocument();
    expect(within(rowOf("Water")).getByText("4 of 7")).toBeInTheDocument();
    expect(within(rowOf("Mobility")).getByText("Mon, Wed, Fri")).toBeInTheDocument();
    expect(within(rowOf("Mobility")).getByText("2 of 3")).toBeInTheDocument();
  });

  it("offers a number box on every day of a number habit, holding what was entered", () => {
    renderStep();

    expect(screen.getByRole("textbox", { name: "Water, Sat 26 Sept, planned" })).toHaveValue("2.1");
    expect(screen.getByRole("textbox", { name: "Water, Wed 30 Sept, planned" })).toHaveValue("");
  });

  it("offers a tick on every day a version covers, planned or not, and marks the planned ones", () => {
    const { container } = renderStep();

    // Tuesday was not planned and was done: made up, and open like any other day.
    expect(screen.getByRole("checkbox", { name: "Mobility, Tue 29 Sept" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Mobility, Mon 28 Sept, planned" })).not.toBeChecked();
    expect(within(rowOf("Mobility")).getAllByRole("checkbox")).toHaveLength(7);
    // A dot under each planned day: Fri, Mon and Wed.
    expect(rowOf("Mobility").querySelectorAll("[data-planned]")).toHaveLength(3);
    expect(container.querySelectorAll("[data-planned]")).toHaveLength(7 + 3 + 1);
  });

  it("holds nothing to enter on a day no version covers", () => {
    renderStep();

    expect(within(rowOf("Stretch")).getAllByRole("checkbox")).toHaveLength(5);
    expect(within(rowOf("Stretch")).getByText("Stretch is not running on Thu 24 Sept")).toBeInTheDocument();
  });

  it("locks a day the day rule closes: the box and the tick show it, and take nothing", () => {
    renderStep({ logsOpenFrom: "2026-09-27" });

    expect(screen.getByRole("checkbox", { name: "Mobility, Fri 25 Sept, planned" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Water, Sat 26 Sept, planned" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Mobility, Mon 28 Sept, planned" })).toBeEnabled();
  });

  it("takes nothing while the check-in is being sent: an entry then would race the week's freeze", () => {
    renderStep({ disabled: true });

    for (const tick of screen.getAllByRole("checkbox")) expect(tick).toBeDisabled();
    for (const box of screen.getAllByRole("textbox")) expect(box).toBeDisabled();
  });

  it("says Nothing planned for a habit whose week asks for nothing", () => {
    hook.week = { ...WEEK, habits: [{ ...stretch, figures: { planned: 0, done: 0, met: 0 } }] };
    renderStep();

    expect(within(rowOf("Stretch")).getByText("Nothing planned")).toBeInTheDocument();
  });

  it("says so when the week no longer holds a habit: the coach deleted it while the check-in was open", () => {
    hook.week = { ...WEEK, habits: [], totals: { planned: 0, done: 0, met: 0 } };
    renderStep();

    expect(screen.getByText("No habits this week")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("StepHabits — an entry made on the step", () => {
  it("ticks a day and hands the page the write, which Send waits for", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByRole("checkbox", { name: "Mobility, Mon 28 Sept, planned" }));

    expect(hook.save).toHaveBeenCalledWith(mobility, "2026-09-28", { done: true });
    expect(trackWrite).toHaveBeenCalledWith(hook.save.mock.results[0].value);
  });

  it("saves a number when the client leaves its box, and clears the entry when the box is emptied", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.type(screen.getByRole("textbox", { name: "Water, Wed 30 Sept, planned" }), "3.4");
    await user.tab();
    expect(hook.save).toHaveBeenCalledWith(water, "2026-09-30", { value: 3.4 });

    await user.clear(screen.getByRole("textbox", { name: "Water, Sat 26 Sept, planned" }));
    await user.tab();
    expect(hook.clear).toHaveBeenCalledWith(water, "2026-09-26");
    expect(trackWrite).toHaveBeenCalledTimes(2);
  });

  it("says why a box that does not hold a number cannot be saved, and saves nothing", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.type(screen.getByRole("textbox", { name: "Water, Wed 30 Sept, planned" }), "lots");
    await user.tab();
    expect(hook.save).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Couldn't save Water", { description: "Enter a number, to two decimals at most" });
  });

  it("says out loud a write the server refused, in its own sentence", async () => {
    const user = userEvent.setup();
    hook.save.mockRejectedValue(new HabitEntryError("This day is locked.", 403));
    renderStep();

    await user.click(screen.getByRole("checkbox", { name: "Mobility, Mon 28 Sept, planned" }));
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith("This day is locked", { description: "This day is locked." }));
  });

  it("says a write that got no answer failed for the network, never in the browser's words", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    hook.save.mockRejectedValue(new TypeError("Failed to fetch"));
    renderStep();

    await user.click(screen.getByRole("checkbox", { name: "Mobility, Mon 28 Sept, planned" }));
    await vi.waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Couldn't update habit", { description: "Network error. Please try again." })
    );
  });
});
