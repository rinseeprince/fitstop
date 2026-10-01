import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { use } from "react";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import HabitsPage from "./page";
import type { ClientHabitDay, ClientHabitDayItem, HabitDayFacts, HabitIdentity } from "@/types/habits";

let mockSearchParam: string | null = null;
// While set, reading the address suspends, as it does while a statically
// prerendered page waits for its search params.
let mockAddressPending = false;
const pendingAddress = new Promise<never>(() => {});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => {
    if (mockAddressPending) use(pendingAddress);
    return { get: (key: string) => (key === "date" ? mockSearchParam : null) };
  },
}));

// The day-rule boundary the page locks on, and the client's timezone, which
// decides their today. Read at render time, so a test can set them per case.
// logsOpenFrom null = no lower bound (a client with no check-in schedule).
let mockLogsOpenFrom: string | null = null;
let mockTimezone = "UTC";
vi.mock("@/hooks/use-client-profile", () => ({
  useClientProfile: () => ({
    client: { timezone: mockTimezone, logsOpenFrom: mockLogsOpenFrom },
    error: null,
    isLoading: false,
    mutate: vi.fn(),
  }),
}));

// The day and its entries: the page renders what the hook holds and hands
// each change to it. The hook's own rules run over a real cache in
// hooks/use-client-portal-habits.writes.test.tsx.
const { entries } = vi.hoisted(() => ({
  entries: { day: null as unknown, error: undefined as unknown, retry: vi.fn(), retrying: false, save: vi.fn(), clear: vi.fn() },
}));
vi.mock("@/hooks/use-client-portal-habits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-client-portal-habits")>()),
  useClientHabitDayEntries: () => entries,
}));

const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import { HabitEntryError } from "@/hooks/use-client-portal-habits";

// The plan's Tuesday (docs/HABITS-REBUILD-PLAN.md §2.5), in a client week
// running Thursday 24 to Wednesday 30 September.
const TODAY = "2026-09-29";
const WEEK = { start: "2026-09-24", end: "2026-09-30" };
const PAST = "2020-01-01";

function item(
  habit: Partial<HabitIdentity> & { id: string },
  day: Partial<HabitDayFacts> = {},
  words: Partial<ClientHabitDayItem["words"]> = {},
  week: { start: string; end: string } = WEEK
): ClientHabitDayItem {
  const number = habit.measure === "number";
  return {
    habit: {
      name: habit.id,
      howTo: null,
      measure: "tick",
      unit: number ? "L" : null,
      direction: number ? "at_least" : null,
      ...habit,
    },
    day: {
      date: TODAY,
      covered: true,
      planned: true,
      target: number ? 3 : null,
      edited: false,
      versionId: `${habit.id}-v`,
      timesPerWeek: null,
      entry: null,
      met: false,
      ...day,
    },
    week: { planned: 7, done: 2, met: 2, ...week },
    words: { schedule: "Every day", target: number ? "at least 3 L" : null, week: "2 of 7", ...words },
  };
}

const water = item(
  { id: "Water", measure: "number" },
  { entry: { done: null, value: 3, note: null }, met: true },
  { week: "4 of 7" }
);
const sauna = item({ id: "Sauna" }, { planned: false, timesPerWeek: 3 }, { schedule: "3 times a week", week: "2 of 3" });
const mobility = item(
  { id: "Mobility" },
  { planned: false, entry: { done: true, value: null, note: null }, met: true },
  { schedule: "Mon, Wed, Fri", week: "2 of 3" }
);

function setDay(habits: ClientHabitDayItem[]) {
  entries.day = { date: TODAY, habits } satisfies ClientHabitDay;
}

/** The row holding a habit's name: its control, its words, its week and its note. */
const row = (name: string) => screen.getByText(name, { selector: "label" }).closest(".py-3") as HTMLElement;

describe("Habits page", () => {
  beforeEach(() => {
    // Only the clock is fixed: the client's today is the plan's Tuesday, in UTC.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T10:00:00Z"));
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    entries.save.mockReset().mockResolvedValue(undefined);
    entries.clear.mockReset().mockResolvedValue(undefined);
    entries.retry.mockReset();
    entries.retrying = false;
    entries.error = undefined;
    mockSearchParam = TODAY;
    mockAddressPending = false;
    mockLogsOpenFrom = null;
    mockTimezone = "UTC";
    setDay([]);
    cleanup();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("the day's habits", () => {
    it("names the page and its day", () => {
      setDay([water]);
      render(<HabitsPage />);

      expect(screen.getByRole("heading", { level: 1, name: "Habits" })).toBeInTheDocument();
      expect(screen.getByText(/^Tue 29 Sept?$/)).toBeInTheDocument();
    });

    it("shows three groups in order — planned today, any day this week, not planned today — each in the coach's order", () => {
      const stretch = item({ id: "Stretch" });
      setDay([mobility, water, sauna, stretch]);
      render(<HabitsPage />);

      const sections = screen.getAllByRole("region");
      expect(sections.map((section) => section.getAttribute("aria-label"))).toEqual([
        "Planned today",
        "Any day this week",
        "Not planned today",
      ]);
      const names = (section: HTMLElement) => within(section).getAllByText(/.+/, { selector: "label" }).map((label) => label.textContent);
      expect(names(sections[0])).toEqual(["Water", "Stretch"]);
      expect(names(sections[1])).toEqual(["Sauna"]);
      expect(names(sections[2])).toEqual(["Mobility"]);
    });

    it("says no 'today' on another day, whose date the page names, and 'that week' of a week that does not hold today", () => {
      const lastYear = { start: "2019-12-26", end: "2020-01-01" };
      mockSearchParam = PAST;
      setDay([
        item({ id: "Water", measure: "number" }, { date: PAST }, { week: "4 of 7" }, lastYear),
        item({ id: "Sauna" }, { date: PAST, planned: false, timesPerWeek: 3 }, { week: "2 of 3" }, lastYear),
        item({ id: "Mobility" }, { date: PAST, planned: false }, { schedule: "Mon, Wed, Fri" }, lastYear),
      ]);
      render(<HabitsPage />);

      expect(screen.getAllByRole("region").map((section) => section.getAttribute("aria-label"))).toEqual([
        "Planned",
        "Any day that week",
        "Not planned",
      ]);
      expect(within(row("Water")).getByText("4 of 7 that week")).toBeInTheDocument();
      expect(within(row("Sauna")).getByText("2 of 3 that week")).toBeInTheDocument();
    });

    it("says 'this week' on another day of the week that holds today, and no 'today'", () => {
      mockSearchParam = "2026-09-25";
      setDay([item({ id: "Water", measure: "number" }, { date: "2026-09-25" }, { week: "4 of 7" })]);
      render(<HabitsPage />);

      expect(screen.getAllByRole("region").map((section) => section.getAttribute("aria-label"))).toEqual(["Planned"]);
      expect(within(row("Water")).getByText("4 of 7 this week")).toBeInTheDocument();
    });

    it("judges 'today' on the client's calendar, not the device's", () => {
      // 20:00 on Wednesday 30 September in UTC is already Thursday 1 October
      // in Makassar, the first day of the client's next week.
      vi.setSystemTime(new Date("2026-09-30T20:00:00Z"));
      mockTimezone = "Asia/Makassar";
      mockSearchParam = "2026-10-01";
      const nextWeek = { start: "2026-10-01", end: "2026-10-07" };
      setDay([item({ id: "Stretch" }, { date: "2026-10-01" }, { week: "0 of 7" }, nextWeek)]);
      render(<HabitsPage />);

      expect(screen.getAllByRole("region").map((section) => section.getAttribute("aria-label"))).toEqual(["Planned today"]);
      expect(within(row("Stretch")).getByText("0 of 7 this week")).toBeInTheDocument();
      // Today on their calendar, so open: the device's would call it tomorrow and lock it.
      expect(screen.getByRole("checkbox", { name: "Stretch" })).not.toBeDisabled();
      expect(screen.queryByText("This day is locked.")).toBeNull();
    });

    it("gives each habit its entry, its words and its week: a tick box, or a number box with the coach's unit and the day's target", () => {
      setDay([water, sauna, mobility]);
      render(<HabitsPage />);

      // Water: a number box holding the day's number, the unit as the coach typed it, the target that day.
      expect(within(row("Water")).getByRole("textbox", { name: "Water" })).toHaveValue("3");
      expect(within(row("Water")).getByText("L")).toBeInTheDocument();
      expect(within(row("Water")).getByText("at least 3 L")).toBeInTheDocument();
      expect(within(row("Water")).getByText("4 of 7 this week")).toBeInTheDocument();
      // Sauna: a tick box, no words of its own — its group and its figure say it.
      expect(within(row("Sauna")).getByRole("checkbox", { name: "Sauna" })).not.toBeChecked();
      expect(within(row("Sauna")).queryByText("3 times a week")).toBeNull();
      expect(within(row("Sauna")).getByText("2 of 3 this week")).toBeInTheDocument();
      // Mobility, made up on a day it is not planned: ticked, with the days it is.
      expect(within(row("Mobility")).getByRole("checkbox", { name: "Mobility" })).toBeChecked();
      expect(within(row("Mobility")).getByText("Mon, Wed, Fri")).toBeInTheDocument();
      expect(within(row("Mobility")).getByText("2 of 3 this week")).toBeInTheDocument();
    });

    it("shows the coach's how-to under the habit's name, and nothing where there is none", () => {
      const stretch = item({ id: "Stretch", howTo: "Ten minutes, hips and hamstrings" });
      setDay([stretch, sauna]);
      render(<HabitsPage />);

      expect(within(row("Stretch")).getByText("Ten minutes, hips and hamstrings")).toBeInTheDocument();
      expect(row("Sauna").querySelectorAll("p")).toHaveLength(0);
    });

    it("marks a number habit done once its number meets the day's target, and not before", () => {
      const short = item({ id: "Steps", measure: "number" }, { entry: { done: null, value: 2, note: null }, met: false });
      setDay([water, short]);
      render(<HabitsPage />);

      expect(within(row("Water")).getByLabelText("Done")).toBeInTheDocument();
      expect(within(row("Steps")).queryByLabelText("Done")).toBeNull();
    });

    it("renders the empty state when no habit runs on the day", () => {
      setDay([]);
      render(<HabitsPage />);
      expect(screen.getByText("No habits on this day")).toBeInTheDocument();
    });

    it("names the page while the address is still being read, the day and the groups held in place below", () => {
      mockAddressPending = true;
      setDay([water]);
      const { container } = render(<HabitsPage />);
      expect(screen.getByRole("heading", { level: 1, name: "Habits" })).toBeInTheDocument();
      expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
      expect(screen.queryByText("Water", { selector: "label" })).toBeNull();
    });

    it("names the page and its lock at once, and holds the groups' place while the day loads, with no empty state", () => {
      entries.day = null;
      mockSearchParam = PAST;
      mockLogsOpenFrom = "2026-01-01";
      const { container } = render(<HabitsPage />);
      expect(screen.getByRole("heading", { level: 1, name: "Habits" })).toBeInTheDocument();
      expect(screen.getByText("This day is locked.")).toBeInTheDocument();
      expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
      expect(screen.queryByText("No habits on this day")).toBeNull();
    });

    it("shows an error state with a Try again button that reads the day again", async () => {
      entries.error = new Error("boom");
      entries.day = null;
      render(<HabitsPage />);
      expect(screen.getByRole("heading", { level: 1, name: "Habits" })).toBeInTheDocument();
      expect(screen.getByText(/couldn.t load your habits/i)).toBeInTheDocument();
      expect(screen.queryByText("No habits on this day")).toBeNull();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /try again/i }));
      expect(entries.retry).toHaveBeenCalled();
    });

    it("holds Try again with a spinner while the read it asked for is out", () => {
      entries.error = new Error("boom");
      entries.day = null;
      entries.retrying = true;
      render(<HabitsPage />);
      const button = screen.getByRole("button", { name: /try again/i });
      expect(button).toBeDisabled();
      expect(button.querySelector(".animate-spin")).not.toBeNull();
    });

    it("keeps the day on screen when a later read of it fails", () => {
      setDay([sauna]);
      entries.error = new Error("refetch failed");
      render(<HabitsPage />);
      expect(screen.getByRole("checkbox", { name: "Sauna" })).toBeInTheDocument();
      expect(screen.queryByText(/couldn.t load your habits/i)).toBeNull();
    });
  });

  describe("the entry", () => {
    it("saves a tick as done when its box is ticked, and as not done when unticked", async () => {
      setDay([sauna, mobility]);
      render(<HabitsPage />);

      const user = userEvent.setup();
      await user.click(screen.getByRole("checkbox", { name: "Sauna" }));
      await waitFor(() => expect(entries.save).toHaveBeenCalledWith(sauna, { done: true }));
      await user.click(screen.getByRole("checkbox", { name: "Mobility" }));
      await waitFor(() => expect(entries.save).toHaveBeenCalledWith(mobility, { done: false }));
    });

    it("saves a number when the client leaves its box, and writes nothing for a box left as it was", async () => {
      setDay([water]);
      render(<HabitsPage />);

      const user = userEvent.setup();
      const box = screen.getByRole("textbox", { name: "Water" });
      await user.click(box);
      await user.tab();
      expect(entries.save).not.toHaveBeenCalled();

      await user.clear(box);
      await user.type(box, "3.25");
      await user.tab();
      await waitFor(() => expect(entries.save).toHaveBeenCalledWith(water, { value: 3.25 }));
    });

    it("keeps a number being typed when the saved one moves under it, and follows the saved one when untouched", async () => {
      setDay([water]);
      const { rerender } = render(<HabitsPage />);
      const user = userEvent.setup();
      const box = screen.getByRole("textbox", { name: "Water" });
      await user.clear(box);
      await user.type(box, "4");

      // An earlier save of Water is refused: the day's number goes back to 2.
      setDay([item({ id: "Water", measure: "number" }, { entry: { done: null, value: 2, note: null } })]);
      rerender(<HabitsPage />);
      expect(box).toHaveValue("4");
      await user.tab();
      expect(entries.save).toHaveBeenCalledWith(expect.objectContaining({ habit: expect.objectContaining({ id: "Water" }) }), { value: 4 });

      // The 4 shows; then refused, the day goes back to 2: untouched since, the box follows it.
      setDay([item({ id: "Water", measure: "number" }, { entry: { done: null, value: 4, note: null }, met: true })]);
      rerender(<HabitsPage />);
      setDay([item({ id: "Water", measure: "number" }, { entry: { done: null, value: 2, note: null } })]);
      rerender(<HabitsPage />);
      expect(box).toHaveValue("2");
    });

    it("saves a number when the client presses Enter", async () => {
      setDay([water]);
      render(<HabitsPage />);

      const user = userEvent.setup();
      const box = screen.getByRole("textbox", { name: "Water" });
      await user.clear(box);
      await user.type(box, "2.5{Enter}");
      await waitFor(() => expect(entries.save).toHaveBeenCalledWith(water, { value: 2.5 }));
    });

    it("clears the entry when the client empties the box, and refuses what is not a number, naming the habit and marking the box", async () => {
      setDay([water]);
      render(<HabitsPage />);

      const user = userEvent.setup();
      const box = screen.getByRole("textbox", { name: "Water" });
      await user.clear(box);
      await user.tab();
      await waitFor(() => expect(entries.clear).toHaveBeenCalledWith(water));

      await user.type(box, "3.125");
      await user.tab();
      expect(toastMock.error).toHaveBeenCalledWith("Couldn't save Water", {
        description: "Enter a number, to two decimals at most",
      });
      expect(box).toHaveAttribute("aria-invalid", "true");
      expect(box).toHaveValue("3.125");
      expect(entries.save).not.toHaveBeenCalled();
    });

    it("keeps every control open while a write is on its way: a second gesture on the same habit goes too", async () => {
      entries.save.mockReturnValue(new Promise<void>(() => {}));
      setDay([sauna, mobility]);
      render(<HabitsPage />);

      const user = userEvent.setup();
      await user.click(screen.getByRole("checkbox", { name: "Sauna" }));
      expect(screen.getByRole("checkbox", { name: "Sauna" })).not.toBeDisabled();
      expect(within(row("Sauna")).getByRole("button", { name: "Add a note to Sauna" })).not.toBeDisabled();
      await user.click(screen.getByRole("checkbox", { name: "Sauna" }));
      expect(entries.save).toHaveBeenCalledTimes(2);
    });
  });

  describe("the note", () => {
    it("opens a box from Add a note and saves the note with the tick as shown: not done until ticked", async () => {
      setDay([sauna]);
      render(<HabitsPage />);

      const user = userEvent.setup();
      await user.click(within(row("Sauna")).getByRole("button", { name: "Add a note to Sauna" }));
      const box = screen.getByRole("textbox", { name: "Note for Sauna" });
      expect(box).toHaveFocus();
      await user.type(box, "  Gym closed  ");
      await user.tab();

      await waitFor(() => expect(entries.save).toHaveBeenCalledWith(sauna, { done: false }, "Gym closed"));
    });

    it("saves a note on a ticked habit with its tick", async () => {
      setDay([mobility]);
      render(<HabitsPage />);

      const user = userEvent.setup();
      await user.click(within(row("Mobility")).getByRole("button", { name: "Add a note to Mobility" }));
      await user.type(screen.getByRole("textbox", { name: "Note for Mobility" }), "Did it Tuesday instead");
      await user.tab();

      await waitFor(() => expect(entries.save).toHaveBeenCalledWith(mobility, { done: true }, "Did it Tuesday instead"));
    });

    it("closes a box left empty and writes nothing", async () => {
      setDay([sauna]);
      render(<HabitsPage />);

      const user = userEvent.setup();
      await user.click(within(row("Sauna")).getByRole("button", { name: "Add a note to Sauna" }));
      await user.tab();

      expect(screen.queryByRole("textbox", { name: "Note for Sauna" })).toBeNull();
      expect(within(row("Sauna")).getByRole("button", { name: "Add a note to Sauna" })).toBeInTheDocument();
      expect(entries.save).not.toHaveBeenCalled();
    });

    it("shows a note already made in its box; emptying it clears the note, and leaving it untouched writes nothing", async () => {
      const noted = item({ id: "Walk" }, { entry: { done: false, value: null, note: "Rain" } });
      setDay([noted]);
      render(<HabitsPage />);

      const user = userEvent.setup();
      const box = screen.getByRole("textbox", { name: "Note for Walk" });
      expect(box).toHaveValue("Rain");
      await user.click(box);
      await user.tab();
      expect(entries.save).not.toHaveBeenCalled();

      await user.clear(box);
      await user.tab();
      await waitFor(() => expect(entries.save).toHaveBeenCalledWith(noted, { done: false }, null));
    });

    it("waits for a number habit's number before it offers a note, then saves the note with the number", async () => {
      const empty = item({ id: "Steps", measure: "number" });
      setDay([empty, water]);
      render(<HabitsPage />);

      // The note's line holds its place, its button waiting for the number.
      expect(within(row("Steps")).getByRole("button", { name: "Add a note to Steps" })).toBeDisabled();

      const user = userEvent.setup();
      await user.click(within(row("Water")).getByRole("button", { name: "Add a note to Water" }));
      await user.type(screen.getByRole("textbox", { name: "Note for Water" }), "Hot day");
      await user.tab();
      await waitFor(() => expect(entries.save).toHaveBeenCalledWith(water, { value: 3 }, "Hot day"));
    });

    it("refuses out loud a note left with no number to ride on, keeping its words marked", async () => {
      setDay([water]);
      const { rerender } = render(<HabitsPage />);
      const user = userEvent.setup();
      await user.click(within(row("Water")).getByRole("button", { name: "Add a note to Water" }));
      await user.type(screen.getByRole("textbox", { name: "Note for Water" }), "Hot day");

      // The number goes (its save refused) while the note is being typed.
      setDay([item({ id: "Water", measure: "number" })]);
      rerender(<HabitsPage />);
      await user.tab();

      const box = screen.getByRole("textbox", { name: "Note for Water" });
      expect(toastMock.error).toHaveBeenCalledWith("Couldn't save Water", {
        description: "Add the number first: a note is saved with it.",
      });
      expect(box).toHaveValue("Hot day");
      expect(box).toHaveAttribute("aria-invalid", "true");
      expect(entries.save).not.toHaveBeenCalled();
    });

    it("saves a note on Enter and keeps the box focused", async () => {
      setDay([mobility]);
      render(<HabitsPage />);
      const user = userEvent.setup();
      await user.click(within(row("Mobility")).getByRole("button", { name: "Add a note to Mobility" }));
      const box = screen.getByRole("textbox", { name: "Note for Mobility" });
      await user.type(box, "Felt good{Enter}");
      expect(entries.save).toHaveBeenCalledWith(mobility, { done: true }, "Felt good");
      expect(box).toHaveFocus();
    });
  });

  describe("locked and open days", () => {
    it("keeps a past day inside the open week open", async () => {
      setDay([sauna, water]);
      mockSearchParam = PAST;
      mockLogsOpenFrom = null; // no check-in has closed anything
      render(<HabitsPage />);

      expect(screen.getByRole("checkbox", { name: "Sauna" })).not.toBeDisabled();
      expect(screen.getByRole("textbox", { name: "Water" })).not.toBeDisabled();
      expect(screen.queryByText("This day is locked.")).toBeNull();

      const user = userEvent.setup();
      await user.click(screen.getByRole("checkbox", { name: "Sauna" }));
      await waitFor(() => expect(entries.save).toHaveBeenCalled());
    });

    it("shows the notice, disables every control, offers no note and shows a note made as words, on a day before the boundary", () => {
      const noted = item({ id: "Walk" }, { entry: { done: true, value: null, note: "Rain" }, met: true });
      setDay([sauna, water, noted]);
      mockSearchParam = PAST;
      // A check-in has closed everything up to 2026-01-01, so a 2020 day is shut.
      mockLogsOpenFrom = "2026-01-01";
      render(<HabitsPage />);

      expect(screen.getByText("This day is locked.")).toBeInTheDocument();
      screen.getAllByRole("checkbox").forEach((box) => expect(box).toBeDisabled());
      expect(screen.getByRole("textbox", { name: "Water" })).toBeDisabled();
      expect(screen.queryByRole("button", { name: /add a note/i })).toBeNull();
      expect(screen.queryByRole("textbox", { name: "Note for Walk" })).toBeNull();
      expect(within(row("Walk")).getByText("Rain")).toBeInTheDocument();
    });

    it("locks a future day", () => {
      setDay([sauna]);
      mockSearchParam = "2999-01-01";
      render(<HabitsPage />);

      expect(screen.getByText("This day is locked.")).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: "Sauna" })).toBeDisabled();
    });
  });

  describe("a write refused or unanswered", () => {
    it("says the day is locked when the write is refused for it, and moves the focus from the disabled tick to the notice", async () => {
      setDay([sauna]);
      const { rerender } = render(<HabitsPage />);
      // The hook lands the day rule, read again, with the habit it takes back.
      entries.save.mockImplementation(() => {
        mockLogsOpenFrom = "2999-01-01";
        rerender(<HabitsPage />);
        return Promise.reject(new HabitEntryError("This day is locked.", 403));
      });

      const user = userEvent.setup();
      await user.click(screen.getByRole("checkbox", { name: "Sauna" }));
      await waitFor(() =>
        expect(toastMock.error).toHaveBeenCalledWith("This day is locked", { description: "This day is locked." })
      );
      expect(screen.getByRole("checkbox", { name: "Sauna" })).toBeDisabled();
      expect(screen.getByText("This day is locked.")).toHaveFocus();
    });

    it("says why any other write failed, in the server's words", async () => {
      entries.save.mockRejectedValue(new HabitEntryError("This habit takes a number.", 400));
      setDay([sauna]);
      render(<HabitsPage />);

      const user = userEvent.setup();
      await user.click(screen.getByRole("checkbox", { name: "Sauna" }));
      await waitFor(() =>
        expect(toastMock.error).toHaveBeenCalledWith("Couldn't update habit", {
          description: "This habit takes a number.",
        })
      );
      expect(toastMock.error).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["deleted", 404, "Habit not found."],
      ["stopped", 409, "That habit isn't running on that day."],
    ])("says why when the coach %s the habit underneath the write", async (_how, status, sentence) => {
      entries.save.mockRejectedValue(new HabitEntryError(sentence, status));
      setDay([sauna]);
      render(<HabitsPage />);

      const user = userEvent.setup();
      await user.click(screen.getByRole("checkbox", { name: "Sauna" }));
      await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Couldn't update habit", { description: sentence }));
      expect(toastMock.error).toHaveBeenCalledTimes(1);
    });

    it("says it was a network error, not the browser's words, when the write gets no answer", async () => {
      const offline = new TypeError("Failed to fetch");
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      entries.save.mockRejectedValue(offline);
      setDay([sauna]);
      render(<HabitsPage />);

      const user = userEvent.setup();
      await user.click(screen.getByRole("checkbox", { name: "Sauna" }));
      await waitFor(() =>
        expect(toastMock.error).toHaveBeenCalledWith("Couldn't update habit", {
          description: "Network error. Please try again.",
        })
      );
      expect(toastMock.error).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith(expect.any(String), offline);
    });
  });
});
