import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

const { toast } = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("sonner", () => ({ toast }));

import { HabitsManageDrawer } from "./habits-manage-drawer";
import { HabitRequestError, type HabitWrites } from "@/hooks/use-client-habits";
import { TEXT_SECONDARY } from "@/components/clients/training/program-builder/builder-tokens";
import type { CoachHabit, CoachHabitList, HabitVersion } from "@/types/habits";

// The coach's Manage Habits drawer. The host holds the list the way the seeded
// SWR read does: `land` replaces it with a write's answer, so the drawer
// re-renders from what the write returned and from nothing else — and a null
// answer (the write saved, its habits not read back) keeps the list on screen
// while the real `land` refetches it.

const TODAY = "2026-09-30";
const EVERY_DAY = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

function version(over: Partial<HabitVersion> = {}): HabitVersion {
  return { id: "v", startsOn: "2026-09-01", endsOn: null, target: null, timesPerWeek: null, weekdays: [...EVERY_DAY], ...over };
}

function habit(over: Partial<CoachHabit> & { id: string; name: string }): CoachHabit {
  return {
    howTo: null,
    measure: "tick",
    unit: null,
    direction: null,
    position: 0,
    versions: [version()],
    dayEdits: [],
    hasEntries: true,
    status: "running",
    words: { schedule: "Every day", target: null },
    ...over,
  };
}

const WATER = habit({
  id: "h-water",
  name: "Water",
  howTo: "A glass with each meal",
  measure: "number",
  unit: "L",
  direction: "at_least",
  versions: [version({ id: "v-water", target: 3, weekdays: ["monday", "wednesday", "friday"] })],
  words: { schedule: "Mon, Wed, Fri", target: "at least 3 L" },
});
const WALK = habit({ id: "h-walk", name: "Walk", hasEntries: false });
const SAUNA = habit({
  id: "h-sauna",
  name: "Sauna",
  status: "stopped",
  versions: [version({ id: "v-sauna", endsOn: "2026-09-20", timesPerWeek: 3, weekdays: [] })],
  words: { schedule: "3 times a week", target: null },
});
const STRETCH = habit({
  id: "h-stretch",
  name: "Stretch",
  status: "upcoming",
  hasEntries: false,
  versions: [version({ id: "v-stretch", startsOn: "2026-10-05" })],
});

const LIST: CoachHabitList = { clientToday: TODAY, habits: [WATER, WALK, SAUNA, STRETCH] };

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const writes = {
  add: vi.fn(),
  rename: vi.fn(),
  change: vi.fn(),
  stop: vi.fn(),
  remove: vi.fn(),
  order: vi.fn(),
  land: vi.fn(),
};

function Host({ initial = LIST }: { initial?: CoachHabitList }) {
  const [list, setList] = useState(initial);
  writes.land.mockImplementation((next: CoachHabitList | null) => {
    if (next) setList(next);
  });
  return <HabitsManageDrawer open onOpenChange={vi.fn()} list={list} writes={writes as unknown as HabitWrites} />;
}

function renderDrawer(initial?: CoachHabitList) {
  render(<Host initial={initial} />);
  return userEvent.setup();
}

const confirmDialog = () => screen.getByRole("dialog", { name: /^(Stop|Delete) / });
const rowOf = (name: string) => screen.getByText(name, { selector: "p" }).closest("div.group") as HTMLElement;
/** A habit's ⋯: its row's actions, named for the habit. */
const menuButton = (name: string) => screen.getByRole("button", { name: `Actions for ${name}` });

type User = ReturnType<typeof userEvent.setup>;

/** Opens a habit's ⋯ menu. */
async function openMenu(user: User, name: string) {
  await user.click(menuButton(name));
  return screen.getByRole("menu");
}

/** Opens a habit's ⋯ menu and chooses one of its items. */
async function choose(user: User, name: string, item: string) {
  await openMenu(user, name);
  await user.click(screen.getByRole("menuitem", { name: item }));
}

/** One item of a habit's ⋯ menu, the menu left open. */
async function itemOf(user: User, name: string, item: string) {
  await openMenu(user, name);
  return screen.getByRole("menuitem", { name: item });
}

const closeMenu = (user: User) => user.keyboard("{Escape}");

/** A habit's ⋯ menu as it reads, top to bottom, a separator as "---"; the menu closed after. */
async function menuOf(user: User, name: string) {
  const menu = await openMenu(user, name);
  const items = Array.from(menu.querySelectorAll('[role="menuitem"], [role="separator"]'), (node) =>
    node.getAttribute("role") === "separator" ? "---" : node.textContent
  );
  await closeMenu(user);
  return items;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => cleanup());

describe("the drawer lists the client's habits and what each can do", () => {
  // Each row's ⋯ menu: Edit, Stop and the two moves on a running or upcoming
  // habit; Start again and Edit on a stopped one; then, for a habit the client
  // never logged, Delete, last behind a separator.
  it("shows each habit's days and target, where it stands, and in its menu only the actions it allows, in order", async () => {
    const user = renderDrawer();

    expect(within(rowOf("Water")).getByText("Mon, Wed, Fri · at least 3 L")).toBeInTheDocument();
    expect(within(rowOf("Water")).getByText("A glass with each meal")).toBeInTheDocument();
    // Running, entries made: it can be stopped, never deleted.
    expect(await menuOf(user, "Water")).toEqual(["Edit", "Stop", "Move up", "Move down"]);
    // Running, never logged: stopped or deleted.
    expect(await menuOf(user, "Walk")).toEqual(["Edit", "Stop", "Move up", "Move down", "---", "Delete"]);
    // Stopped: started again in Stop's place, never stopped twice, never moved.
    expect(within(rowOf("Sauna")).getByText("Stopped")).toBeInTheDocument();
    expect(await menuOf(user, "Sauna")).toEqual(["Start again", "Edit"]);
    // Upcoming: the day it starts; it can be stopped before then, and, never logged, deleted.
    expect(within(rowOf("Stretch")).getByText("Starts 5 Oct · Every day")).toBeInTheDocument();
    expect(await menuOf(user, "Stretch")).toEqual(["Edit", "Stop", "Move up", "Move down", "---", "Delete"]);
  });

  // A stopped habit sits below the running and upcoming ones and never moves.
  it("offers a stopped habit Start again and Edit, then Delete only when the client never logged it, and no move", async () => {
    const NEVER_LOGGED = habit({
      id: "h-meditation",
      name: "Meditation",
      status: "stopped",
      hasEntries: false,
      versions: [version({ id: "v-meditation", endsOn: "2026-09-20" })],
    });
    const user = renderDrawer({ ...LIST, habits: [...LIST.habits, NEVER_LOGGED] });

    expect(await menuOf(user, "Sauna")).toEqual(["Start again", "Edit"]);
    expect(await menuOf(user, "Meditation")).toEqual(["Start again", "Edit", "---", "Delete"]);
    expect(await itemOf(user, "Meditation", "Delete")).toHaveAttribute("data-variant", "destructive");
  });

  // Stop deletes nothing: a stopped habit starts again.
  it("marks Delete alone as destructive, Stop a plain item", async () => {
    const user = renderDrawer();
    await openMenu(user, "Walk");
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveAttribute("data-variant", "destructive");
    for (const item of ["Edit", "Stop", "Move up", "Move down"]) {
      expect(screen.getByRole("menuitem", { name: item })).toHaveAttribute("data-variant", "default");
    }
  });

});

describe("each row: the name and its ⋯, then one line under them", () => {
  // Every string a row shows, top to bottom: its name, line 2, then its how-to
  // when it has one.
  const linesOf = (name: string) => Array.from(rowOf(name).querySelectorAll("p"), (line) => line.textContent);

  it("says on line 2 a running habit's days then its target, one starting later its day first, a stopped one Stopped alone", () => {
    const STEPS = habit({
      id: "h-steps",
      name: "Steps",
      status: "upcoming",
      measure: "number",
      unit: "steps",
      direction: "at_least",
      versions: [version({ id: "v-steps", startsOn: "2026-10-12", target: 8000, weekdays: ["monday", "wednesday", "friday"] })],
      words: { schedule: "Mon, Wed, Fri", target: "at least 8,000 steps" },
    });
    renderDrawer({ ...LIST, habits: [...LIST.habits, STEPS] });

    // Running, a number: its days, then its target; its how-to on its own line.
    expect(linesOf("Water")).toEqual(["Water", "Mon, Wed, Fri · at least 3 L", "A glass with each meal"]);
    // Running, a tick: its days alone.
    expect(linesOf("Walk")).toEqual(["Walk", "Every day"]);
    // Starting later: the day it starts, then the same days and target.
    expect(linesOf("Stretch")).toEqual(["Stretch", "Starts 5 Oct · Every day"]);
    expect(linesOf("Steps")).toEqual(["Steps", "Starts 12 Oct · Mon, Wed, Fri · at least 8,000 steps"]);
    // Stopped: the word alone, its days (3 times a week) and its last day left out.
    expect(linesOf("Sauna")).toEqual(["Sauna", "Stopped"]);
  });

  it("gives a stopped habit with a how-to nothing under its name but Stopped", () => {
    const withHowTo = { ...SAUNA, howTo: "Twenty minutes after training" };
    renderDrawer({ ...LIST, habits: [WATER, withHowTo] });
    expect(linesOf("Sauna")).toEqual(["Sauna", "Stopped"]);
    expect(screen.queryByText("Twenty minutes after training")).toBeNull();
  });

  // One size and one colour under every name, whatever the habit's status:
  // the design system's secondary text, never the muted foreground.
  it("sets line 2 in one text style on every row, whatever the habit's status, and the how-to in it too", () => {
    renderDrawer();
    const style = ["text-xs", ...TEXT_SECONDARY.split(" ")];
    const lineTwo = [
      within(rowOf("Water")).getByText("Mon, Wed, Fri · at least 3 L"),
      within(rowOf("Walk")).getByText("Every day"),
      within(rowOf("Stretch")).getByText("Starts 5 Oct · Every day"),
      within(rowOf("Sauna")).getByText("Stopped"),
    ];
    for (const line of lineTwo) {
      expect(line, line.textContent ?? "").toHaveClass(...style);
      expect(line, line.textContent ?? "").not.toHaveClass("text-muted-foreground");
      expect(line.className, line.textContent ?? "").toBe(lineTwo[0].className);
    }
    // The how-to: the same style, on one line that ends in "…".
    const howTo = within(rowOf("Water")).getByText("A glass with each meal");
    expect(howTo).toHaveClass(...style, "line-clamp-1");
    expect(howTo).not.toHaveClass("text-muted-foreground");
  });

  // No "Stopped" or "Starts …" beside the name: where a habit stands is line 2's.
  it("puts nothing on line 1 but the name and its ⋯", () => {
    renderDrawer();
    for (const { name } of LIST.habits) {
      const lineOne = menuButton(name).parentElement as HTMLElement;
      expect(lineOne.children, name).toHaveLength(2);
      expect(lineOne.children[0], name).toBe(screen.getByText(name, { selector: "p" }));
      expect(lineOne.children[1], name).toBe(menuButton(name));
      expect(lineOne.textContent, name).toBe(name);
    }
  });
});

describe("the drawer's room", () => {
  // The drawer is the nutrition plan tray's 384px (components/side-tray-width.test.ts
  // pins it): line 1 holds the name and one ⋯, so the name takes the room left
  // of the ⋯, which sits at the far right.
  it("ends a name too long for its row in an ellipsis, the ⋯ beside it whole at the far right", () => {
    renderDrawer();
    const name = screen.getByText("Sauna", { selector: "p" });
    // A flex child shrinks below its text only with min-w-0; truncate then ends it in "…".
    expect(name.className).toMatch(/\btruncate\b/);
    expect(name.className).toMatch(/\bmin-w-0\b/);
    // It grows into the room, so the ⋯ after it sits at the row's far right.
    expect(name.className).toMatch(/\bflex-1\b/);
    expect(menuButton("Sauna").className).toMatch(/\bshrink-0\b/);
  });

  // A hover-revealed cluster kept its room while hidden, and that room came
  // out of the name's.
  it("keeps every row's ⋯ in sight, never waiting on a hover", () => {
    renderDrawer();
    for (const habit of LIST.habits) {
      const row = rowOf(habit.name);
      for (let node: HTMLElement | null = menuButton(habit.name); node && node !== row.parentElement; node = node.parentElement) {
        expect(node.className, habit.name).not.toMatch(/(^|\s)(opacity-0|invisible|hidden)(\s|$)/);
      }
    }
  });
});

describe("adding a habit", () => {
  // The frame test: the form stays open, busy, until the write answers; the
  // answer is landed and the form closed together, so no frame shows the list
  // without the habit just added.
  it("adds a tick habit for every day, then lands its answer and closes the form together", async () => {
    const write = deferred<{ habitIds: string[]; habits: CoachHabitList }>();
    writes.add.mockReturnValue(write.promise);
    const user = renderDrawer();

    await user.click(screen.getByRole("button", { name: "Add Habit" }));
    await user.type(screen.getByLabelText("Name"), "  Journal ");
    await user.type(screen.getByLabelText("How to (optional)"), "Three lines before bed");
    await user.click(screen.getByRole("button", { name: "Add Habit" }));

    expect(writes.add).toHaveBeenCalledWith([
      {
        name: "Journal",
        howTo: "Three lines before bed",
        measure: "tick",
        unit: null,
        direction: null,
        target: null,
        weekdays: [...EVERY_DAY],
      },
    ]);
    expect(screen.getByRole("button", { name: "Add Habit" })).toBeDisabled();
    expect(writes.land).not.toHaveBeenCalled();

    const JOURNAL = habit({ id: "h-journal", name: "Journal", hasEntries: false });
    const answer = { habitIds: ["h-journal"], habits: { ...LIST, habits: [...LIST.habits, JOURNAL] } };
    await act(async () => {
      write.resolve(answer);
      await write.promise;
    });
    expect(writes.land).toHaveBeenCalledWith(answer.habits);
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.getByText("Journal", { selector: "p" })).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('"Journal" added');
  });

  it("adds a number habit with its direction, target and unit", async () => {
    writes.add.mockResolvedValue({ habitIds: ["h-drinks"], habits: LIST });
    const user = renderDrawer();

    await user.click(screen.getByRole("button", { name: "Add Habit" }));
    await user.type(screen.getByLabelText("Name"), "Drinks");
    await user.click(screen.getByLabelText("Track a number"));
    await user.click(screen.getByRole("button", { name: "At most" }));
    await user.type(screen.getByLabelText("Target"), "2");
    await user.type(screen.getByLabelText("Unit"), "drinks");
    await user.click(screen.getByRole("button", { name: "Add Habit" }));

    await waitFor(() =>
      expect(writes.add).toHaveBeenCalledWith([
        {
          name: "Drinks",
          howTo: null,
          measure: "number",
          unit: "drinks",
          direction: "at_most",
          target: 2,
          weekdays: [...EVERY_DAY],
        },
      ])
    );
  });

  it("refuses a target that is not a number, with the reason, and sends nothing", async () => {
    const user = renderDrawer();
    await user.click(screen.getByRole("button", { name: "Add Habit" }));
    await user.type(screen.getByLabelText("Name"), "Water 2");
    await user.click(screen.getByLabelText("Track a number"));
    await user.type(screen.getByLabelText("Target"), "3.125");
    await user.click(screen.getByRole("button", { name: "Add Habit" }));

    expect(toast.error).toHaveBeenCalledWith("Could not add the habit", {
      description: "Enter a number, to two decimals at most",
    });
    expect(writes.add).not.toHaveBeenCalled();
  });

  it("keeps the form open with the server's reason when the add is refused", async () => {
    writes.add.mockRejectedValue(new HabitRequestError("A number habit needs a target.", 400));
    const user = renderDrawer();
    await user.click(screen.getByRole("button", { name: "Add Habit" }));
    await user.type(screen.getByLabelText("Name"), "Journal");
    await user.click(screen.getByRole("button", { name: "Add Habit" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Could not add the habit", { description: "A number habit needs a target." })
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Journal");
    expect(screen.getByRole("button", { name: "Add Habit" })).toBeEnabled();
    expect(writes.land).not.toHaveBeenCalled();
  });
});

describe("stopping and deleting", () => {
  // The frame test: the confirm holds its spinner until the write answers;
  // the answer is landed and the confirm closed together.
  it("stops a habit from today, then lands its answer and closes the confirm together", async () => {
    const write = deferred<{ changed: boolean; habits: CoachHabitList }>();
    writes.stop.mockReturnValue(write.promise);
    const user = renderDrawer();

    await choose(user, "Water", "Stop");
    expect(within(confirmDialog()).getByRole("heading").textContent).toBe("Stop Water?");
    expect(within(confirmDialog()).getByText("It stops from today. Its past stays.")).toBeInTheDocument();
    await user.click(within(confirmDialog()).getByRole("button", { name: "Stop habit" }));

    expect(writes.stop).toHaveBeenCalledWith("h-water");
    expect(within(confirmDialog()).getByRole("button", { name: "Stop habit" })).toBeDisabled();
    expect(within(confirmDialog()).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(writes.land).not.toHaveBeenCalled();

    const answer = { changed: true, habits: { ...LIST, habits: [{ ...WATER, status: "stopped" as const }, WALK, SAUNA, STRETCH] } };
    await act(async () => {
      write.resolve(answer);
      await write.promise;
    });
    expect(writes.land).toHaveBeenCalledWith(answer.habits);
    expect(screen.queryByRole("dialog", { name: /^Stop / })).toBeNull();
    expect(within(rowOf("Water")).getByText("Stopped")).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('"Water" stopped', { description: "Its past stays." });
  });

  // The frame test: the confirm holds its spinner until the delete answers;
  // the answer is landed and the confirm closed together.
  it("holds the delete's confirm busy until it answers, then lands the answer and closes it together", async () => {
    const write = deferred<{ changed: boolean; habits: CoachHabitList }>();
    writes.remove.mockReturnValue(write.promise);
    const user = renderDrawer();

    await choose(user, "Walk", "Delete");
    await user.click(within(confirmDialog()).getByRole("button", { name: "Delete habit" }));
    expect(within(confirmDialog()).getByRole("button", { name: "Delete habit" })).toBeDisabled();
    expect(within(confirmDialog()).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByText("Walk", { selector: "p" })).toBeInTheDocument();
    expect(writes.land).not.toHaveBeenCalled();

    await act(async () => {
      write.resolve({ changed: true, habits: { ...LIST, habits: [WATER, SAUNA, STRETCH] } });
      await write.promise;
    });
    expect(screen.queryByRole("dialog", { name: /^Delete / })).toBeNull();
    expect(screen.queryByText("Walk", { selector: "p" })).toBeNull();
  });

  it("deletes a habit the client never logged", async () => {
    writes.remove.mockResolvedValue({ changed: true, habits: { ...LIST, habits: [WATER, SAUNA, STRETCH] } });
    const user = renderDrawer();

    await choose(user, "Walk", "Delete");
    expect(within(confirmDialog()).getByText("Removes it and its schedule for good; the client never logged it.")).toBeInTheDocument();
    await user.click(within(confirmDialog()).getByRole("button", { name: "Delete habit" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /^Delete / })).toBeNull());
    expect(writes.remove).toHaveBeenCalledWith("h-walk");
    expect(screen.queryByText("Walk", { selector: "p" })).toBeNull();
    expect(toast.success).toHaveBeenCalledWith('"Walk" deleted');
  });

  it("a refused delete says why and leaves the confirm open", async () => {
    writes.remove.mockRejectedValue(new HabitRequestError("This habit has entries, so it can only be stopped.", 409));
    const user = renderDrawer();

    await choose(user, "Walk", "Delete");
    await user.click(within(confirmDialog()).getByRole("button", { name: "Delete habit" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Delete failed", {
        description: "This habit has entries, so it can only be stopped.",
      })
    );
    expect(within(confirmDialog()).getByRole("button", { name: "Delete habit" })).toBeEnabled();
    expect(writes.land).not.toHaveBeenCalled();
  });
});

describe("starting a stopped habit again", () => {
  it("starts it from today with its last target and days, and lands the answer", async () => {
    const restarted = { ...SAUNA, status: "running" as const };
    writes.change.mockResolvedValue({ changed: true, habits: { ...LIST, habits: [WATER, WALK, restarted, STRETCH] } });
    const user = renderDrawer();

    await choose(user, "Sauna", "Start again");

    await waitFor(() => expect(writes.land).toHaveBeenCalled());
    expect(writes.change).toHaveBeenCalledWith("h-sauna", { target: null, timesPerWeek: 3 });
    expect(within(rowOf("Sauna")).queryByText("Stopped")).toBeNull();
    expect(toast.success).toHaveBeenCalledWith('"Sauna" started again', { description: "It runs from today." });
  });

  // The frame test: the row stays stopped, its ⋯ a held spinner, until the
  // write answers; then the answer lands and the row reads running, its ⋯
  // back, in one frame.
  it("keeps the row as it was, its ⋯ spinning in its place and held, until starting again answers", async () => {
    const write = deferred<{ changed: boolean; habits: CoachHabitList }>();
    writes.change.mockReturnValue(write.promise);
    const user = renderDrawer();
    const icons = () => Array.from(menuButton("Sauna").querySelectorAll("svg"));

    await choose(user, "Sauna", "Start again");
    expect(menuButton("Sauna")).toBeDisabled();
    // The spinner in the ⋯'s place, never beside it.
    expect(icons()).toHaveLength(1);
    expect(icons()[0]).toHaveClass("animate-spin");
    expect(within(rowOf("Sauna")).getByText("Stopped")).toBeInTheDocument();
    expect(writes.land).not.toHaveBeenCalled();

    await act(async () => {
      write.resolve({ changed: true, habits: { ...LIST, habits: [WATER, WALK, { ...SAUNA, status: "running" as const }, STRETCH] } });
      await write.promise;
    });
    expect(within(rowOf("Sauna")).queryByText("Stopped")).toBeNull();
    expect(menuButton("Sauna")).toBeEnabled();
    expect(icons()).toHaveLength(1);
    expect(icons()[0]).not.toHaveClass("animate-spin");
    expect(await menuOf(user, "Sauna")).toEqual(["Edit", "Stop", "Move up", "Move down"]);
  });

  it("a set-days habit starts again on its days, a number habit with its target", async () => {
    const stoppedWater = { ...WATER, status: "stopped" as const };
    writes.land.mockImplementation(() => {});
    writes.change.mockResolvedValue({ changed: true, habits: LIST });
    render(
      <HabitsManageDrawer
        open
        onOpenChange={vi.fn()}
        list={{ ...LIST, habits: [stoppedWater] }}
        writes={writes as unknown as HabitWrites}
      />
    );
    await choose(userEvent.setup(), "Water", "Start again");

    await waitFor(() =>
      expect(writes.change).toHaveBeenCalledWith("h-water", { target: 3, weekdays: ["monday", "wednesday", "friday"] })
    );
  });

  it("starts again with the LAST version's target and days when the habit was changed before it stopped", async () => {
    const changedThenStopped = {
      ...WATER,
      status: "stopped" as const,
      versions: [
        version({ id: "v-first", startsOn: "2026-08-01", endsOn: "2026-08-31", target: 3, weekdays: ["monday", "wednesday", "friday"] }),
        version({ id: "v-last", startsOn: "2026-09-01", endsOn: "2026-09-20", target: 3.5 }),
      ],
    };
    writes.land.mockImplementation(() => {});
    writes.change.mockResolvedValue({ changed: true, habits: LIST });
    render(
      <HabitsManageDrawer open onOpenChange={vi.fn()} list={{ ...LIST, habits: [changedThenStopped] }} writes={writes as unknown as HabitWrites} />
    );
    await choose(userEvent.setup(), "Water", "Start again");

    await waitFor(() => expect(writes.change).toHaveBeenCalledWith("h-water", { target: 3.5, weekdays: [...EVERY_DAY] }));
  });

  it("says why when starting again is refused, lands nothing and offers the ⋯ again", async () => {
    writes.change.mockRejectedValue(new HabitRequestError("Habit not found.", 404));
    const user = renderDrawer();
    await choose(user, "Sauna", "Start again");

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Could not start the habit again", { description: "Habit not found." })
    );
    expect(writes.land).not.toHaveBeenCalled();
    await waitFor(() => expect(menuButton("Sauna")).toBeEnabled());
    expect(menuButton("Sauna").querySelector(".animate-spin")).toBeNull();
    expect(within(rowOf("Sauna")).getByText("Stopped")).toBeInTheDocument();
  });
});

// Stopped on its first day, a habit keeps no version: nothing to start again
// from but the habit itself.
describe("starting again a habit stopped on its first day", () => {
  const JOURNAL = habit({ id: "h-journal", name: "Journal", status: "stopped", versions: [], words: { schedule: null, target: null } });
  const WATER_NEW = habit({
    id: "h-water-new",
    name: "Water",
    measure: "number",
    unit: "L",
    direction: "at_least",
    status: "stopped",
    versions: [],
    words: { schedule: null, target: null },
  });
  const running = (stopped: CoachHabit, target: number | null) =>
    ({ ...stopped, status: "running", versions: [version({ startsOn: TODAY, target })] }) as CoachHabit;

  it("starts a tick habit again every day", async () => {
    writes.change.mockResolvedValue({ changed: true, habits: { ...LIST, habits: [running(JOURNAL, null)] } });
    const user = renderDrawer({ ...LIST, habits: [JOURNAL] });

    await choose(user, "Journal", "Start again");

    await waitFor(() => expect(writes.land).toHaveBeenCalled());
    expect(writes.change).toHaveBeenCalledWith("h-journal", { target: null, weekdays: [...EVERY_DAY] });
    expect(within(rowOf("Journal")).queryByText("Stopped")).toBeNull();
    expect(toast.success).toHaveBeenCalledWith('"Journal" started again', { description: "It runs from today." });
  });

  // The frame test: the click opens the form, and nothing is sent; the save
  // holds the form busy until the write answers, then lands the answer and
  // closes the form together.
  it("asks for a number habit's target, its box empty and required, then starts it again every day with it", async () => {
    const write = deferred<{ changed: boolean; habits: CoachHabitList }>();
    writes.change.mockReturnValue(write.promise);
    const user = renderDrawer({ ...LIST, habits: [WATER_NEW] });

    await choose(user, "Water", "Start again");
    expect(writes.change).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Habit name")).toHaveValue("Water");
    expect(screen.getByLabelText("Target")).toHaveValue("");
    expect(screen.getByLabelText("Target")).toBeRequired();

    await user.type(screen.getByLabelText("Target"), "3");
    await user.click(screen.getByRole("button", { name: "Save habit" }));
    expect(writes.change).toHaveBeenCalledWith("h-water-new", { target: 3, weekdays: [...EVERY_DAY] });
    expect(writes.rename).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Target")).toBeDisabled();
    expect(writes.land).not.toHaveBeenCalled();

    const answer = { ...LIST, habits: [running(WATER_NEW, 3)] };
    await act(async () => {
      write.resolve({ changed: true, habits: answer });
      await write.promise;
    });
    expect(writes.land).toHaveBeenCalledWith(answer);
    expect(screen.queryByLabelText("Target")).toBeNull();
    expect(within(rowOf("Water")).queryByText("Stopped")).toBeNull();
    expect(toast.success).toHaveBeenCalledWith('"Water" started again', { description: "It runs from today." });
  });

  it("will not start a number habit again without a target, and sends nothing", async () => {
    const user = renderDrawer({ ...LIST, habits: [WATER_NEW] });
    await choose(user, "Water", "Start again");
    await user.click(screen.getByRole("button", { name: "Save habit" }));

    expect(toast.error).toHaveBeenCalledWith("Could not start the habit again", { description: "Enter a number" });
    expect(writes.change).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Target")).toBeEnabled();
  });

  it("writes a new name in the same save that starts it again", async () => {
    writes.rename.mockResolvedValue({ changed: true, habits: LIST });
    writes.change.mockResolvedValue({ changed: true, habits: LIST });
    const user = renderDrawer({ ...LIST, habits: [WATER_NEW] });
    await choose(user, "Water", "Start again");

    await user.clear(screen.getByLabelText("Habit name"));
    await user.type(screen.getByLabelText("Habit name"), "Water intake");
    await user.type(screen.getByLabelText("Target"), "2.5");
    await user.click(screen.getByRole("button", { name: "Save habit" }));

    await waitFor(() => expect(writes.land).toHaveBeenCalledTimes(1));
    expect(writes.rename).toHaveBeenCalledWith("h-water-new", "Water intake", null);
    expect(writes.change).toHaveBeenCalledWith("h-water-new", { target: 2.5, weekdays: [...EVERY_DAY] });
    expect(toast.success).toHaveBeenCalledWith('"Water intake" started again', { description: "It runs from today." });
  });

  it("says the name is saved and the habit did not start again when the second write fails", async () => {
    const renamed = { ...LIST, habits: [{ ...WATER_NEW, name: "Water intake" }] };
    writes.rename.mockResolvedValue({ changed: true, habits: renamed });
    writes.change.mockRejectedValue(new HabitRequestError("Something went wrong. Try again.", 500));
    const user = renderDrawer({ ...LIST, habits: [WATER_NEW] });
    await choose(user, "Water", "Start again");

    await user.clear(screen.getByLabelText("Habit name"));
    await user.type(screen.getByLabelText("Habit name"), "Water intake");
    await user.type(screen.getByLabelText("Target"), "2.5");
    await user.click(screen.getByRole("button", { name: "Save habit" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Partly saved", {
        description: "The name is saved. It did not start again: Something went wrong. Try again.",
      })
    );
    expect(writes.land).toHaveBeenCalledWith(renamed);
    // Still open to try again, its target as typed.
    expect(screen.getByLabelText("Target")).toBeEnabled();
    expect(screen.getByLabelText("Target")).toHaveValue("2.5");
  });

  it("edits only the labels from Edit: no target is asked", async () => {
    const user = renderDrawer({ ...LIST, habits: [WATER_NEW] });
    await choose(user, "Water", "Edit");
    expect(screen.getByLabelText("Habit name")).toHaveValue("Water");
    expect(screen.queryByLabelText("Target")).toBeNull();
  });
});

describe("the order of the rows", () => {
  it("lists the running and starting-later habits first, the stopped after them, each in the client's order, nothing between", () => {
    const MEDITATION = habit({
      id: "h-meditation",
      name: "Meditation",
      status: "stopped",
      versions: [version({ id: "v-meditation", endsOn: "2026-09-20" })],
    });
    // The client's order: Sauna (stopped), Stretch (starts later), Water, Meditation (stopped), Walk.
    renderDrawer({ ...LIST, habits: [SAUNA, STRETCH, WATER, MEDITATION, WALK] });

    const rows = Array.from((rowOf("Water").parentElement as HTMLElement).children);
    // Every child a row: no heading or divider over the stopped ones.
    expect(rows.every((row) => row.matches("div.group"))).toBe(true);
    expect(rows.map((row) => row.querySelector("p")?.textContent)).toEqual(["Stretch", "Water", "Walk", "Sauna", "Meditation"]);
  });
});

describe("moving a habit", () => {
  it("sends the client's whole list in its new order, even when a search shows some", async () => {
    writes.order.mockResolvedValue({ changed: true, habits: LIST });
    const user = renderDrawer();

    // "a" shows Water, Walk and Sauna; Stretch is hidden.
    fireEvent.change(screen.getByPlaceholderText("Search habits"), { target: { value: "a" } });
    expect(screen.queryByText("Stretch", { selector: "p" })).toBeNull();
    await choose(user, "Walk", "Move up");

    await waitFor(() => expect(writes.land).toHaveBeenCalledWith(LIST));
    expect(writes.order).toHaveBeenCalledWith(["h-walk", "h-water", "h-sauna", "h-stretch"]);
  });

  // A move is among the running and starting-later habits alone: shown last,
  // stopped Sauna is never the neighbour a habit swaps with, and it keeps its
  // slot in the client's order.
  it("swaps a habit with its running neighbour, never a stopped habit, which keeps its slot in the order sent", async () => {
    writes.order.mockResolvedValue({ changed: true, habits: LIST });
    const user = renderDrawer();

    // The client's order: Water, Walk, Sauna (stopped), Stretch. On screen: Water, Walk, Stretch, Sauna.
    await choose(user, "Stretch", "Move up");

    await waitFor(() => expect(writes.land).toHaveBeenCalledWith(LIST));
    expect(writes.order).toHaveBeenCalledWith(["h-water", "h-stretch", "h-sauna", "h-walk"]);
  });

  it("offers the first running habit no Move up and the last no Move down, a stopped habit before or after them in the client's order", async () => {
    const MEDITATION = habit({
      id: "h-meditation",
      name: "Meditation",
      status: "stopped",
      versions: [version({ id: "v-meditation", endsOn: "2026-09-20" })],
    });
    // The client's order: Sauna (stopped), Water, Walk, Meditation (stopped).
    const user = renderDrawer({ ...LIST, habits: [SAUNA, WATER, WALK, MEDITATION] });

    expect(await itemOf(user, "Water", "Move up")).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("menuitem", { name: "Move up" }));
    expect(writes.order).not.toHaveBeenCalled();
    await closeMenu(user);
    expect(await itemOf(user, "Walk", "Move down")).toHaveAttribute("aria-disabled", "true");
    await closeMenu(user);
    expect(await itemOf(user, "Water", "Move down")).not.toHaveAttribute("aria-disabled");
    await closeMenu(user);
    expect(await itemOf(user, "Walk", "Move up")).not.toHaveAttribute("aria-disabled");
  });

  // The frame test: every move waits while one is in flight, the list as it
  // was; the answer lands in one frame with the moves offered again.
  it("holds every move while one is in flight, then shows the new order", async () => {
    const write = deferred<{ changed: boolean; habits: CoachHabitList }>();
    writes.order.mockReturnValue(write.promise);
    const user = renderDrawer();
    const names = () => screen.getAllByText(/^(Water|Walk|Sauna|Stretch)$/, { selector: "p" }).map((node) => node.textContent);

    await choose(user, "Walk", "Move up");
    expect(await itemOf(user, "Stretch", "Move up")).toHaveAttribute("aria-disabled", "true");
    await closeMenu(user);
    expect(await itemOf(user, "Water", "Move down")).toHaveAttribute("aria-disabled", "true");
    await closeMenu(user);
    expect(names()).toEqual(["Water", "Walk", "Stretch", "Sauna"]);
    expect(writes.land).not.toHaveBeenCalled();

    await act(async () => {
      write.resolve({ changed: true, habits: { ...LIST, habits: [WALK, WATER, SAUNA, STRETCH] } });
      await write.promise;
    });
    expect(names()).toEqual(["Walk", "Water", "Stretch", "Sauna"]);
    expect(await itemOf(user, "Stretch", "Move up")).not.toHaveAttribute("aria-disabled");
  });

  it("offers no move past either end of the running and starting-later habits shown, and a greyed move sends nothing", async () => {
    const user = renderDrawer();
    expect(await itemOf(user, "Water", "Move up")).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("menuitem", { name: "Move up" }));
    expect(writes.order).not.toHaveBeenCalled();
    await closeMenu(user);
    // Stretch ends them; stopped Sauna is shown after it.
    expect(await itemOf(user, "Stretch", "Move down")).toHaveAttribute("aria-disabled", "true");
    await closeMenu(user);
    expect(await itemOf(user, "Walk", "Move up")).not.toHaveAttribute("aria-disabled");
    await closeMenu(user);
    expect(await itemOf(user, "Walk", "Move down")).not.toHaveAttribute("aria-disabled");
    await closeMenu(user);

    // "a" shows Water, Walk and Sauna: Walk ends the running habits shown.
    fireEvent.change(screen.getByPlaceholderText("Search habits"), { target: { value: "a" } });
    expect(await itemOf(user, "Walk", "Move down")).toHaveAttribute("aria-disabled", "true");
  });

  it("says why when a move is refused, and lands nothing", async () => {
    writes.order.mockRejectedValue(new HabitRequestError("The order must name every one of the client's habits.", 400));
    const user = renderDrawer();
    await choose(user, "Walk", "Move up");

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Could not reorder the habits", {
        description: "The order must name every one of the client's habits.",
      })
    );
    expect(writes.land).not.toHaveBeenCalled();
  });
});

describe("editing a habit", () => {
  const openEdit = (user: User, name: string) => choose(user, name, "Edit");

  it("writes the labels alone when only they changed, then lands the answer and closes", async () => {
    const renamed = { ...WATER, name: "Water intake" };
    writes.rename.mockResolvedValue({ changed: true, habits: { ...LIST, habits: [renamed, WALK, SAUNA, STRETCH] } });
    const user = renderDrawer();
    await openEdit(user, "Water");

    expect(screen.getByLabelText("Target")).toHaveValue("3");
    await user.clear(screen.getByLabelText("Habit name"));
    await user.type(screen.getByLabelText("Habit name"), "Water intake");
    await user.click(screen.getByRole("button", { name: "Save habit" }));

    await waitFor(() => expect(screen.queryByLabelText("Habit name")).toBeNull());
    expect(writes.rename).toHaveBeenCalledWith("h-water", "Water intake", "A glass with each meal");
    expect(writes.change).not.toHaveBeenCalled();
    expect(writes.land).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Water intake", { selector: "p" })).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('"Water intake" updated', undefined);
  });

  // The frame test: the form stays open and busy until the write answers; the
  // answer is landed and the form closed together, so no frame shows the old name.
  it("keeps the form open and busy until the rename answers, then lands it and closes together", async () => {
    const write = deferred<{ changed: boolean; habits: CoachHabitList }>();
    writes.rename.mockReturnValue(write.promise);
    const user = renderDrawer();
    await openEdit(user, "Walk");

    await user.clear(screen.getByLabelText("Habit name"));
    await user.type(screen.getByLabelText("Habit name"), "Evening walk");
    await user.click(screen.getByRole("button", { name: "Save habit" }));
    expect(screen.getByLabelText("Habit name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save habit" })).toBeDisabled();
    expect(writes.land).not.toHaveBeenCalled();

    await act(async () => {
      write.resolve({ changed: true, habits: { ...LIST, habits: [WATER, { ...WALK, name: "Evening walk" }, SAUNA, STRETCH] } });
      await write.promise;
    });
    expect(screen.queryByLabelText("Habit name")).toBeNull();
    expect(screen.getByText("Evening walk", { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByText("Walk", { selector: "p" })).toBeNull();
  });

  it("changes the target alone from today, keeping the habit's days", async () => {
    writes.change.mockResolvedValue({ changed: true, habits: LIST });
    const user = renderDrawer();
    await openEdit(user, "Water");

    await user.clear(screen.getByLabelText("Target"));
    await user.type(screen.getByLabelText("Target"), "3.5");
    await user.click(screen.getByRole("button", { name: "Save habit" }));

    await waitFor(() => expect(writes.land).toHaveBeenCalledWith(LIST));
    expect(writes.rename).not.toHaveBeenCalled();
    expect(writes.change).toHaveBeenCalledWith("h-water", { target: 3.5, weekdays: ["monday", "wednesday", "friday"] });
    expect(toast.success).toHaveBeenCalledWith('"Water" updated', { description: "The new target runs from today." });
  });

  it("writes nothing for a form left as it was", async () => {
    const user = renderDrawer();
    await openEdit(user, "Water");
    await user.click(screen.getByRole("button", { name: "Save habit" }));

    expect(screen.queryByLabelText("Habit name")).toBeNull();
    expect(writes.rename).not.toHaveBeenCalled();
    expect(writes.change).not.toHaveBeenCalled();
    expect(writes.land).not.toHaveBeenCalled();
  });

  // The number decides: "3.0" over a target of 3 is the same target.
  it("writes nothing for a target retyped as the same number", async () => {
    const user = renderDrawer();
    await openEdit(user, "Water");
    await user.clear(screen.getByLabelText("Target"));
    await user.type(screen.getByLabelText("Target"), "3.0");
    await user.click(screen.getByRole("button", { name: "Save habit" }));

    expect(screen.queryByLabelText("Habit name")).toBeNull();
    expect(writes.change).not.toHaveBeenCalled();
    expect(writes.rename).not.toHaveBeenCalled();
    expect(writes.land).not.toHaveBeenCalled();
  });

  it("offers no target on a tick habit", async () => {
    const user = renderDrawer();
    await openEdit(user, "Walk");
    expect(screen.getByLabelText("Habit name")).toHaveValue("Walk");
    expect(screen.queryByLabelText("Target")).toBeNull();
  });

  it("says the name is saved when the target's change fails after it, landing what saved and staying open", async () => {
    const renamed = { ...WATER, name: "Water intake" };
    const renamedList = { ...LIST, habits: [renamed, WALK, SAUNA, STRETCH] };
    writes.rename.mockResolvedValue({ changed: true, habits: renamedList });
    writes.change.mockRejectedValue(new HabitRequestError("Enter a target.", 400));
    const user = renderDrawer();
    await openEdit(user, "Water");

    await user.clear(screen.getByLabelText("Habit name"));
    await user.type(screen.getByLabelText("Habit name"), "Water intake");
    await user.clear(screen.getByLabelText("Target"));
    await user.type(screen.getByLabelText("Target"), "4");
    await user.click(screen.getByRole("button", { name: "Save habit" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Partly saved", {
        description: "The name is saved. The target is not: Enter a target.",
      })
    );
    expect(writes.land).toHaveBeenCalledWith(renamedList);
    expect(screen.getByLabelText("Habit name")).toBeEnabled();
  });

  // "Partly saved" names what saved: the name, the how-to, or both.
  it("says the how-to is saved, or both labels, when those were what saved before the target's change failed", async () => {
    writes.rename.mockResolvedValue({ changed: true, habits: LIST });
    writes.change.mockRejectedValue(new HabitRequestError("Enter a target.", 400));
    const user = renderDrawer();
    await openEdit(user, "Water");

    await user.clear(screen.getByLabelText("How to"));
    await user.type(screen.getByLabelText("How to"), "Two glasses with each meal");
    await user.clear(screen.getByLabelText("Target"));
    await user.type(screen.getByLabelText("Target"), "4");
    await user.click(screen.getByRole("button", { name: "Save habit" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenLastCalledWith("Partly saved", {
        description: "The how-to is saved. The target is not: Enter a target.",
      })
    );

    await user.clear(screen.getByLabelText("Habit name"));
    await user.type(screen.getByLabelText("Habit name"), "Water intake");
    await user.click(screen.getByRole("button", { name: "Save habit" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenLastCalledWith("Partly saved", {
        description: "The name and how-to are saved. The target is not: Enter a target.",
      })
    );
  });

  it("refuses an empty name with the reason, and sends nothing", async () => {
    const user = renderDrawer();
    await openEdit(user, "Walk");
    await user.clear(screen.getByLabelText("Habit name"));
    await user.click(screen.getByRole("button", { name: "Save habit" }));

    expect(toast.error).toHaveBeenCalledWith("Could not save the habit", { description: "Enter a name" });
    expect(writes.rename).not.toHaveBeenCalled();
  });
});

/**
 * A write saved but its habits not read back answers with no list. Every
 * surface lands that answer — `land` refetches the list in place — and closes
 * on the success it is, with the same words, never an error.
 */
describe("a write saved without its habits read back", () => {
  it("adds: lands it, closes the form and says added", async () => {
    writes.add.mockResolvedValue({ habitIds: ["h-journal"], habits: null });
    const user = renderDrawer();
    await user.click(screen.getByRole("button", { name: "Add Habit" }));
    await user.type(screen.getByLabelText("Name"), "Journal");
    await user.click(screen.getByRole("button", { name: "Add Habit" }));

    await waitFor(() => expect(writes.land).toHaveBeenCalledWith(null));
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(toast.success).toHaveBeenCalledWith('"Journal" added');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("stops: lands it, closes the confirm and says stopped", async () => {
    writes.stop.mockResolvedValue({ changed: true, habits: null });
    const user = renderDrawer();
    await choose(user, "Water", "Stop");
    await user.click(within(confirmDialog()).getByRole("button", { name: "Stop habit" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /^Stop / })).toBeNull());
    expect(writes.land).toHaveBeenCalledWith(null);
    expect(toast.success).toHaveBeenCalledWith('"Water" stopped', { description: "Its past stays." });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("deletes: lands it, closes the confirm and says deleted", async () => {
    writes.remove.mockResolvedValue({ changed: true, habits: null });
    const user = renderDrawer();
    await choose(user, "Walk", "Delete");
    await user.click(within(confirmDialog()).getByRole("button", { name: "Delete habit" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /^Delete / })).toBeNull());
    expect(writes.land).toHaveBeenCalledWith(null);
    expect(toast.success).toHaveBeenCalledWith('"Walk" deleted');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("starts again: lands it and says started again", async () => {
    writes.change.mockResolvedValue({ changed: true, habits: null });
    const user = renderDrawer();
    await choose(user, "Sauna", "Start again");

    await waitFor(() => expect(writes.land).toHaveBeenCalledWith(null));
    expect(toast.success).toHaveBeenCalledWith('"Sauna" started again', { description: "It runs from today." });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("moves: lands it and offers the moves again", async () => {
    writes.order.mockResolvedValue({ changed: true, habits: null });
    const user = renderDrawer();
    await choose(user, "Walk", "Move up");

    await waitFor(() => expect(writes.land).toHaveBeenCalledWith(null));
    expect(await itemOf(user, "Stretch", "Move up")).not.toHaveAttribute("aria-disabled");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("renames: lands it, closes the form and says updated", async () => {
    writes.rename.mockResolvedValue({ changed: true, habits: null });
    const user = renderDrawer();
    await choose(user, "Walk", "Edit");
    await user.clear(screen.getByLabelText("Habit name"));
    await user.type(screen.getByLabelText("Habit name"), "Evening walk");
    await user.click(screen.getByRole("button", { name: "Save habit" }));

    await waitFor(() => expect(screen.queryByLabelText("Habit name")).toBeNull());
    expect(writes.land).toHaveBeenCalledTimes(1);
    expect(writes.land).toHaveBeenCalledWith(null);
    expect(toast.success).toHaveBeenCalledWith('"Evening walk" updated', undefined);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("renames and changes the target: lands the last answer once, closes the form and says updated", async () => {
    writes.rename.mockResolvedValue({ changed: true, habits: null });
    writes.change.mockResolvedValue({ changed: true, habits: null });
    const user = renderDrawer();
    await choose(user, "Water", "Edit");
    await user.clear(screen.getByLabelText("Habit name"));
    await user.type(screen.getByLabelText("Habit name"), "Water intake");
    await user.clear(screen.getByLabelText("Target"));
    await user.type(screen.getByLabelText("Target"), "3.5");
    await user.click(screen.getByRole("button", { name: "Save habit" }));

    await waitFor(() => expect(screen.queryByLabelText("Habit name")).toBeNull());
    expect(writes.land).toHaveBeenCalledTimes(1);
    expect(writes.land).toHaveBeenCalledWith(null);
    expect(toast.success).toHaveBeenCalledWith('"Water intake" updated', { description: "The new target runs from today." });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("a rename saved with no list, its target's change then refused, is still partly saved", async () => {
    writes.rename.mockResolvedValue({ changed: true, habits: null });
    writes.change.mockRejectedValue(new HabitRequestError("Enter a target.", 400));
    const user = renderDrawer();
    await choose(user, "Water", "Edit");
    await user.clear(screen.getByLabelText("Habit name"));
    await user.type(screen.getByLabelText("Habit name"), "Water intake");
    await user.clear(screen.getByLabelText("Target"));
    await user.type(screen.getByLabelText("Target"), "4");
    await user.click(screen.getByRole("button", { name: "Save habit" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Partly saved", {
        description: "The name is saved. The target is not: Enter a target.",
      })
    );
    expect(writes.land).toHaveBeenCalledWith(null);
    expect(screen.getByLabelText("Habit name")).toBeEnabled();
  });
});
