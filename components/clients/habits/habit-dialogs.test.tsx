import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { toast } = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("sonner", () => ({ toast }));

import { HabitDeleteDialog } from "./habit-delete-dialog";
import { HabitStopDialog } from "./habit-stop-dialog";
import { HabitScheduleDialog } from "./habit-schedule-dialog";
import { HabitRenameDialog } from "./habit-rename-dialog";
import { HabitHistoryDialog } from "./habit-history-dialog";
import { HabitDayDialog } from "./habit-day-dialog";
import { HabitRequestError, type HabitWrites } from "@/hooks/use-client-habits";
import type { CoachHabit, CoachHabitList, CoachHabitWeek, HabitDayFacts, HabitVersion } from "@/types/habits";

// The Habits tab's row dialogs and "This day". Each write's answer is landed
// and its card closed in the same tick; a refusal leaves the card open with
// its reason; a card cannot be dismissed while its write is in flight; and a
// closing card keeps what it showed (CONVENTIONS §3, §7 → "No frame disagrees").

const TODAY = "2026-09-30";
const EVERY_DAY = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

const version = (startsOn: string, over: Partial<HabitVersion> = {}): HabitVersion => ({
  id: `v-${startsOn}`,
  startsOn,
  endsOn: null,
  target: null,
  timesPerWeek: null,
  weekdays: [...EVERY_DAY],
  ...over,
});

const WATER: CoachHabit = {
  id: "h-water",
  name: "Water",
  howTo: "A glass with each meal",
  measure: "number",
  unit: "L",
  direction: "at_least",
  position: 0,
  versions: [version("2026-09-01", { target: 3 })],
  dayEdits: [],
  hasEntries: true,
  status: "running",
  words: { schedule: "Every day", target: "at least 3 L" },
};
const MOBILITY: CoachHabit = {
  ...WATER,
  id: "h-mobility",
  name: "Mobility",
  howTo: null,
  measure: "tick",
  unit: null,
  direction: null,
  versions: [version("2026-09-01", { weekdays: ["monday", "wednesday", "friday"] })],
  words: { schedule: "Mon, Wed, Fri", target: null },
};

const LIST: CoachHabitList = { clientToday: TODAY, habits: [WATER] };
const WEEK: CoachHabitWeek = {
  clientToday: TODAY,
  start: "2026-09-24",
  end: TODAY,
  dates: [],
  habits: [],
  totals: { planned: 0, done: 0, met: 0 },
  today: null,
};
/** A planned day of a set-days number habit, after today, as the tracker hands it to "This day". */
const DAY: HabitDayFacts = {
  date: "2026-10-02",
  covered: true,
  planned: true,
  target: 3,
  edited: false,
  versionId: "v",
  timesPerWeek: null,
  entry: null,
  met: false,
};
const ANSWER = { changed: true, habits: LIST, week: WEEK, currentWeek: null, weekStart: null };
const NEITHER = { changed: true, habits: null, week: null, currentWeek: null, weekStart: null };

function fakeWrites() {
  return {
    land: vi.fn(),
    add: vi.fn(),
    rename: vi.fn().mockResolvedValue(ANSWER),
    change: vi.fn().mockResolvedValue(ANSWER),
    stop: vi.fn().mockResolvedValue(ANSWER),
    remove: vi.fn().mockResolvedValue(ANSWER),
    order: vi.fn(),
    setDay: vi.fn().mockResolvedValue(ANSWER),
    resetDay: vi.fn().mockResolvedValue(ANSWER),
  };
}
let writes: ReturnType<typeof fakeWrites>;
const asWrites = () => writes as unknown as HabitWrites;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => (resolve = settle));
  return { promise, resolve };
}

/**
 * Whether a save lands its answer and closes its card in ONE tick — nothing
 * awaited between, so React renders both in one commit and no frame shows
 * the card open over the new figures or closed over the old (CONVENTIONS §7).
 * The land queues a microtask; each close records how many lands came before
 * it and whether that microtask had run yet.
 */
function sameTickProbe() {
  let tickEnded = false;
  writes.land.mockImplementation(() => {
    queueMicrotask(() => {
      tickEnded = true;
    });
  });
  const closes: { landed: number; tickEnded: boolean }[] = [];
  const onOpenChange = vi.fn((open: boolean) => {
    if (!open) closes.push({ landed: writes.land.mock.calls.length, tickEnded });
  });
  return { onOpenChange, closes };
}

// jsdom computes no animation, so Radix unmounts a closing card at once. Radix
// holds the card while its animation name changes, as the fade does in a
// browser, so naming one keeps the closing frame on the page to be read.
function holdExitAnimation() {
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const styles = computed(element, pseudo);
    if (element instanceof HTMLElement && element.dataset.slot === "dialog-content") {
      Object.defineProperty(styles, "animationName", {
        get: () => (element.dataset.state === "closed" ? "exit" : "enter"),
      });
    }
    return styles;
  });
}

const TEAL_PRIMARY = ["bg-[#0d9488]", "text-white", "hover:bg-[#0b7f75]"];
const DANGER_OUTLINE = ["border-[rgba(192,96,96,0.3)]", "text-[#c06060]"];

beforeEach(() => {
  vi.clearAllMocks();
  writes = fakeWrites();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Stop — from a day", () => {
  const renderStop = (onOpenChange = vi.fn()) =>
    render(<HabitStopDialog open habit={WATER} clientToday={TODAY} writes={asWrites()} onOpenChange={onOpenChange} />);

  it("asks to stop from today, keeping the past, with the non-destructive teal primary", () => {
    renderStop();
    expect(screen.getByRole("heading").textContent).toBe("Stop Water?");
    expect(screen.getByText("It stops from today. Its past stays.")).toBeInTheDocument();
    const stop = screen.getByRole("button", { name: "Stop habit" });
    expect(stop).toHaveClass(...TEAL_PRIMARY);
    for (const danger of DANGER_OUTLINE) expect(stop).not.toHaveClass(danger);
  });

  // The frame test: the card holds its spinner until the stop answers; the
  // answer is landed and the card closed in the same tick.
  it("stops from today, then lands the answer and closes the card together", async () => {
    const write = deferred<typeof ANSWER>();
    writes.stop.mockReturnValue(write.promise);
    const onOpenChange = vi.fn();
    renderStop(onOpenChange);
    fireEvent.click(screen.getByRole("button", { name: "Stop habit" }));

    expect(writes.stop).toHaveBeenCalledWith("h-water", undefined);
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop habit" })).toBeDisabled());
    expect(writes.land).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();

    await act(async () => {
      write.resolve(ANSWER);
      await write.promise;
    });
    expect(writes.land).toHaveBeenCalledWith(ANSWER);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalledWith('"Water" stopped', { description: "Its past stays." });
  });

  it("stops from a later day, and says so", async () => {
    renderStop();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-12" } });
    expect(screen.getByText("It stops from 12 Oct. Its past stays.")).toBeInTheDocument();
    expect(screen.getByLabelText("From")).toHaveAttribute("min", TODAY);
    fireEvent.click(screen.getByRole("button", { name: "Stop habit" }));
    await waitFor(() => expect(writes.stop).toHaveBeenCalledWith("h-water", "2026-10-12"));
  });

  it("refuses a day before today, sending nothing", () => {
    renderStop();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-29" } });
    fireEvent.click(screen.getByRole("button", { name: "Stop habit" }));
    expect(writes.stop).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Could not stop the habit", { description: "Pick today or a later day to stop from." });
  });

  it("cannot be dismissed while its write is in flight", async () => {
    const write = deferred<typeof ANSWER>();
    writes.stop.mockReturnValue(write.promise);
    const onOpenChange = vi.fn();
    renderStop(onOpenChange);
    fireEvent.click(screen.getByRole("button", { name: "Stop habit" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled());
    act(() => screen.getByRole("button", { name: "Close" }).click());
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => {
      write.resolve(ANSWER);
      await write.promise;
    });
  });

  it("says why a refused stop failed, lands nothing and stays open to try again", async () => {
    writes.stop.mockRejectedValue(new HabitRequestError("Pick today or a later day to stop from.", 409));
    const onOpenChange = vi.fn();
    renderStop(onOpenChange);
    fireEvent.click(screen.getByRole("button", { name: "Stop habit" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Could not stop the habit", { description: "Pick today or a later day to stop from." })
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop habit" })).toBeEnabled());
    expect(writes.land).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("a stop saved without its habits read back is still a stop: landed, closed and said", async () => {
    writes.stop.mockResolvedValue(NEITHER);
    const onOpenChange = vi.fn();
    renderStop(onOpenChange);
    fireEvent.click(screen.getByRole("button", { name: "Stop habit" }));
    await waitFor(() => expect(writes.land).toHaveBeenCalledWith(NEITHER));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalledWith('"Water" stopped', { description: "Its past stays." });
  });

  // A stop dated after the stop the habit already has changes nothing: the
  // habit ends sooner already. No "stopped" is claimed for it.
  it("says nothing changed when the habit already stops before that day, and still lands and closes", async () => {
    writes.stop.mockResolvedValue({ ...ANSWER, changed: false });
    const onOpenChange = vi.fn();
    renderStop(onOpenChange);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-12" } });
    fireEvent.click(screen.getByRole("button", { name: "Stop habit" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Nothing changed"));
    expect(toast.success).not.toHaveBeenCalled();
    expect(writes.land).toHaveBeenCalledWith({ ...ANSWER, changed: false });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("still names its habit, and keeps its spinner, while it fades out after the stop answered", async () => {
    holdExitAnimation();
    const onOpenChange = vi.fn();
    const { rerender } = renderStop(onOpenChange);
    fireEvent.click(screen.getByRole("button", { name: "Stop habit" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    rerender(<HabitStopDialog open={false} habit={WATER} clientToday={TODAY} writes={asWrites()} onOpenChange={onOpenChange} />);

    const closing = document.querySelector<HTMLElement>('[data-slot="dialog-content"][data-state="closed"]');
    expect(closing).not.toBeNull();
    expect(closing?.querySelector("h2")?.textContent).toBe("Stop Water?");
    expect(closing?.textContent).toContain("It stops from today. Its past stays.");
    expect(closing?.querySelector(".animate-spin")).not.toBeNull();
  });

  it("is closed whenever `open` is false, even with a habit to name", () => {
    render(<HabitStopDialog open={false} habit={WATER} clientToday={TODAY} writes={asWrites()} onOpenChange={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Delete — one sentence for every habit", () => {
  it("asks in one sentence, logged or not, with the danger outline", () => {
    const { rerender } = render(<HabitDeleteDialog open habit={{ ...WATER, hasEntries: false }} writes={asWrites()} onOpenChange={vi.fn()} />);
    expect(screen.getByRole("heading").textContent).toBe("Delete Water?");
    expect(screen.getByText("Everything the client has logged against this habit will stay.")).toBeInTheDocument();
    rerender(<HabitDeleteDialog open habit={WATER} writes={asWrites()} onOpenChange={vi.fn()} />);
    expect(screen.getByText("Everything the client has logged against this habit will stay.")).toBeInTheDocument();
    const remove = screen.getByRole("button", { name: "Delete habit" });
    expect(remove).toHaveClass(...DANGER_OUTLINE);
    for (const teal of TEAL_PRIMARY) expect(remove).not.toHaveClass(teal);
  });

  it("holds its spinner until the delete answers, then lands the answer and closes together", async () => {
    const write = deferred<typeof NEITHER>();
    writes.remove.mockReturnValue(write.promise);
    const onOpenChange = vi.fn();
    render(<HabitDeleteDialog open habit={WATER} writes={asWrites()} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete habit" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete habit" })).toBeDisabled());
    expect(writes.land).not.toHaveBeenCalled();

    await act(async () => {
      write.resolve(NEITHER);
      await write.promise;
    });
    expect(writes.remove).toHaveBeenCalledWith("h-water");
    expect(writes.land).toHaveBeenCalledWith(NEITHER);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalledWith('"Water" deleted');
  });

  it("says why a refused delete failed and stays open", async () => {
    writes.remove.mockRejectedValue(new HabitRequestError("Habit not found.", 404));
    const onOpenChange = vi.fn();
    render(<HabitDeleteDialog open habit={WATER} writes={asWrites()} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete habit" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Delete failed", { description: "Habit not found." }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete habit" })).toBeEnabled());
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("Change target or days — from a day", () => {
  const renderChange = (habit: CoachHabit, onOpenChange = vi.fn()) =>
    render(<HabitScheduleDialog open habit={habit} mode="change" clientToday={TODAY} writes={asWrites()} onOpenChange={onOpenChange} />);

  it("opens on the version running today, from today", () => {
    renderChange(WATER);
    expect(screen.getByRole("heading").textContent).toBe("Change Water");
    expect(screen.getByLabelText("At least")).toHaveValue("3");
    expect(screen.getByRole("button", { name: "Every day" })).toHaveClass("bg-white");
    expect(screen.getByLabelText("From")).toHaveValue(TODAY);
  });

  it("changes the target and days from a later day, then lands the answer and closes together", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderChange(WATER, onOpenChange);
    await user.clear(screen.getByLabelText("At least"));
    await user.type(screen.getByLabelText("At least"), "3.5");
    await user.click(screen.getByRole("button", { name: "Chosen days" }));
    for (const day of ["Tue", "Thu", "Sat", "Sun"]) await user.click(screen.getByRole("button", { name: day }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-05" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(writes.land).toHaveBeenCalledWith(ANSWER));
    expect(writes.change).toHaveBeenCalledWith("h-water", {
      startsOn: "2026-10-05",
      target: 3.5,
      weekdays: ["monday", "wednesday", "friday"],
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalledWith('"Water" changed', { description: "The change runs from 5 Oct." });
  });

  it("changes to a number of times a week, from today, sending no day", async () => {
    const user = userEvent.setup();
    renderChange(MOBILITY);
    await user.click(screen.getByRole("button", { name: "Times a week" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes.change).toHaveBeenCalledWith("h-mobility", { target: null, timesPerWeek: 3 }));
  });

  // A change from today to a habit that starts later would start it today.
  it("opens a habit starting later on its first day, with that version", () => {
    renderChange({
      ...WATER,
      status: "upcoming",
      versions: [version("2026-08-01", { endsOn: "2026-09-11", target: 2 }), version("2026-10-12", { target: 4, timesPerWeek: 5, weekdays: [] })],
    });
    expect(screen.getByLabelText("From")).toHaveValue("2026-10-12");
    expect(screen.getByLabelText("At least")).toHaveValue("4");
    expect(screen.getByRole("button", { name: "Times a week" })).toHaveClass("bg-white");
  });

  it("says nothing changed when the change asks for what the habit already has", async () => {
    writes.change.mockResolvedValue({ ...ANSWER, changed: false });
    renderChange(WATER);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Nothing changed"));
    expect(writes.land).toHaveBeenCalled();
  });

  it("refuses a number habit with no target, and chosen days with none chosen, sending nothing", async () => {
    const user = userEvent.setup();
    renderChange(WATER);
    await user.clear(screen.getByLabelText("At least"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(toast.error).toHaveBeenLastCalledWith("Could not change the habit", { description: "Enter a target" });

    await user.type(screen.getByLabelText("At least"), "3");
    await user.click(screen.getByRole("button", { name: "Chosen days" }));
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) await user.click(screen.getByRole("button", { name: day }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(toast.error).toHaveBeenLastCalledWith("Could not change the habit", { description: "Pick at least one day" });
    expect(writes.change).not.toHaveBeenCalled();
  });

  it("says why a refused change failed and stays open", async () => {
    writes.change.mockRejectedValue(new HabitRequestError("Pick today or a later day to start from.", 409));
    const onOpenChange = vi.fn();
    renderChange(WATER, onOpenChange);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Could not change the habit", { description: "Pick today or a later day to start from." })
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
  });
});

describe("Start again — from a day, its last target and days offered", () => {
  const renderStart = (habit: CoachHabit, onOpenChange = vi.fn()) =>
    render(<HabitScheduleDialog open habit={habit} mode="start-again" clientToday={TODAY} writes={asWrites()} onOpenChange={onOpenChange} />);

  it("offers the LAST version's target and days, and starts it again from today", async () => {
    const onOpenChange = vi.fn();
    renderStart(
      {
        ...WATER,
        status: "stopped",
        versions: [
          version("2026-08-01", { endsOn: "2026-08-31", target: 2 }),
          version("2026-09-01", { endsOn: "2026-09-11", target: 2.5, weekdays: ["monday", "thursday"] }),
        ],
      },
      onOpenChange
    );
    expect(screen.getByRole("heading").textContent).toBe("Start Water again");
    expect(screen.getByLabelText("At least")).toHaveValue("2.5");
    fireEvent.click(screen.getByRole("button", { name: "Start again" }));

    await waitFor(() => expect(writes.change).toHaveBeenCalledWith("h-water", { target: 2.5, weekdays: ["monday", "thursday"] }));
    expect(writes.land).toHaveBeenCalledWith(ANSWER);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalledWith('"Water" started again', { description: "It runs from today." });
  });

  // Stopped on its first day, a habit has no version left to offer.
  it("starts a habit with nothing left every day, a tick habit at once and a number habit once its target is typed", async () => {
    const user = userEvent.setup();
    const { unmount } = renderStart({ ...MOBILITY, status: "stopped", versions: [] });
    fireEvent.click(screen.getByRole("button", { name: "Start again" }));
    await waitFor(() => expect(writes.change).toHaveBeenCalledWith("h-mobility", { target: null, weekdays: [...EVERY_DAY] }));
    unmount();

    writes.change.mockClear();
    renderStart({ ...WATER, status: "stopped", versions: [] });
    expect(screen.getByLabelText("At least")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Start again" }));
    expect(writes.change).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenLastCalledWith("Could not start the habit again", { description: "Enter a target" });
    await user.type(screen.getByLabelText("At least"), "3");
    await user.click(screen.getByRole("button", { name: "Start again" }));
    await waitFor(() => expect(writes.change).toHaveBeenCalledWith("h-water", { target: 3, weekdays: [...EVERY_DAY] }));
  });

  it("starts again from a later day, and says so", async () => {
    renderStart({ ...MOBILITY, status: "stopped", versions: [version("2026-09-01", { endsOn: "2026-09-11" })] });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-05" } });
    fireEvent.click(screen.getByRole("button", { name: "Start again" }));
    await waitFor(() => expect(writes.change).toHaveBeenCalledWith("h-mobility", expect.objectContaining({ startsOn: "2026-10-05" })));
    expect(toast.success).toHaveBeenCalledWith('"Mobility" started again', { description: "It runs from 5 Oct." });
  });
});

describe("Rename — the labels, on any habit", () => {
  it("writes the name and how-to, then lands the answer and closes together", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<HabitRenameDialog open habit={WATER} writes={asWrites()} onOpenChange={onOpenChange} />);
    expect(screen.getByRole("heading").textContent).toBe("Rename Water");
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Hydrate");
    await user.clear(screen.getByLabelText("How to (optional)"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(writes.rename).toHaveBeenCalledWith("h-water", "Hydrate", null));
    expect(writes.land).toHaveBeenCalledWith(ANSWER);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalledWith('"Hydrate" updated');
  });

  it("writes nothing for a form left as it was, and just closes", () => {
    const onOpenChange = vi.fn();
    render(<HabitRenameDialog open habit={WATER} writes={asWrites()} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(writes.rename).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("refuses an empty name, sending nothing", async () => {
    const user = userEvent.setup();
    render(<HabitRenameDialog open habit={WATER} writes={asWrites()} onOpenChange={vi.fn()} />);
    await user.clear(screen.getByLabelText("Name"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(writes.rename).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Could not save the habit", { description: "Enter a name" });
  });

  // The labels already stood as typed — changed in another window since the
  // list was read: the save changed nothing, and says so.
  it("says nothing changed when the habit already had those labels, and still lands and closes", async () => {
    writes.rename.mockResolvedValue({ ...ANSWER, changed: false });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<HabitRenameDialog open habit={WATER} writes={asWrites()} onOpenChange={onOpenChange} />);
    await user.type(screen.getByLabelText("Name"), " intake");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Nothing changed"));
    expect(toast.success).not.toHaveBeenCalled();
    expect(writes.land).toHaveBeenCalledWith({ ...ANSWER, changed: false });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("says why a refused rename failed, lands nothing and stays open", async () => {
    writes.rename.mockRejectedValue(new HabitRequestError("Habit not found.", 404));
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<HabitRenameDialog open habit={WATER} writes={asWrites()} onOpenChange={onOpenChange} />);
    await user.type(screen.getByLabelText("Name"), " intake");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not save the habit", { description: "Habit not found." }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    expect(screen.getByLabelText("Name")).toHaveValue("Water intake");
    expect(writes.land).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("History — a readout", () => {
  const renderHistory = (onOpenChange = vi.fn()) =>
    render(
      <HabitHistoryDialog
        open
        habit={{
          ...WATER,
          versions: [version("2026-09-01", { endsOn: "2026-09-11", target: 2 }), version("2026-09-21", { target: 3 })],
        }}
        clientToday={TODAY}
        onOpenChange={onOpenChange}
      />
    );

  it("lists the habit's versions in words, oldest first, and writes nothing", () => {
    renderHistory();
    expect(screen.getByRole("heading").textContent).toBe("Water history");
    const lines = within(screen.getByRole("list")).getAllByRole("listitem").map((item) => item.textContent);
    expect(lines).toEqual(["1 Sept – 11 Sept · Every day · at least 2 L", "Stopped 12 Sept", "From 21 Sept · Every day · at least 3 L"]);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  // A dialog ends in its footer (CONVENTIONS §3 → Dialog/modal structure): a
  // readout's is one Close.
  it("closes from its footer's Close", () => {
    const onOpenChange = vi.fn();
    renderHistory(onOpenChange);
    const footer = document.querySelector('[data-slot="dialog-footer"]') as HTMLElement;
    fireEvent.click(within(footer).getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("a save lands its answer and closes its card in one tick", () => {
  it.each([
    ["Stop", "Stop habit", (onOpenChange: (open: boolean) => void) => <HabitStopDialog open habit={WATER} clientToday={TODAY} writes={asWrites()} onOpenChange={onOpenChange} />],
    ["Delete", "Delete habit", (onOpenChange: (open: boolean) => void) => <HabitDeleteDialog open habit={WATER} writes={asWrites()} onOpenChange={onOpenChange} />],
    [
      "Change",
      "Save",
      (onOpenChange: (open: boolean) => void) => (
        <HabitScheduleDialog open habit={WATER} mode="change" clientToday={TODAY} writes={asWrites()} onOpenChange={onOpenChange} />
      ),
    ],
    [
      "Start again",
      "Start again",
      (onOpenChange: (open: boolean) => void) => (
        <HabitScheduleDialog
          open
          habit={{ ...WATER, status: "stopped", versions: [version("2026-09-01", { endsOn: "2026-09-11", target: 3 })] }}
          mode="start-again"
          clientToday={TODAY}
          writes={asWrites()}
          onOpenChange={onOpenChange}
        />
      ),
    ],
    [
      "This day",
      "Save",
      (onOpenChange: (open: boolean) => void) => (
        <HabitDayDialog open subject={{ habit: WATER, day: DAY }} writes={asWrites()} onOpenChange={onOpenChange} />
      ),
    ],
    [
      "This day's Reset",
      "Reset",
      (onOpenChange: (open: boolean) => void) => (
        <HabitDayDialog open subject={{ habit: WATER, day: { ...DAY, planned: false, target: null, edited: true } }} writes={asWrites()} onOpenChange={onOpenChange} />
      ),
    ],
  ])("%s", async (_name, button, card) => {
    const probe = sameTickProbe();
    render(card(probe.onOpenChange));
    fireEvent.click(screen.getByRole("button", { name: button }));
    await waitFor(() => expect(probe.closes).toHaveLength(1));
    expect(probe.closes).toEqual([{ landed: 1, tickEnded: false }]);
  });

  it("Rename", async () => {
    const probe = sameTickProbe();
    const user = userEvent.setup();
    render(<HabitRenameDialog open habit={WATER} writes={asWrites()} onOpenChange={probe.onOpenChange} />);
    await user.type(screen.getByLabelText("Name"), "s");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(probe.closes).toHaveLength(1));
    expect(probe.closes).toEqual([{ landed: 1, tickEnded: false }]);
  });
});

describe("a card cannot be dismissed while its write is in flight", () => {
  it.each([
    [
      "Change",
      "Save",
      "change" as const,
      (onOpenChange: (open: boolean) => void) => (
        <HabitScheduleDialog open habit={WATER} mode="change" clientToday={TODAY} writes={asWrites()} onOpenChange={onOpenChange} />
      ),
    ],
    [
      "Start again",
      "Start again",
      "change" as const,
      (onOpenChange: (open: boolean) => void) => (
        <HabitScheduleDialog
          open
          habit={{ ...WATER, status: "stopped", versions: [version("2026-09-01", { endsOn: "2026-09-11", target: 3 })] }}
          mode="start-again"
          clientToday={TODAY}
          writes={asWrites()}
          onOpenChange={onOpenChange}
        />
      ),
    ],
    ["Delete", "Delete habit", "remove" as const, (onOpenChange: (open: boolean) => void) => <HabitDeleteDialog open habit={WATER} writes={asWrites()} onOpenChange={onOpenChange} />],
  ])("%s", async (_name, button, write, card) => {
    const pendingWrite = deferred<typeof ANSWER>();
    writes[write].mockReturnValue(pendingWrite.promise);
    const onOpenChange = vi.fn();
    render(card(onOpenChange));
    fireEvent.click(screen.getByRole("button", { name: button }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled());
    act(() => screen.getByRole("button", { name: "Close" }).click());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => {
      pendingWrite.resolve(ANSWER);
      await pendingWrite.promise;
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Rename", async () => {
    const pendingWrite = deferred<typeof ANSWER>();
    writes.rename.mockReturnValue(pendingWrite.promise);
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<HabitRenameDialog open habit={WATER} writes={asWrites()} onOpenChange={onOpenChange} />);
    await user.type(screen.getByLabelText("Name"), "s");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled());
    act(() => screen.getByRole("button", { name: "Close" }).click());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => {
      pendingWrite.resolve(ANSWER);
      await pendingWrite.promise;
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("This day — one day of a set-days habit", () => {
  const day = (over: Partial<HabitDayFacts> = {}): HabitDayFacts => ({ ...DAY, ...over });
  const renderDay = (habit: CoachHabit, facts: HabitDayFacts, onOpenChange = vi.fn()) =>
    render(<HabitDayDialog open subject={{ habit, day: facts }} writes={asWrites()} onOpenChange={onOpenChange} />);
  const planned = () => screen.getByRole("switch", { name: "Planned" });

  // Planned or not is one day's on/off: a Switch (docs/newdesignsystem.md →
  // Switch), never a segmented control, which picks between modes.
  it("names the habit and the day, and opens on the day as it stands", () => {
    renderDay(WATER, day());
    expect(screen.getByRole("heading").textContent).toBe("This day");
    expect(screen.getByText("Water on Fri 2 Oct")).toBeInTheDocument();
    expect(planned()).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("button", { name: "Not planned" })).toBeNull();
    expect(screen.getByLabelText("At least")).toHaveValue("3");
    // Reset puts back a day already changed; this one is as its days set it.
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("opens a day not planned with the switch off and no target", () => {
    renderDay(WATER, day({ planned: false, target: null, edited: true }));
    expect(planned()).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByLabelText("At least")).toBeNull();
  });

  it("sets that day's target, then lands the answer and closes together", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDay(WATER, day(), onOpenChange);
    await user.clear(screen.getByLabelText("At least"));
    await user.type(screen.getByLabelText("At least"), "2");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(writes.setDay).toHaveBeenCalledWith("h-water", "2026-10-02", { planned: true, target: 2 }));
    expect(writes.land).toHaveBeenCalledWith(ANSWER);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalledWith("Day saved");
  });

  it("takes a day off with no target, and puts a day on for a tick habit", async () => {
    const user = userEvent.setup();
    const { unmount } = renderDay(WATER, day());
    await user.click(planned());
    expect(planned()).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByLabelText("At least")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes.setDay).toHaveBeenCalledWith("h-water", "2026-10-02", { planned: false, target: null }));
    unmount();

    renderDay(MOBILITY, day({ planned: false, target: null }));
    expect(screen.queryByLabelText("At least")).toBeNull();
    await user.click(planned());
    expect(planned()).toHaveAttribute("aria-checked", "true");
    // A tick habit has no target to set, planned or not.
    expect(screen.queryByLabelText("At least")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes.setDay).toHaveBeenLastCalledWith("h-mobility", "2026-10-02", { planned: true, target: null }));
  });

  // A target typed, then the day switched off: the day off carries none.
  it("sends no target for a day switched off after a target was typed", async () => {
    const user = userEvent.setup();
    renderDay(WATER, day());
    await user.clear(screen.getByLabelText("At least"));
    await user.type(screen.getByLabelText("At least"), "2");
    await user.click(planned());
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes.setDay).toHaveBeenCalledWith("h-water", "2026-10-02", { planned: false, target: null }));
  });

  it("says nothing changed when the day already stood as saved", async () => {
    writes.setDay.mockResolvedValue({ ...ANSWER, changed: false });
    const onOpenChange = vi.fn();
    renderDay(WATER, day(), onOpenChange);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Nothing changed"));
    expect(toast.success).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("an emptied Target box is the habit's own target for the day", async () => {
    const user = userEvent.setup();
    renderDay(WATER, day({ target: 2, edited: true }));
    await user.clear(screen.getByLabelText("At least"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes.setDay).toHaveBeenCalledWith("h-water", "2026-10-02", { planned: true, target: null }));
  });

  it("offers Reset on a day already changed, and resets it, then lands the answer and closes together", async () => {
    const onOpenChange = vi.fn();
    renderDay(WATER, day({ planned: false, target: null, edited: true }), onOpenChange);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(writes.resetDay).toHaveBeenCalledWith("h-water", "2026-10-02"));
    expect(writes.land).toHaveBeenCalledWith(ANSWER);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalledWith("Day reset");
  });

  it("refuses a target that is not a number, sending nothing", async () => {
    const user = userEvent.setup();
    renderDay(WATER, day());
    await user.clear(screen.getByLabelText("At least"));
    await user.type(screen.getByLabelText("At least"), "lots");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(writes.setDay).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Could not save the day", { description: "Enter a number, to two decimals at most" });
  });

  it("cannot be dismissed while its write is in flight", async () => {
    const write = deferred<typeof ANSWER>();
    writes.setDay.mockReturnValue(write.promise);
    const onOpenChange = vi.fn();
    renderDay(WATER, day(), onOpenChange);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled());
    act(() => screen.getByRole("button", { name: "Close" }).click());
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => {
      write.resolve(ANSWER);
      await write.promise;
    });
  });

  it("says why a refused day failed, lands nothing and stays open", async () => {
    writes.setDay.mockRejectedValue(new HabitRequestError("This day has passed, so it can't be changed.", 409));
    const onOpenChange = vi.fn();
    renderDay(WATER, day(), onOpenChange);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Could not save the day", { description: "This day has passed, so it can't be changed." })
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(writes.land).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
  });
});
