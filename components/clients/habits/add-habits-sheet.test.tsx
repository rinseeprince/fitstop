import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { toast, reads } = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  reads: { choices: null as unknown, error: undefined as unknown, isLoading: false, retry: vi.fn(), opens: [] as boolean[] },
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/hooks/use-client-habits", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-client-habits")>();
  return {
    ...actual,
    useClientHabitChoices: (_clientId: string, open: boolean) => {
      reads.opens.push(open);
      return { choices: reads.choices, error: reads.error, isLoading: reads.isLoading, retry: reads.retry };
    },
  };
});

import { AddHabitsSheet } from "./add-habits-sheet";
import { HabitRequestError, type HabitWrites } from "@/hooks/use-client-habits";
import type { CoachHabitList, CoachHabitWeek, HabitChoice } from "@/types/habits";

const TODAY = "2026-09-30";
const EVERY_DAY = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

const WATER: HabitChoice = {
  name: "Water",
  howTo: "A glass with each meal",
  measure: "number",
  unit: "L",
  direction: "at_least",
  target: 3,
  timesPerWeek: null,
  weekdays: [...EVERY_DAY],
  words: { schedule: "Every day", target: "at least 3 L" },
};
const MOBILITY: HabitChoice = {
  name: "Mobility",
  howTo: null,
  measure: "tick",
  unit: null,
  direction: null,
  target: null,
  timesPerWeek: null,
  weekdays: ["monday", "wednesday", "friday"],
  words: { schedule: "Mon, Wed, Fri", target: null },
};

const LIST: CoachHabitList = { clientToday: TODAY, habits: [] };
const WEEK: CoachHabitWeek = { clientToday: TODAY, start: "2026-09-24", end: TODAY, dates: [], habits: [], totals: { planned: 0, done: 0, met: 0 }, today: null };
const ANSWER = { habitIds: ["h1", "h2"], habits: LIST, week: WEEK, currentWeek: null, weekStart: null };

let writes: { land: ReturnType<typeof vi.fn>; add: ReturnType<typeof vi.fn> };

function renderSheet(onOpenChange = vi.fn()) {
  render(<AddHabitsSheet open onOpenChange={onOpenChange} clientId="client-3" clientToday={TODAY} writes={writes as unknown as HabitWrites} />);
  return onOpenChange;
}
const row = (name: string) => screen.getByRole("checkbox", { name: new RegExp(`^${name}`) });
const saveButton = () => screen.getByRole("button", { name: /^Add (habit|\d+ habits)$/ });

beforeEach(() => {
  vi.clearAllMocks();
  reads.choices = [MOBILITY, WATER];
  reads.error = undefined;
  reads.isLoading = false;
  reads.opens = [];
  writes = { land: vi.fn(), add: vi.fn().mockResolvedValue(ANSWER) };
});
afterEach(() => cleanup());

describe("Your habits — every habit the coach has given any client", () => {
  it("reads the choices while open, and lists each with its days then its target", () => {
    renderSheet();
    expect(reads.opens.every(Boolean)).toBe(true);
    expect(within(screen.getByRole("checkbox", { name: /^Water/ })).getByText("Every day · at least 3 L")).toBeInTheDocument();
    expect(within(row("Mobility")).getByText("Mon, Wed, Fri")).toBeInTheDocument();
    expect(row("Water")).toHaveAttribute("aria-checked", "false");
  });

  it("shows the list loading at its size, a failed read with a retry, and an empty list as settled", async () => {
    reads.isLoading = true;
    reads.choices = null;
    renderSheet();
    expect(screen.getByTestId("habit-choices-loading")).toBeInTheDocument();
    cleanup();

    // A failed read reads as every habit read on the tab does (HabitLoadError).
    reads.isLoading = false;
    reads.error = new Error("API request failed");
    renderSheet();
    expect(screen.getByText("Failed to load your habits")).toBeInTheDocument();
    expect(screen.queryByText("API request failed")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(reads.retry).toHaveBeenCalledTimes(1);
    cleanup();

    reads.error = undefined;
    reads.choices = [];
    renderSheet();
    expect(screen.getByText("No other habits to reuse yet")).toBeInTheDocument();
  });

  it("opens a picked habit's how-to, days and target, as it arrives, to adjust for this client", async () => {
    renderSheet();
    await userEvent.setup().click(row("Water"));
    expect(row("Water")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("At least")).toHaveValue("3");
    expect(screen.getByLabelText("How to (optional)")).toHaveValue("A glass with each meal");
  });

  it("adds two habits in one save — one adjusted — from today, then lands the answer and closes the sheet together", async () => {
    const user = userEvent.setup();
    const onOpenChange = renderSheet();
    await user.click(row("Water"));
    await user.click(row("Mobility"));
    await user.clear(screen.getByLabelText("At least"));
    await user.type(screen.getByLabelText("At least"), "2.5");
    expect(saveButton()).toHaveTextContent("Add 2 habits");

    let settle: (value: typeof ANSWER) => void = () => {};
    const write = new Promise<typeof ANSWER>((resolve) => (settle = resolve));
    writes.add.mockReturnValue(write);
    await user.click(saveButton());
    expect(saveButton()).toBeDisabled();
    expect(writes.land).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();

    await act(async () => {
      settle(ANSWER);
      await write;
    });
    // Listed order: Mobility, then Water.
    expect(writes.add).toHaveBeenCalledWith(
      [
        { name: "Mobility", howTo: null, measure: "tick", unit: null, direction: null, target: null, weekdays: ["monday", "wednesday", "friday"] },
        { name: "Water", howTo: "A glass with each meal", measure: "number", unit: "L", direction: "at_least", target: 2.5, weekdays: [...EVERY_DAY] },
      ],
      undefined
    );
    expect(writes.land).toHaveBeenCalledWith(ANSWER);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalledWith("2 habits added");
  });

  it("unpicks a habit, and adds nothing with nothing picked", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(row("Water"));
    await user.click(row("Water"));
    expect(row("Water")).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByLabelText("At least")).toBeNull();
    expect(saveButton()).toBeDisabled();
  });
});

describe("New habit", () => {
  it("adds a tick habit on chosen days", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole("button", { name: "New habit" }));
    await user.type(screen.getByLabelText("Name"), "Stretch");
    await user.click(screen.getByRole("button", { name: "Chosen days" }));
    for (const day of ["Tue", "Thu", "Sat", "Sun"]) await user.click(screen.getByRole("button", { name: day }));
    await user.click(saveButton());
    await waitFor(() =>
      expect(writes.add).toHaveBeenCalledWith(
        [{ name: "Stretch", howTo: null, measure: "tick", unit: null, direction: null, target: null, weekdays: ["monday", "wednesday", "friday"] }],
        undefined
      )
    );
    expect(toast.success).toHaveBeenCalledWith('"Stretch" added');
  });

  it("adds an at-most number habit with its unit and target, a number of times a week", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole("button", { name: "New habit" }));
    await user.type(screen.getByLabelText("Name"), "Drinks");
    await user.click(screen.getByRole("switch", { name: "Track a number" }));
    await user.click(screen.getByRole("button", { name: "At most" }));
    await user.type(screen.getByLabelText("Target"), "2");
    await user.type(screen.getByLabelText("Unit"), "drinks");
    await user.click(screen.getByRole("button", { name: "Times a week" }));
    await user.click(saveButton());
    await waitFor(() =>
      expect(writes.add).toHaveBeenCalledWith(
        [{ name: "Drinks", howTo: null, measure: "number", unit: "drinks", direction: "at_most", target: 2, timesPerWeek: 3 }],
        undefined
      )
    );
  });

  it("names the habit that cannot be saved, and why, sending nothing", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole("button", { name: "New habit" }));
    await user.type(screen.getByLabelText("Name"), "Water");
    await user.click(screen.getByRole("switch", { name: "Track a number" }));
    await user.type(screen.getByLabelText("Target"), "three");
    await user.click(saveButton());
    expect(writes.add).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Could not add the habits", { description: "Water: Enter a number, to two decimals at most" });
  });

  it("removes a new habit's card", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole("button", { name: "New habit" }));
    await user.click(screen.getByRole("button", { name: "Remove new habit" }));
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(saveButton()).toBeDisabled();
  });
});

describe("Starts on, and the one save", () => {
  it("starts on today unless a later day is picked, and never before it", async () => {
    const user = userEvent.setup();
    renderSheet();
    expect(screen.getByLabelText("Starts on")).toHaveValue(TODAY);
    expect(screen.getByLabelText("Starts on")).toHaveAttribute("min", TODAY);
    await user.click(row("Mobility"));
    fireEvent.change(screen.getByLabelText("Starts on"), { target: { value: "2026-10-05" } });
    await user.click(saveButton());
    await waitFor(() => expect(writes.add).toHaveBeenCalledWith(expect.any(Array), "2026-10-05"));
  });

  it("refuses a day before today, sending nothing", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(row("Mobility"));
    fireEvent.change(screen.getByLabelText("Starts on"), { target: { value: "2026-09-29" } });
    await user.click(saveButton());
    expect(writes.add).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Could not add the habits", { description: "Pick today or a later day to start from." });
  });

  it("keeps the sheet open with the server's reason when the add is refused", async () => {
    writes.add.mockRejectedValue(new HabitRequestError("A number habit needs a target.", 400));
    const user = userEvent.setup();
    const onOpenChange = renderSheet();
    await user.click(row("Mobility"));
    await user.click(saveButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not add the habits", { description: "A number habit needs a target." }));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(writes.land).not.toHaveBeenCalled();
    await waitFor(() => expect(saveButton()).toBeEnabled());
  });

  // The land and the close in one tick, so no frame shows the sheet open over
  // the new card or shut over the old (CONVENTIONS §7): the land queues a
  // microtask, and the close must come before it runs.
  it("lands the answer and closes the sheet in one tick", async () => {
    let tickEnded = false;
    writes.land.mockImplementation(() => {
      queueMicrotask(() => {
        tickEnded = true;
      });
    });
    const closes: { landed: number; tickEnded: boolean }[] = [];
    const user = userEvent.setup();
    renderSheet(
      vi.fn((open: boolean) => {
        if (!open) closes.push({ landed: writes.land.mock.calls.length, tickEnded });
      })
    );
    await user.click(row("Mobility"));
    await user.click(saveButton());
    await waitFor(() => expect(closes).toHaveLength(1));
    expect(closes).toEqual([{ landed: 1, tickEnded: false }]);
  });

  it("cannot be dismissed while its add is in flight", async () => {
    let settle: (value: typeof ANSWER) => void = () => {};
    writes.add.mockReturnValue(new Promise<typeof ANSWER>((resolve) => (settle = resolve)));
    const user = userEvent.setup();
    const onOpenChange = renderSheet();
    await user.click(row("Mobility"));
    await user.click(saveButton());
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    act(() => screen.getByRole("button", { name: "Close" }).click());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => {
      settle(ANSWER);
      await Promise.resolve();
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("an add saved without its habits read back is still added: landed, closed and said", async () => {
    const neither = { habitIds: ["h1"], habits: null, week: null, currentWeek: null, weekStart: null };
    writes.add.mockResolvedValue(neither);
    const user = userEvent.setup();
    const onOpenChange = renderSheet();
    await user.click(row("Mobility"));
    await user.click(saveButton());
    await waitFor(() => expect(writes.land).toHaveBeenCalledWith(neither));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalledWith('"Mobility" added');
  });
});
