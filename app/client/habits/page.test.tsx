import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import HabitsLogPage from "./page";
import { getTodayDateStringInTimezone } from "@/lib/date-helpers";
import type { ClientHabitDay, ClientHabitDayItem } from "@/types/habits";

let mockSearchParam: string | null = null;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({
    get: (key: string) => (key === "date" ? mockSearchParam : null),
  }),
}));

// The day-rule boundary the page locks on. Read at render time, so a test can
// set it per case. null = no lower bound (a client with no check-in schedule).
let mockLogsOpenFrom: string | null = null;
vi.mock("@/hooks/use-client-profile", () => ({
  useClientProfile: () => ({
    client: { timezone: "UTC", logsOpenFrom: mockLogsOpenFrom },
    error: null,
    isLoading: false,
    mutate: vi.fn(),
  }),
}));

// The day read and the entry write: the page renders what the read holds and
// hands each change to the write, which lands its answer in the read.
const { dayState, entries } = vi.hoisted(() => ({
  dayState: { day: null as unknown, error: undefined as unknown, isLoading: false, retry: vi.fn() },
  entries: { save: vi.fn(), clear: vi.fn() },
}));
vi.mock("@/hooks/use-client-portal-habits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-client-portal-habits")>()),
  useClientHabitDay: () => dayState,
  useHabitEntryWrites: () => entries,
}));

const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import { HabitEntryError } from "@/hooks/use-client-portal-habits";

const TODAY = getTodayDateStringInTimezone("UTC");
const PAST = "2020-01-01";

function item(over: {
  id: string;
  name: string;
  measure?: "tick" | "number";
  planned?: boolean;
  entry?: ClientHabitDayItem["day"]["entry"];
  met?: boolean;
  target?: string | null;
}): ClientHabitDayItem {
  const measure = over.measure ?? "tick";
  return {
    habit: {
      id: over.id,
      name: over.name,
      howTo: null,
      measure,
      unit: measure === "number" ? "L" : null,
      direction: measure === "number" ? "at_least" : null,
    },
    day: {
      date: TODAY,
      covered: true,
      planned: over.planned ?? true,
      target: measure === "number" ? 3 : null,
      edited: false,
      versionId: `${over.id}-v`,
      timesPerWeek: null,
      entry: over.entry ?? null,
      met: over.met ?? false,
    },
    week: { planned: 7, done: 2, met: 2, start: "2026-09-24", end: "2026-09-30" },
    words: { schedule: "Every day", target: over.target ?? (measure === "number" ? "at least 3 L" : null), week: "2 of 7" },
  };
}

function setDay(habits: ClientHabitDayItem[]) {
  dayState.day = { date: TODAY, habits } satisfies ClientHabitDay;
}

describe("Habits log page", () => {
  beforeEach(() => {
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    entries.save.mockReset().mockResolvedValue(undefined);
    entries.clear.mockReset().mockResolvedValue(undefined);
    dayState.retry.mockReset();
    dayState.error = undefined;
    dayState.isLoading = false;
    mockSearchParam = TODAY;
    mockLogsOpenFrom = null;
    setDay([]);
    cleanup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists every habit running on the day, planned or not: a switch for a tick habit, a box for a number", () => {
    setDay([
      item({ id: "h1", name: "Stretch" }),
      item({ id: "h2", name: "Mobility", planned: false }),
      item({ id: "h3", name: "Water", measure: "number" }),
    ]);
    render(<HabitsLogPage />);

    expect(screen.getAllByRole("switch")).toHaveLength(2);
    expect(screen.getByText("Mobility")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    // The number habit's target, in words.
    expect(screen.getByText("at least 3 L")).toBeInTheDocument();
    expect(screen.getByText("L")).toBeInTheDocument();
  });

  it("saves a tick as done when its switch is turned on, and as not done when turned off", async () => {
    const stretch = item({ id: "h1", name: "Stretch" });
    const walk = item({ id: "h2", name: "Walk", entry: { done: true, value: null, note: null }, met: true });
    setDay([stretch, walk]);
    render(<HabitsLogPage />);

    const user = userEvent.setup();
    const [stretchSwitch, walkSwitch] = screen.getAllByRole("switch");
    expect(walkSwitch).toBeChecked();

    await user.click(stretchSwitch);
    await waitFor(() => expect(entries.save).toHaveBeenCalledWith(stretch, { done: true }));
    await user.click(walkSwitch);
    await waitFor(() => expect(entries.save).toHaveBeenCalledWith(walk, { done: false }));
  });

  it("saves a number when the client leaves its box, and writes nothing for a box left as it was", async () => {
    const water = item({ id: "h3", name: "Water", measure: "number", entry: { done: null, value: 2.5, note: null } });
    setDay([water]);
    render(<HabitsLogPage />);

    const user = userEvent.setup();
    const box = screen.getByRole("textbox");
    expect(box).toHaveValue("2.5");

    // Focused and left untouched: no write.
    await user.click(box);
    await user.tab();
    expect(entries.save).not.toHaveBeenCalled();

    await user.clear(box);
    await user.type(box, "3.25");
    await user.tab();
    await waitFor(() => expect(entries.save).toHaveBeenCalledWith(water, { value: 3.25 }));
  });

  it("clears the entry when the client empties the box, and refuses what is not a number with the reason", async () => {
    const water = item({ id: "h3", name: "Water", measure: "number", entry: { done: null, value: 2.5, note: null } });
    setDay([water]);
    render(<HabitsLogPage />);

    const user = userEvent.setup();
    const box = screen.getByRole("textbox");
    await user.clear(box);
    await user.tab();
    await waitFor(() => expect(entries.clear).toHaveBeenCalledWith(water));

    await user.type(box, "3.125");
    await user.tab();
    expect(toastMock.error).toHaveBeenCalledWith("Couldn't update habit", {
      description: "Enter a number, to two decimals at most",
    });
    expect(entries.save).not.toHaveBeenCalled();
  });

  it("a past day inside the open week stays editable", async () => {
    // The day belongs to a week the client has not reported on yet.
    setDay([item({ id: "h1", name: "Water" }), item({ id: "h2", name: "Walk" })]);
    mockSearchParam = PAST;
    mockLogsOpenFrom = null; // no check-in has closed anything
    render(<HabitsLogPage />);

    const switches = screen.getAllByRole("switch");
    expect(switches[0]).not.toBeDisabled();
    expect(switches[1]).not.toBeDisabled();
    expect(screen.queryByText("This day is locked.")).toBeNull();

    const user = userEvent.setup();
    await user.click(switches[1]);
    await waitFor(() => expect(entries.save).toHaveBeenCalled());
  });

  it("shows the notice and disables every control on a day before the boundary", () => {
    setDay([item({ id: "h1", name: "Water" }), item({ id: "h3", name: "Steps", measure: "number" })]);
    mockSearchParam = PAST;
    // A check-in has closed everything up to 2026-01-01, so a 2020 day is shut.
    mockLogsOpenFrom = "2026-01-01";
    render(<HabitsLogPage />);

    expect(screen.getByText("This day is locked.")).toBeInTheDocument();
    screen.getAllByRole("switch").forEach((sw) => expect(sw).toBeDisabled());
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("says the day is locked and reads the day again when the write is refused for a locked day", async () => {
    entries.save.mockRejectedValue(new HabitEntryError("This day is locked.", 403));
    setDay([item({ id: "h1", name: "Water" })]);
    render(<HabitsLogPage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("switch"));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("This day is locked", { description: "This day is locked." })
    );
    expect(dayState.retry).toHaveBeenCalled();
  });

  it("says why any other write failed, in the server's words", async () => {
    entries.save.mockRejectedValue(new HabitEntryError("This habit takes a number.", 400));
    setDay([item({ id: "h1", name: "Water" })]);
    render(<HabitsLogPage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("switch"));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Couldn't update habit", {
        description: "This habit takes a number.",
      })
    );
    expect(dayState.retry).not.toHaveBeenCalled();
  });

  it.each([
    ["deleted", 404, "Habit not found."],
    ["stopped", 409, "That habit isn't running on that day."],
  ])("says why and reads the day again when the coach %s the habit underneath the write", async (_how, status, sentence) => {
    entries.save.mockRejectedValue(new HabitEntryError(sentence, status));
    setDay([item({ id: "h1", name: "Water" })]);
    render(<HabitsLogPage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("switch"));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Couldn't update habit", { description: sentence }));
    expect(dayState.retry).toHaveBeenCalledTimes(1);
  });

  it("says it was a network error, not the browser's words, when the write gets no answer", async () => {
    const offline = new TypeError("Failed to fetch");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    entries.save.mockRejectedValue(offline);
    setDay([item({ id: "h1", name: "Water" })]);
    render(<HabitsLogPage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("switch"));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Couldn't update habit", {
        description: "Network error. Please try again.",
      })
    );
    expect(toastMock.error).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(expect.any(String), offline);
    expect(dayState.retry).not.toHaveBeenCalled();
  });

  it("renders the empty state when no habit runs on the day", () => {
    setDay([]);
    render(<HabitsLogPage />);
    expect(screen.getByText("No habits on this day")).toBeInTheDocument();
  });

  it("renders a loading skeleton while the day loads", () => {
    dayState.isLoading = true;
    dayState.day = null;
    const { container } = render(<HabitsLogPage />);
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it("shows an error state with a Try again button that reads the day again", async () => {
    dayState.error = new Error("boom");
    render(<HabitsLogPage />);
    expect(screen.getByText(/couldn.t load your habits/i)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(dayState.retry).toHaveBeenCalled();
  });
});
