import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The coach's Habits tab: the summary, one client week of the client's
// habits as it happened, each row's ⋯, "This day" and + Add habits. The reads
// are mocked by what they return; the week read answers per start, as the
// server does (null: the week holding today). Each render reads the week
// twice, in this order: the table's — the week on screen — then the
// summary's, always the week holding today (null). The real-cache frame tests
// of every save are in habits-tab-frames.test.tsx.

const { reads, writes, toast } = vi.hoisted(() => ({
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
    writesWeek: [] as (string | null)[],
  },
  writes: { land: vi.fn(), order: vi.fn() },
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/hooks/use-client-habits", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-client-habits")>();
  return {
    ...actual,
    useClientHabitList: () => ({ list: reads.list, error: reads.listError, isLoading: reads.listLoading, retry: reads.retryList }),
    // A week not read yet is loading, as SWR's first read of a key is.
    useClientHabitWeek: (_clientId: string, start: string | null) => {
      reads.weekStarts.push(start);
      const week = reads.weeks.get(start) ?? null;
      return { week, error: reads.weekError, isLoading: reads.weekLoading || (week === null && !reads.weekError), retry: reads.retry };
    },
    useHabitWrites: (_clientId: string, weekStart: string | null) => {
      reads.writesWeek.push(weekStart);
      return writes;
    },
    useClientHabitChoices: () => ({ choices: [], error: undefined, isLoading: false, retry: vi.fn() }),
  };
});
vi.mock("sonner", () => ({ toast }));

import { HabitsTabContent } from "./habits-tab-content";
import { LABEL_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import type { Client } from "@/types/check-in";
import type { CoachHabit, CoachHabitWeek, CoachHabitWeekRow, HabitDayFacts, HabitVersion } from "@/types/habits";

const TODAY = "2026-09-30";
const CURRENT_DATES = ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"];
const LAST_DATES = ["2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23"];
const NEXT_DATES = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"];
const EVERY_DAY = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

function facts(date: string, over: Partial<HabitDayFacts> = {}): HabitDayFacts {
  return { date, covered: true, planned: true, target: null, edited: false, versionId: "v", timesPerWeek: null, entry: null, met: false, ...over };
}

function row(
  id: string,
  days: HabitDayFacts[],
  figures: CoachHabitWeekRow["figures"],
  target: string | null = null,
  deleted = false
): CoachHabitWeekRow {
  return {
    habit: { id, name: id, howTo: null, measure: target ? "number" : "tick", unit: target ? "L" : null, direction: target ? "at_least" : null },
    words: { schedule: "Every day", target },
    days,
    figures,
    deleted,
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
    row("Walk", CURRENT_DATES.map((date) => (date === TODAY ? facts(date, { entry: done, met: true }) : facts(date))), { planned: 7, done: 1, met: 1 }),
    row("Sauna", CURRENT_DATES.map((date) => facts(date, { planned: false, timesPerWeek: 3 })), { planned: 3, done: 0, met: 0 }),
    // Deleted today: its days before today stay, and the week says it is deleted.
    row(
      "Stretch",
      CURRENT_DATES.map((date) => (date === TODAY ? facts(date, { covered: false, planned: false, versionId: null }) : facts(date))),
      { planned: 6, done: 0, met: 0 },
      null,
      true
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

const NEXT: CoachHabitWeek = {
  ...CURRENT,
  start: "2026-10-01",
  end: "2026-10-07",
  dates: NEXT_DATES,
  habits: [row("Walk", NEXT_DATES.map((date) => facts(date)), { planned: 7, done: 0, met: 0 })],
  totals: { planned: 7, done: 0, met: 0 },
  today: null,
};

const version = (startsOn: string, over: Partial<HabitVersion> = {}): HabitVersion => ({
  id: `v-${startsOn}`,
  startsOn,
  endsOn: null,
  target: null,
  timesPerWeek: null,
  weekdays: [...EVERY_DAY],
  ...over,
});

function coachHabit(id: string, status: CoachHabit["status"], over: Partial<CoachHabit> = {}): CoachHabit {
  return {
    id,
    name: id,
    howTo: null,
    measure: "tick",
    unit: null,
    direction: null,
    position: 0,
    versions: [version("2026-09-01")],
    dayEdits: [],
    hasEntries: false,
    status,
    words: { schedule: "Every day", target: null },
    ...over,
  };
}

const WATER = coachHabit("Water", "running", { measure: "number", unit: "L", direction: "at_least", words: { schedule: "Every day", target: "at least 3 L" } });
const WALK = coachHabit("Walk", "running");
const SAUNA = coachHabit("Sauna", "running", { versions: [version("2026-09-01", { timesPerWeek: 3, weekdays: [] })], words: { schedule: "3 times a week", target: null } });
const MEDITATION = coachHabit("Meditation", "stopped", { versions: [version("2026-08-01", { endsOn: "2026-09-11" })] });
const STEPS = coachHabit("Steps", "upcoming", { versions: [version("2026-10-12")] });

const CLIENT = { id: "client-3" } as Client;

const band = () => document.querySelector('[data-slot="stat-band"]') as HTMLElement;
const statValue = (label: string) => within(band()).getByText(label).nextElementSibling?.textContent;
const rowOf = (name: string) => screen.getByText(name, { selector: "p" }).closest("tr") as HTMLElement;
const menuButton = (name: string) => screen.getByRole("button", { name: `Actions for ${name}` });
const menuItems = () => screen.getAllByRole("menuitem").map((item) => item.textContent);
/** The week each read of the last render asked for: the table's, then the summary's. */
const lastReads = () => reads.weekStarts.slice(-2);

beforeEach(() => {
  vi.clearAllMocks();
  // Water, Walk, then Meditation (stopped) between them in the client's order,
  // then Sauna and Steps.
  reads.list = { clientToday: TODAY, habits: [WATER, MEDITATION, WALK, SAUNA, STEPS] };
  reads.listLoading = false;
  reads.listError = undefined;
  reads.weeks = new Map<string | null, unknown>([
    [null, CURRENT],
    ["2026-09-17", LAST],
    ["2026-10-01", NEXT],
  ]);
  reads.weekLoading = false;
  reads.weekError = undefined;
  reads.weekStarts = [];
  reads.writesWeek = [];
});
afterEach(() => cleanup());

describe("the summary — the design system's stat band", () => {
  it("shows the week's met of planned, today's planned habits done today, and the habits running today", () => {
    render(<HabitsTabContent client={CLIENT} />);
    expect(statValue("This week")).toBe("6/14");
    expect(statValue("Today")).toBe("1/2");
    // Water, Walk and Sauna run today; Meditation is stopped and Steps starts later.
    expect(statValue("Habits")).toBe("3");
  });

  // The summary is of now: a week paged to is the table's alone, and "This
  // week" over it would be a claim about another week.
  it("shows now whichever week the table shows", async () => {
    render(<HabitsTabContent client={CLIENT} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Previous week" }));
    expect(within(rowOf("Walk")).getByText("7/7")).toBeInTheDocument();
    expect(statValue("This week")).toBe("6/14");
    expect(statValue("Today")).toBe("1/2");
    await user.click(screen.getByRole("button", { name: "Next week" }));
    await user.click(screen.getByRole("button", { name: "Next week" }));
    expect(within(rowOf("Walk")).getByText("0/7")).toBeInTheDocument();
    expect(statValue("This week")).toBe("6/14");
    expect(statValue("Today")).toBe("1/2");
  });

  it("shows a dash for a week and a today with nothing planned, never 0/0", () => {
    reads.weeks.set(null, { ...CURRENT, totals: { planned: 0, done: 0, met: 0 }, today: { planned: 0, done: 0 } });
    render(<HabitsTabContent client={CLIENT} />);
    expect(statValue("This week")).toBe("—");
    expect(statValue("Today")).toBe("—");
    expect(within(band()).queryByText("0/0")).toBeNull();
  });

  it("shows each figure as pending text, never a dash, while the reads are in flight — and holds no line under any", () => {
    reads.weekLoading = true;
    reads.listLoading = true;
    reads.weeks = new Map();
    reads.list = null;
    render(<HabitsTabContent client={CLIENT} />);
    for (const label of ["This week", "Today", "Habits"]) {
      const value = within(band()).getByText(label).nextElementSibling as HTMLElement;
      expect(value.querySelector('[data-slot="skeleton"]')).not.toBeNull();
      expect(value.textContent).toBe("");
    }
    expect(within(band()).queryByText("—")).toBeNull();
    expect(band().querySelectorAll("span.mt-1")).toHaveLength(0);
  });

  // A client-page tab is not arrived at: nothing on it animates its entrance.
  it("enters with no animation", () => {
    const { container } = render(<HabitsTabContent client={CLIENT} />);
    expect(container.querySelector(".animate-card-in")).toBeNull();
  });
});

describe("the table — one row per habit, the week's days on each", () => {
  it("lists the running and starting-later habits in the client's order, then the stopped, then a habit deleted since", () => {
    render(<HabitsTabContent client={CLIENT} />);
    const names = [...document.querySelectorAll("tbody tr")].map((tr) => tr.querySelector("p")?.textContent);
    expect(names).toEqual(["Water", "Walk", "Sauna", "Steps", "Meditation", "Stretch"]);
  });

  it("writes each habit's line: days then target, a later start first, Stopped alone, Deleted alone", () => {
    render(<HabitsTabContent client={CLIENT} />);
    expect(within(rowOf("Water")).getByText("Every day · at least 3 L")).toBeInTheDocument();
    expect(within(rowOf("Sauna")).getByText("3 times a week")).toBeInTheDocument();
    expect(within(rowOf("Steps")).getByText("Starts 12 Oct · Every day")).toBeInTheDocument();
    expect(within(rowOf("Meditation")).getByText("Stopped")).toBeInTheDocument();
    expect(within(rowOf("Stretch")).getByText("Deleted")).toBeInTheDocument();
  });

  it("shows each day as it happened, a number in place of the tick, and each habit's met of planned under Week", () => {
    render(<HabitsTabContent client={CLIENT} />);
    expect(screen.getByRole("columnheader", { name: "Week" })).toBeInTheDocument();
    const water = rowOf("Water");
    expect(within(water).getAllByText("3.1")).toHaveLength(5);
    expect(within(water).getByText("2.5").closest("[data-state]")).toHaveAttribute("data-state", "missed");
    expect(within(water).getByText("5/7")).toBeInTheDocument();
    expect(within(rowOf("Walk")).getByText("1/7")).toBeInTheDocument();
    // A habit the week does not cover: every day blank, no figure.
    expect(rowOf("Steps").querySelectorAll('[data-state="blank"]')).toHaveLength(7);
    expect(within(rowOf("Steps")).getByText("—")).toBeInTheDocument();
  });

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
    const water = rowOf("Water");
    expect(within(water).getByText("1.5").closest("[data-state]")).toHaveAttribute("data-state", "pending");
    expect(water.querySelectorAll('[data-state="missed"]')).toHaveLength(0);
  });

  it("marks a day the coach changed on its cell", () => {
    reads.weeks.set(null, {
      ...CURRENT,
      habits: [row("Walk", CURRENT_DATES.map((date) => (date === TODAY ? facts(date, { planned: false, edited: true }) : facts(date))), { planned: 6, done: 0, met: 0 })],
    });
    render(<HabitsTabContent client={CLIENT} />);
    expect(rowOf("Walk").querySelectorAll("[data-edited]")).toHaveLength(1);
  });

  it("says so when the client has no habit at all", () => {
    reads.list = { clientToday: TODAY, habits: [] };
    reads.weeks.set(null, { ...CURRENT, habits: [], totals: { planned: 0, done: 0, met: 0 }, today: { planned: 0, done: 0 } });
    render(<HabitsTabContent client={CLIENT} />);
    expect(screen.getByText("No habits yet")).toBeInTheDocument();
  });

  it("says the habits failed to load, without the fetch's own words, and retries what failed", async () => {
    reads.weekError = new Error("API request failed");
    render(<HabitsTabContent client={CLIENT} />);
    expect(screen.getByText("Failed to load habits")).toBeInTheDocument();
    expect(screen.queryByText("API request failed")).toBeNull();
    expect(screen.queryByText("No habits yet")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(reads.retry).toHaveBeenCalledTimes(1);
    expect(reads.retryList).not.toHaveBeenCalled();
  });
});

describe("each row's ⋯", () => {
  // Stop and Start again delete nothing: Delete alone wears the danger colour.
  it("offers a running or starting-later habit its changes, the moves and Delete last, Delete alone destructive", async () => {
    const user = userEvent.setup();
    render(<HabitsTabContent client={CLIENT} />);
    await user.click(menuButton("Walk"));
    expect(menuItems()).toEqual(["Change target or days", "Stop", "Rename", "History", "Move up", "Move down", "Delete"]);
    for (const item of screen.getAllByRole("menuitem")) {
      expect(item, item.textContent ?? "").toHaveAttribute("data-variant", item.textContent === "Delete" ? "destructive" : "default");
    }
    // Delete stands apart, behind a separator.
    expect(screen.getByRole("menuitem", { name: "Delete" }).previousElementSibling).toHaveAttribute("role", "separator");
  });

  it("offers a stopped habit Start again, Rename, History and Delete, and no move", async () => {
    const user = userEvent.setup();
    render(<HabitsTabContent client={CLIENT} />);
    await user.click(menuButton("Meditation"));
    expect(menuItems()).toEqual(["Start again", "Rename", "History", "Delete"]);
    expect(screen.getByRole("menuitem", { name: "Start again" })).toHaveAttribute("data-variant", "default");
  });

  it("gives a habit deleted since no ⋯: nothing can change it", () => {
    render(<HabitsTabContent client={CLIENT} />);
    expect(screen.queryByRole("button", { name: "Actions for Stretch" })).toBeNull();
  });

  // The owner's rule at commit 2's smoke: a hover-revealed ⋯ hid what a row
  // could do until the pointer found it.
  it("keeps every row's ⋯ in sight, never waiting on a hover", () => {
    render(<HabitsTabContent client={CLIENT} />);
    for (const name of ["Water", "Walk", "Sauna", "Steps", "Meditation"]) {
      const tableRow = rowOf(name);
      for (let node: HTMLElement | null = menuButton(name); node && node !== tableRow; node = node.parentElement) {
        expect(node.className, name).not.toMatch(/(^|\s|:)(opacity-0|invisible|hidden)(\s|$)/);
      }
    }
  });

  it.each([
    ["Change target or days", "Walk", "Change Walk"],
    ["Stop", "Walk", "Stop Walk?"],
    ["Rename", "Walk", "Rename Walk"],
    ["History", "Walk", "Walk history"],
    ["Delete", "Walk", "Delete Walk?"],
    ["Start again", "Meditation", "Start Meditation again"],
  ])("%s opens its dialog on the habit", async (item, habit, title) => {
    const user = userEvent.setup();
    render(<HabitsTabContent client={CLIENT} />);
    await user.click(screen.getByRole("button", { name: `Actions for ${habit}` }));
    await user.click(screen.getByRole("menuitem", { name: item }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
  });
});

describe("moving a habit", () => {
  const ANSWER = { changed: true, habits: null, week: null, currentWeek: null, weekStart: null };

  it("sends the client's whole list in its new order, a stopped habit keeping its slot, and lands the answer", async () => {
    writes.order.mockResolvedValue(ANSWER);
    const user = userEvent.setup();
    render(<HabitsTabContent client={CLIENT} />);
    await user.click(screen.getByRole("button", { name: "Actions for Walk" }));
    await user.click(screen.getByRole("menuitem", { name: "Move up" }));
    // Walk swaps with Water; Meditation, stopped, keeps its slot between them.
    await waitFor(() => expect(writes.order).toHaveBeenCalledWith(["Walk", "Meditation", "Water", "Sauna", "Steps"]));
    expect(writes.land).toHaveBeenCalledWith(ANSWER);
  });

  // A move is among the running and starting-later habits alone: a stopped
  // habit before the first of them or after the last, in the client's order,
  // is never a neighbour to swap with.
  it("offers the first running habit no Move up and the last no Move down, a stopped habit before and after them in the client's order, and a greyed move sends nothing", async () => {
    const OLD = coachHabit("Old", "stopped", { versions: [version("2026-08-01", { endsOn: "2026-08-31" })] });
    reads.list = { clientToday: TODAY, habits: [MEDITATION, WATER, WALK, SAUNA, STEPS, OLD] };
    const user = userEvent.setup();
    render(<HabitsTabContent client={CLIENT} />);
    const item = async (name: string, move: string) => {
      await user.click(menuButton(name));
      return screen.getByRole("menuitem", { name: move });
    };

    expect(await item("Water", "Move up")).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("menuitem", { name: "Move up" }));
    expect(writes.order).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(await item("Steps", "Move down")).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("menuitem", { name: "Move down" }));
    expect(writes.order).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(await item("Water", "Move down")).not.toHaveAttribute("aria-disabled");
    await user.keyboard("{Escape}");
    expect(await item("Steps", "Move up")).not.toHaveAttribute("aria-disabled");
  });

  // A move is the one write with no surface of its own over the page: while
  // it is in flight nothing else writes, so no two answers can land out of
  // order and leave the older on screen.
  it("holds every write while a move is in flight — each ⋯, each This day, + Add habits — its own ⋯ spinning in place", async () => {
    let settle: (value: typeof ANSWER) => void = () => {};
    const write = new Promise<typeof ANSWER>((resolve) => (settle = resolve));
    writes.order.mockReturnValue(write);
    const user = userEvent.setup();
    render(<HabitsTabContent client={CLIENT} />);
    await user.click(menuButton("Walk"));
    await user.click(screen.getByRole("menuitem", { name: "Move down" }));

    await waitFor(() => expect(menuButton("Walk")).toBeDisabled());
    expect(menuButton("Walk").querySelector(".animate-spin")).not.toBeNull();
    for (const name of ["Water", "Sauna", "Steps", "Meditation"]) {
      expect(menuButton(name), name).toBeDisabled();
      expect(menuButton(name).querySelector(".animate-spin"), name).toBeNull();
    }
    const thisDay = ["Water, Wed 30 Sept", "Walk, Wed 30 Sept"].map((name) => screen.getByRole("button", { name }));
    for (const cell of thisDay) expect(cell).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add habits" })).toBeDisabled();

    await act(async () => {
      settle(ANSWER);
      await write;
    });
    await waitFor(() => expect(menuButton("Walk")).toBeEnabled());
    for (const name of ["Water", "Sauna", "Steps", "Meditation"]) expect(menuButton(name), name).toBeEnabled();
    for (const cell of thisDay) expect(cell).toBeEnabled();
    expect(screen.getByRole("button", { name: "Add habits" })).toBeEnabled();
    expect(writes.land).toHaveBeenCalledWith(ANSWER);
  });

  it("says why when a move is refused, and lands nothing", async () => {
    writes.order.mockRejectedValue(new Error("The habits have changed since this list was loaded. Reload it and try again."));
    const user = userEvent.setup();
    render(<HabitsTabContent client={CLIENT} />);
    await user.click(screen.getByRole("button", { name: "Actions for Walk" }));
    await user.click(screen.getByRole("menuitem", { name: "Move up" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Could not reorder the habits", {
        description: "The habits have changed since this list was loaded. Reload it and try again.",
      })
    );
    expect(writes.land).not.toHaveBeenCalled();
  });
});

describe("This day — a set-days habit's day from today on", () => {
  it("opens on today's and later days of a set-days habit, never a day gone by or a weekly habit's day", () => {
    render(<HabitsTabContent client={CLIENT} />);
    expect(screen.getByRole("button", { name: "Walk, Wed 30 Sept" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Walk, Tue 29 Sept" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sauna, Wed 30 Sept" })).toBeNull();
    // A habit deleted since: nothing opens on it.
    expect(within(rowOf("Stretch")).queryAllByRole("button")).toHaveLength(0);
  });

  it("opens This day on the habit and the day", async () => {
    render(<HabitsTabContent client={CLIENT} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Walk, Wed 30 Sept" }));
    expect(screen.getByRole("heading", { name: "This day" })).toBeInTheDocument();
    expect(screen.getByText("Walk on Wed 30 Sept")).toBeInTheDocument();
  });

  it("marks a later week's planned days, and opens on each", async () => {
    render(<HabitsTabContent client={CLIENT} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Next week" }));
    expect(rowOf("Walk").querySelectorAll('[data-state="ahead"]')).toHaveLength(7);
    expect(screen.getByRole("button", { name: "Walk, Mon 5 Oct" })).toBeInTheDocument();
  });
});

describe("+ Add habits", () => {
  it("opens the Add habits sheet", async () => {
    render(<HabitsTabContent client={CLIENT} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Add habits" }));
    expect(screen.getByRole("dialog", { name: "Add habits" })).toBeInTheDocument();
    expect(screen.getByText("Your habits")).toBeInTheDocument();
  });

  it("waits for the habits before it can open", () => {
    reads.list = null;
    reads.listLoading = true;
    render(<HabitsTabContent client={CLIENT} />);
    expect(screen.getByRole("button", { name: "Add habits" })).toBeDisabled();
  });

  // A word-only action on the week-nav rail takes the rail's interactive
  // register (docs/newdesignsystem.md: rail uppercase is for interactive
  // options), at the rail's 11px, with the teal hover.
  it("reads as the rail's action: the label register at 11px", () => {
    render(<HabitsTabContent client={CLIENT} />);
    const add = screen.getByRole("button", { name: "Add habits" });
    for (const token of LABEL_CLASS.split(" ").filter((token) => token !== "text-[10px]")) expect(add).toHaveClass(token);
    expect(add).toHaveClass("text-[11px]", "hover:text-[#0d9488]");
    expect(add).not.toHaveClass("text-[10px]");
  });
});

describe("paging the weeks", () => {
  it("opens on the week holding the client's today — the table's read and the summary's the same — and writes name no week", () => {
    render(<HabitsTabContent client={CLIENT} />);
    expect(lastReads()).toEqual([null, null]);
    expect(reads.writesWeek.at(-1)).toBeNull();
    expect(screen.getByText("24 Sept – 30 Sept")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous week" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next week" })).toBeEnabled();
  });

  // The frame test: the click shows the new week's dates over a loading
  // table, never the week just left, while the summary stays on now — its
  // read is not the one paged; the week's answer settles the table alone.
  it("pages to a week not read yet: its dates at once, the table loading, the summary still now, never the week left", async () => {
    reads.weeks.delete("2026-09-17");
    const { container, rerender } = render(<HabitsTabContent client={CLIENT} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Previous week" }));

    expect(screen.getByText("17 Sept – 23 Sept")).toBeInTheDocument();
    expect(screen.queryByText("Water", { selector: "p" })).toBeNull();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(band().querySelector('[data-slot="skeleton"]')).toBeNull();
    expect(statValue("This week")).toBe("6/14");
    expect(statValue("Today")).toBe("1/2");

    reads.weeks.set("2026-09-17", LAST);
    rerender(<HabitsTabContent client={CLIENT} />);
    expect(within(rowOf("Walk")).getByText("7/7")).toBeInTheDocument();
    expect(statValue("This week")).toBe("6/14");
    expect(statValue("Today")).toBe("1/2");
  });

  it("pages back and forward a client week at a time, past today to plan ahead, and the writes name the week on screen", async () => {
    render(<HabitsTabContent client={CLIENT} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Previous week" }));
    expect(lastReads()).toEqual(["2026-09-17", null]);
    expect(reads.writesWeek.at(-1)).toBe("2026-09-17");

    await user.click(screen.getByRole("button", { name: "Next week" }));
    // Back on the current week: the server's, never a start the tab remembers.
    expect(lastReads()).toEqual([null, null]);
    expect(reads.writesWeek.at(-1)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Next week" }));
    expect(lastReads()).toEqual(["2026-10-01", null]);
    expect(reads.writesWeek.at(-1)).toBe("2026-10-01");
    expect(screen.getByText("1 Oct – 7 Oct")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Previous week" }));
    expect(lastReads()).toEqual([null, null]);
  });
});
