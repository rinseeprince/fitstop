import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The coach's Habits tab: the week tracker over one client week, its summary,
// and the drawer. The reads are mocked by what they return; the week read
// answers per start, as the server does (null: the week holding today).

const { reads } = vi.hoisted(() => ({
  reads: {
    list: null as unknown,
    listLoading: false,
    listError: undefined as unknown,
    retryList: vi.fn(),
    weeks: new Map<string | null, unknown>(),
    weekLoading: false,
    weekError: undefined as unknown,
    retry: vi.fn(),
    weekStarts: [] as (string | null)[],
  },
}));
vi.mock("@/hooks/use-client-habits", () => ({
  useClientHabitList: () => ({ list: reads.list, error: reads.listError, isLoading: reads.listLoading, retry: reads.retryList }),
  // A week not read yet is loading, as SWR's first read of a key is.
  useClientHabitWeek: (_clientId: string, start: string | null) => {
    reads.weekStarts.push(start);
    const week = reads.weeks.get(start) ?? null;
    return { week, error: reads.weekError, isLoading: reads.weekLoading || (week === null && !reads.weekError), retry: reads.retry };
  },
  useHabitWrites: () => ({}),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { HabitsTabContent } from "./habits-tab-content";
import type { Client } from "@/types/check-in";
import type { CoachHabit, CoachHabitWeek, HabitDayFacts, HabitWeekRow } from "@/types/habits";

const TODAY = "2026-09-30";
const CURRENT_DATES = ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"];
const LAST_DATES = ["2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23"];

function facts(date: string, over: Partial<HabitDayFacts> = {}): HabitDayFacts {
  return { date, covered: true, planned: true, target: null, edited: false, versionId: "v", timesPerWeek: null, entry: null, met: false, ...over };
}

function row(name: string, days: HabitDayFacts[], figures: HabitWeekRow["figures"], target: string | null = null): HabitWeekRow {
  return {
    habit: { id: `h-${name}`, name, howTo: null, measure: target ? "number" : "tick", unit: target ? "L" : null, direction: target ? "at_least" : null },
    words: { schedule: "Every day", target },
    days,
    figures,
  };
}

const done = { done: true, value: null, note: null };

const CURRENT: CoachHabitWeek = {
  clientToday: TODAY,
  start: "2026-09-24",
  end: TODAY,
  dates: CURRENT_DATES,
  habits: [
    row(
      "Water",
      CURRENT_DATES.map((date) =>
        date === "2026-09-29"
          ? facts(date, { target: 3, entry: { done: null, value: 2.5, note: null } })
          : date === TODAY
            ? facts(date, { target: 3 })
            : facts(date, { target: 3, entry: { done: null, value: 3.1, note: null }, met: true })
      ),
      { planned: 7, done: 5, met: 5 },
      "at least 3 L"
    ),
    row(
      "Walk",
      CURRENT_DATES.map((date) => (date === TODAY ? facts(date, { entry: done, met: true }) : facts(date))),
      { planned: 7, done: 1, met: 1 }
    ),
  ],
  totals: { planned: 14, done: 6, met: 6 },
  today: { planned: 2, done: 1 },
};

const LAST: CoachHabitWeek = {
  ...CURRENT,
  start: "2026-09-17",
  end: "2026-09-23",
  dates: LAST_DATES,
  habits: [row("Walk", LAST_DATES.map((date) => facts(date, { entry: done, met: true })), { planned: 7, done: 7, met: 7 })],
  totals: { planned: 7, done: 7, met: 7 },
  today: null,
};

function coachHabit(id: string, status: CoachHabit["status"]): CoachHabit {
  return {
    id,
    name: id,
    howTo: null,
    measure: "tick",
    unit: null,
    direction: null,
    position: 0,
    versions: [],
    dayEdits: [],
    hasEntries: false,
    status,
    words: { schedule: null, target: null },
  };
}

const CLIENT = { id: "client-3" } as Client;

const strip = () => screen.getByText("Today").closest("div.grid") as HTMLElement;
const statValue = (label: string) => within(strip()).getByText(label).nextElementSibling?.textContent;

beforeEach(() => {
  vi.clearAllMocks();
  reads.list = {
    clientToday: TODAY,
    habits: [coachHabit("water", "running"), coachHabit("walk", "running"), coachHabit("sauna", "stopped"), coachHabit("stretch", "upcoming")],
  };
  reads.listLoading = false;
  reads.listError = undefined;
  reads.weeks = new Map<string | null, unknown>([
    [null, CURRENT],
    ["2026-09-17", LAST],
  ]);
  reads.weekLoading = false;
  reads.weekError = undefined;
  reads.weekStarts = [];
});
afterEach(() => cleanup());

describe("the summary", () => {
  it("shows today's planned habits done today, the week's met of planned and the habits running today", () => {
    render(<HabitsTabContent client={CLIENT} />);
    expect(statValue("Today")).toBe("1/2");
    // 6 met of 14 planned: Water's 5 of 7 and Walk's 1 of 7.
    expect(statValue("Weekly Rate")).toBe("6/14");
    // Stopped and upcoming habits are not running today.
    expect(statValue("Active Habits")).toBe("2");
    expect(screen.queryByText("Streak")).toBeNull();
  });

  it("shows a dash for today on a week that does not hold it, and for a rate with nothing planned", async () => {
    reads.weeks.set("2026-09-17", { ...LAST, totals: { planned: 0, done: 0, met: 0 } });
    render(<HabitsTabContent client={CLIENT} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Previous week" }));

    expect(statValue("Today")).toBe("—");
    expect(statValue("Weekly Rate")).toBe("—");
  });

  // Today with nothing planned says what the Weekly Rate says of a week with
  // nothing planned: a dash, never "0/0".
  it("shows a dash for today when nothing is planned today", () => {
    reads.weeks.set(null, { ...CURRENT, today: { planned: 0, done: 0 } });
    render(<HabitsTabContent client={CLIENT} />);
    expect(statValue("Today")).toBe("—");
    expect(within(strip()).queryByText("0/0")).toBeNull();
  });

  it("shows each figure as pending text, never a dash, while the reads are in flight", () => {
    reads.weekLoading = true;
    reads.listLoading = true;
    reads.weeks = new Map();
    reads.list = null;
    render(<HabitsTabContent client={CLIENT} />);
    for (const label of ["Today", "Weekly Rate", "Active Habits"]) {
      const value = within(strip()).getByText(label).nextElementSibling as HTMLElement;
      expect(value.querySelector('[data-slot="skeleton"]')).not.toBeNull();
      expect(value.textContent).toBe("");
    }
    expect(within(strip()).queryByText("—")).toBeNull();
  });
});

describe("a load that failed", () => {
  it("says the habits failed to load, without the fetch's own words, and retries both reads", async () => {
    reads.listError = new Error("API request failed");
    reads.weekError = new Error("API request failed");
    render(<HabitsTabContent client={CLIENT} />);

    expect(screen.getByText("Failed to load habits")).toBeInTheDocument();
    expect(screen.queryByText("API request failed")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(reads.retryList).toHaveBeenCalledTimes(1);
    expect(reads.retry).toHaveBeenCalledTimes(1);
  });
});

describe("the week tracker", () => {
  it("shows each day as it happened, a number in place of the tick, and each habit's met of planned", () => {
    render(<HabitsTabContent client={CLIENT} />);
    const water = screen.getByText("Water").closest("tr") as HTMLElement;
    expect(within(water).getByText("· at least 3 L")).toBeInTheDocument();
    // Met at 3.1; short at 2.5, its number kept.
    expect(within(water).getAllByText("3.1")).toHaveLength(5);
    expect(within(water).getByText("2.5")).toBeInTheDocument();
    // Its Rate: 5 met of 7 planned.
    expect(within(water).getByText("5/7")).toBeInTheDocument();
    const walk = screen.getByText("Walk").closest("tr") as HTMLElement;
    expect(within(walk).getByText("1/7")).toBeInTheDocument();
    expect(within(walk).queryByText("5/7")).toBeNull();
    expect(screen.queryByText("Streak")).toBeNull();
  });

  it("shows a dash for a habit's Rate when nothing was planned for it", () => {
    reads.weeks.set(null, {
      ...CURRENT,
      habits: [row("Sauna", CURRENT_DATES.map((date) => facts(date, { planned: false, timesPerWeek: 3 })), { planned: 0, done: 0, met: 0 })],
    });
    render(<HabitsTabContent client={CLIENT} />);
    const sauna = screen.getByText("Sauna").closest("tr") as HTMLElement;
    expect(within(sauna).getByText("—")).toBeInTheDocument();
  });

  // Today is still open: 1.5 L of 3 at lunch is not a miss yet. The cell
  // stays pending, its number in the pending box.
  it("reads today as still open, a number short of its target shown in the pending box", () => {
    reads.weeks.set(null, {
      ...CURRENT,
      habits: [
        row(
          "Water",
          CURRENT_DATES.map((date) =>
            date === TODAY
              ? facts(date, { target: 3, entry: { done: null, value: 1.5, note: null } })
              : facts(date, { target: 3, entry: { done: null, value: 3.1, note: null }, met: true })
          ),
          { planned: 7, done: 6, met: 6 },
          "at least 3 L"
        ),
      ],
    });
    render(<HabitsTabContent client={CLIENT} />);
    const water = screen.getByText("Water").closest("tr") as HTMLElement;
    const today = within(water).getByText("1.5").closest("[data-state]");
    expect(today).toHaveAttribute("data-state", "pending");
    expect(water.querySelectorAll('[data-state="missed"]')).toHaveLength(0);
  });

  it("says so when no habit runs in the week", () => {
    reads.weeks.set(null, { ...CURRENT, habits: [], totals: { planned: 0, done: 0, met: 0 }, today: { planned: 0, done: 0 } });
    render(<HabitsTabContent client={CLIENT} />);
    expect(screen.getByText("No habits this week")).toBeInTheDocument();
  });

  it("offers a retry when the week fails to load", async () => {
    reads.weekError = new Error("boom");
    render(<HabitsTabContent client={CLIENT} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(reads.retry).toHaveBeenCalled();
  });
});

describe("paging the weeks", () => {
  it("opens on the week holding the client's today, which pages back and not forward", () => {
    render(<HabitsTabContent client={CLIENT} />);
    expect(reads.weekStarts.at(-1)).toBeNull();
    expect(screen.getByText("24 Sept – 30 Sept")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next week" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous week" })).toBeEnabled();
  });

  // The frame test: the click shows the new week's dates over a loading table
  // and pending figures, never the week just left; its answer settles it.
  it("pages to a week not read yet: its dates at once, the table loading and the figures pending, never the week left", async () => {
    reads.weeks.delete("2026-09-17");
    const { container, rerender } = render(<HabitsTabContent client={CLIENT} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Previous week" }));

    expect(screen.getByText("17 Sept – 23 Sept")).toBeInTheDocument();
    expect(screen.queryByText("Water")).toBeNull();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(within(strip()).queryByText("1/2")).toBeNull();
    expect(within(strip()).queryByText("6/14")).toBeNull();
    expect(within(strip()).queryByText("—")).toBeNull();

    reads.weeks.set("2026-09-17", LAST);
    rerender(<HabitsTabContent client={CLIENT} />);
    const walk = screen.getByText("Walk").closest("tr") as HTMLElement;
    expect(within(walk).getByText("7/7")).toBeInTheDocument();
    expect(statValue("Today")).toBe("—");
    expect(statValue("Weekly Rate")).toBe("7/7");
  });

  it("pages back a client week at a time, and forward again to the week holding today", async () => {
    render(<HabitsTabContent client={CLIENT} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Previous week" }));
    expect(reads.weekStarts.at(-1)).toBe("2026-09-17");
    expect(screen.getByText("17 Sept – 23 Sept")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Previous week" }));
    expect(reads.weekStarts.at(-1)).toBe("2026-09-10");

    await user.click(screen.getByRole("button", { name: "Next week" }));
    expect(reads.weekStarts.at(-1)).toBe("2026-09-17");
    await user.click(screen.getByRole("button", { name: "Next week" }));
    // Back on the current week: the server's, never a start the tab remembers.
    expect(reads.weekStarts.at(-1)).toBeNull();
    expect(screen.getByRole("button", { name: "Next week" })).toBeDisabled();
  });
});
