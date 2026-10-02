import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig, type Cache } from "swr";
import { useEffect, useState, type ReactNode } from "react";

import { checkInHabitWeekKey, useCheckInHabitWeek } from "./use-check-in-habit-week";
import { HabitEntryError } from "./use-client-habit-entries";
import { clientHabitDayKey, clientHabitProgressKey, useClientHabitDayEntries } from "./use-client-portal-habits";
import { clientDaySummaryKey } from "./use-client-training-data";
import { versionOn } from "@/lib/habits/habit-day";
import { habitWeek } from "@/lib/habits/habit-week";
import { weekFigureWords } from "@/lib/habits/habit-words";
import type {
  ClientHabit,
  ClientHabitDay,
  ClientHabitWeek,
  HabitEntry,
  HabitEntryResult,
  HabitVersion,
  HabitWeekRow,
} from "@/types/habits";

// The check-in's Habits step over a real SWR cache; only the network is
// stubbed. The server below holds the client's habits and entries and answers
// as the routes do: the week route over the dates asked, the entry route with
// the habit's day and the WHOLE client week holding it.

// The client's week runs Thursday 24 to Wednesday 30 September 2026.
const CLIENT_WEEK = ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"];
const MON = "2026-09-28";
const TUE = "2026-09-29";
const WED = "2026-09-30";
const EVERY_DAY: HabitVersion["weekdays"] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const version = (overrides: Partial<HabitVersion> = {}): HabitVersion => ({
  id: "v", startsOn: "2026-09-01", endsOn: null, target: null, timesPerWeek: null, weekdays: EVERY_DAY, ...overrides,
});
const WATER: ClientHabit = {
  id: "water", name: "Water", howTo: null, measure: "number", unit: "L", direction: "at_least", position: 1,
  versions: [version({ target: 3 })], dayEdits: [],
};
const MOBILITY: ClientHabit = {
  id: "mobility", name: "Mobility", howTo: null, measure: "tick", unit: null, direction: null, position: 2,
  versions: [version({ weekdays: ["monday", "wednesday", "friday"] })], dayEdits: [],
};

/** What the server holds. */
let habits: ClientHabit[];
let entries: HabitEntry[];

function rowOf(habit: ClientHabit, dates: string[]): HabitWeekRow {
  const week = habitWeek(habit, entries, dates);
  return {
    habit: { id: habit.id, name: habit.name, howTo: null, measure: habit.measure, unit: habit.unit, direction: habit.direction },
    words: { schedule: null, target: null },
    days: week.days,
    figures: week.figures,
  };
}

/** The week route's answer over `dates`. */
function weekOver(dates: string[]): ClientHabitWeek {
  const rows = habits.map((habit) => rowOf(habit, dates));
  const totals = rows.reduce(
    (sum, row) => ({ planned: sum.planned + row.figures.planned, done: sum.done + row.figures.done, met: sum.met + row.figures.met }),
    { planned: 0, done: 0, met: 0 }
  );
  return { start: dates[0], end: dates[dates.length - 1], dates, habits: rows, totals };
}

/** The habits page's day read: every habit a version covers on the date, with the client week holding it. */
function dayRead(date: string): ClientHabitDay {
  return {
    date,
    habits: habits
      .filter((habit) => versionOn(habit, date))
      .map((habit) => {
        const week = habitWeek(habit, entries, CLIENT_WEEK);
        return {
          habit: { id: habit.id, name: habit.name, howTo: null, measure: habit.measure, unit: habit.unit, direction: habit.direction },
          day: week.days[CLIENT_WEEK.indexOf(date)],
          week: { ...week.figures, start: CLIENT_WEEK[0], end: CLIENT_WEEK[6] },
          words: { schedule: null, target: null, week: weekFigureWords(week.figures) },
        };
      }),
  };
}

/** The entry route's answer: the habit's day and the whole client week holding it. */
function entryAnswer(habitId: string, date: string): HabitEntryResult {
  const week = habitWeek(habits.find((habit) => habit.id === habitId)!, entries, CLIENT_WEEK);
  return { day: week.days[CLIENT_WEEK.indexOf(date)], week: { ...week.figures, start: CLIENT_WEEK[0], end: CLIENT_WEEK[6] } };
}

/** The server saves what a write asked for, keeping the day's note when the write sends none, as the route does. */
function commit(habitId: string, date: string, body: { done?: boolean; value?: number } | undefined) {
  const note = entries.find((entry) => entry.habitId === habitId && entry.date === date)?.note ?? null;
  entries = entries.filter((entry) => !(entry.habitId === habitId && entry.date === date));
  if (body) entries.push({ habitId, date, done: body.done ?? null, value: body.value ?? null, note });
}

type Write = {
  habitId: string;
  date: string;
  method: string;
  body: { done?: boolean; value?: number } | undefined;
  /** Saves and answers as the route does. */
  save: () => void;
  answer: (status: number, body: unknown) => void;
  lose: () => void;
};
let writes: Write[];
/** Week reads held by the test, when `holdReads` is set: each answers with the week as it was when asked. */
let heldReads: { release: () => void }[];
let holdReads: boolean;
let fetchMock: ReturnType<typeof vi.fn>;

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  habits = [WATER, MOBILITY];
  entries = [];
  writes = [];
  heldReads = [];
  holdReads = false;
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      const [, , , , habitId, , date] = url.split("/");
      return new Promise<Response>((resolve, reject) => {
        const body = init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as Write["body"]);
        const write: Write = {
          habitId,
          date,
          method,
          body,
          save: () => {
            commit(habitId, date, method === "DELETE" ? undefined : body);
            resolve(reply(200, { success: true, data: entryAnswer(habitId, date) }));
          },
          answer: (status, answer) => resolve(reply(status, answer)),
          lose: () => reject(new TypeError("Failed to fetch")),
        };
        writes.push(write);
      });
    }
    const week = new URL(url, "https://t.dev");
    if (week.pathname === "/api/client/habits/week") {
      const start = week.searchParams.get("start")!;
      const end = week.searchParams.get("end")!;
      // Read when asked: a held read answers with the week as it was then.
      const answer = reply(200, { success: true, data: weekOver(CLIENT_WEEK.filter((d) => d >= start && d <= end)) });
      if (!holdReads) return Promise.resolve(answer);
      return new Promise<Response>((resolve) => heldReads.push({ release: () => resolve(answer) }));
    }
    if (week.pathname === "/api/client/habits/day") {
      return Promise.resolve(reply(200, { success: true, data: dayRead(week.searchParams.get("date")!) }));
    }
    return Promise.resolve(reply(200, { success: true, data: {} }));
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function wrapperFor(cache: Cache) {
  return ({ children }: { children: ReactNode }) => (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0, errorRetryCount: 0 }}>{children}</SWRConfig>
  );
}

function renderStep(cache: Cache, initial: ClientHabitWeek) {
  return renderHook(() => useCheckInHabitWeek(initial), { wrapper: wrapperFor(cache) });
}

type View = ReturnType<typeof renderStep>;

const rowIn = (week: ClientHabitWeek, habitId: string) => week.habits.find((row) => row.habit.id === habitId);
const dayIn = (week: ClientHabitWeek, habitId: string, date: string) => rowIn(week, habitId)?.days.find((day) => day.date === date);
const dayShown = (view: View, habitId: string, date: string) => dayIn(view.result.current.week, habitId, date);
const figuresShown = (view: View, habitId: string) => rowIn(view.result.current.week, habitId)?.figures;
const rowShown = (view: View, habitId: string) => rowIn(view.result.current.week, habitId)!;

type Screen = "step" | "away" | "habits";

/**
 * The step and the habits page under ONE SWR provider for the whole test, as
 * the app has them: Back and Next, and opening the habits page, mount and
 * unmount screens, never the provider — SWR keeps its state for the cache, a
 * read's deduping included, for as long as the provider lives.
 */
function renderApp(cache: Cache, initial: ClientHabitWeek) {
  const app = {
    /** The step as its latest render had it. */
    step: null as ReturnType<typeof useCheckInHabitWeek> | null,
    /** The week each render of the step showed, oldest first. */
    frames: [] as ClientHabitWeek[],
    /** The habits page's day for the Monday, each render, oldest first. */
    days: [] as (ClientHabitDay | null)[],
  };
  let show: (screen: Screen) => void = () => {};
  function Step() {
    const step = useCheckInHabitWeek(initial);
    app.step = step;
    app.frames.push(step.week);
    return null;
  }
  function HabitsPage() {
    app.days.push(useClientHabitDayEntries(MON).day);
    return null;
  }
  function App({ onReady }: { onReady: (go: (screen: Screen) => void) => void }) {
    const [screen, setScreen] = useState<Screen>("step");
    useEffect(() => onReady(setScreen), [onReady]);
    return screen === "step" ? <Step /> : screen === "habits" ? <HabitsPage /> : null;
  }
  render(
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0, errorRetryCount: 0 }}>
      <App onReady={(go) => (show = go)} />
    </SWRConfig>
  );
  return {
    app,
    /** The step's week now. */
    week: () => app.step!.week,
    back: () => act(() => show("away")),
    next: () => act(() => show("step")),
    /** The habits page for the Monday. */
    habitsPage: () => act(() => show("habits")),
  };
}

/** Starts a write and keeps its outcome: undefined, or what it threw. */
function start(run: () => Promise<void>): Promise<unknown> {
  let outcome!: Promise<unknown>;
  act(() => {
    outcome = run().then(
      () => undefined,
      (error: unknown) => error
    );
  });
  return outcome;
}

/** Lets the writes and reads queued so far run. */
async function flushed() {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

const weekReads = () =>
  fetchMock.mock.calls.filter(([url, init]) => String(url).startsWith("/api/client/habits/week") && ((init as RequestInit | undefined)?.method ?? "GET") === "GET").length;

describe("the step's first answer and its reads", () => {
  it("shows the check-in context's week from the first frame, then reads the week again under its own key", async () => {
    const initial = weekOver(CLIENT_WEEK);
    const view = renderStep(new Map(), initial);

    expect(view.result.current.week).toEqual(initial);
    await waitFor(() => expect(weekReads()).toBe(1));
    expect(fetchMock.mock.calls[0][0]).toBe(checkInHabitWeekKey(CLIENT_WEEK[0], CLIENT_WEEK[6]));
  });

  it("reads the week only once every habit entry on its way has its answer, and lands that read though an answer came in while it waited", async () => {
    const { app, week, back, next } = renderApp(new Map(), weekOver(CLIENT_WEEK));
    await waitFor(() => expect(weekReads()).toBe(1));
    const outcome = start(() => app.step!.save(rowIn(week(), "mobility")!, MON, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(1));
    // Back, while the tick is on its way; Saturday's water is entered on another device.
    back();
    commit("water", "2026-09-26", { value: 3.3 });

    // Next: the step's read waits for the tick. SWR asks again for a week it
    // holds on the next animation frame; wait well past it, so a read that did
    // not wait would have gone out.
    next();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(weekReads()).toBe(1);

    // The tick lands while that read waits, which SWR would throw away: the
    // landing asks for another, and the week as the server has it lands.
    act(() => writes[0].save());
    expect(await outcome).toBeUndefined();
    await waitFor(() => expect(dayIn(week(), "water", "2026-09-26")).toMatchObject({ entry: { value: 3.3 }, met: true }));
    expect(dayIn(week(), "mobility", MON)).toMatchObject({ entry: { done: true }, met: true });
    expect(rowIn(week(), "water")?.figures).toEqual({ planned: 7, done: 1, met: 1 });
  });

  it("reads the week again every time the step comes back, a moment later included: an entry made meanwhile on another device shows", async () => {
    const { week, back, next } = renderApp(new Map(), weekOver(CLIENT_WEEK));
    await waitFor(() => expect(weekReads()).toBe(1));

    back();
    commit("water", "2026-09-26", { value: 3.3 });
    next();
    await waitFor(() => expect(weekReads()).toBe(2));
    await waitFor(() => expect(dayIn(week(), "water", "2026-09-26")).toMatchObject({ entry: { value: 3.3 }, met: true }));
  });
});

describe("an entry made on the step", () => {
  it("shows at once — its day, its habit's figure and the totals — and stays until its answer", async () => {
    const view = renderStep(new Map(), weekOver(CLIENT_WEEK));
    await waitFor(() => expect(weekReads()).toBe(1));

    const outcome = start(() => view.result.current.save(rowShown(view, "mobility"), MON, { done: true }));
    expect(dayShown(view, "mobility", MON)).toMatchObject({ entry: { done: true }, met: true });
    expect(figuresShown(view, "mobility")).toEqual({ planned: 3, done: 1, met: 1 });
    expect(view.result.current.week.totals).toEqual({ planned: 10, done: 1, met: 1 });

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ habitId: "mobility", date: MON, method: "PUT", body: { done: true } });
    act(() => writes[0].save());
    expect(await outcome).toBeUndefined();
    expect(dayShown(view, "mobility", MON)).toMatchObject({ entry: { done: true }, met: true });
    expect(figuresShown(view, "mobility")).toEqual({ planned: 3, done: 1, met: 1 });
    // The answer's week counts what the step's moved row counts: it lands alone, with no read.
    expect(weekReads()).toBe(1);
  });

  it("reads the week again for an answer on a first week clamped to the start day, which the answer's whole week cannot vouch for: Water asks 3, never 7", async () => {
    const period = CLIENT_WEEK.slice(4);
    const view = renderStep(new Map(), weekOver(period));
    await waitFor(() => expect(weekReads()).toBe(1));

    const outcome = start(() => view.result.current.save(rowShown(view, "water"), TUE, { value: 3.2 }));
    await waitFor(() => expect(writes).toHaveLength(1));
    act(() => writes[0].save());
    await outcome;

    // The answer's week is the whole client week: 7 planned. The step's is its three days.
    expect(entryAnswer("water", TUE).week.planned).toBe(7);
    expect(weekReads()).toBe(2);
    expect(figuresShown(view, "water")).toEqual({ planned: 3, done: 1, met: 1 });
    expect(view.result.current.week).toEqual(weekOver(period));
  });

  it("keeps the day's note when it changes the answer: the note is not sent, and the route keeps it", async () => {
    entries = [{ habitId: "water", date: MON, done: null, value: 2.5, note: "Long day" }];
    const view = renderStep(new Map(), weekOver(CLIENT_WEEK));
    await waitFor(() => expect(weekReads()).toBe(1));

    void start(() => view.result.current.save(rowShown(view, "water"), MON, { value: 3.1 }));
    expect(dayShown(view, "water", MON)?.entry).toEqual({ done: null, value: 3.1, note: "Long day" });
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({ value: 3.1 });
  });

  it("clears an entry: the number box emptied", async () => {
    entries = [{ habitId: "water", date: MON, done: null, value: 3.2, note: null }];
    const view = renderStep(new Map(), weekOver(CLIENT_WEEK));
    await waitFor(() => expect(weekReads()).toBe(1));

    const outcome = start(() => view.result.current.clear(rowShown(view, "water"), MON));
    expect(dayShown(view, "water", MON)).toMatchObject({ entry: null, met: false });
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].method).toBe("DELETE");
    act(() => writes[0].save());
    expect(await outcome).toBeUndefined();
    expect(figuresShown(view, "water")).toEqual({ planned: 7, done: 0, met: 0 });
  });

  it("lets an answered change go: the next read of the week decides the day", async () => {
    const { app, week, back, next } = renderApp(new Map(), weekOver(CLIENT_WEEK));
    await waitFor(() => expect(weekReads()).toBe(1));
    const outcome = start(() => app.step!.save(rowIn(week(), "mobility")!, MON, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(1));
    act(() => writes[0].save());
    await outcome;
    back();

    // Unticked since, from the habits page on another device.
    commit("mobility", MON, undefined);
    next();
    await waitFor(() => expect(weekReads()).toBe(2));
    await waitFor(() => expect(dayIn(week(), "mobility", MON)).toMatchObject({ entry: null, met: false }));
  });

  it("sends a habit's writes one after another, so each answer holds every earlier one", async () => {
    const view = renderStep(new Map(), weekOver(CLIENT_WEEK));
    await waitFor(() => expect(weekReads()).toBe(1));

    const first = start(() => view.result.current.save(rowShown(view, "mobility"), MON, { done: true }));
    const second = start(() => view.result.current.save(rowShown(view, "mobility"), TUE, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(1));
    await flushed();
    expect(writes).toHaveLength(1);
    // Both shown meanwhile.
    expect(figuresShown(view, "mobility")).toEqual({ planned: 3, done: 2, met: 2 });

    act(() => writes[0].save());
    await first;
    await waitFor(() => expect(writes).toHaveLength(2));
    act(() => writes[1].save());
    await second;
    expect(view.result.current.week).toEqual(weekOver(CLIENT_WEEK));
    expect(figuresShown(view, "mobility")).toEqual({ planned: 3, done: 2, met: 2 });
  });
});

describe("a write that did not save", () => {
  it("refused (400): takes back its own change alone, and says why", async () => {
    const view = renderStep(new Map(), weekOver(CLIENT_WEEK));
    await waitFor(() => expect(weekReads()).toBe(1));

    const water = start(() => view.result.current.save(rowShown(view, "water"), MON, { value: 3.2 }));
    const mobility = start(() => view.result.current.save(rowShown(view, "mobility"), MON, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(2));
    act(() => writes.find((write) => write.habitId === "water")!.answer(400, { success: false, error: "This habit takes a number." }));

    const error = await water;
    expect(error).toBeInstanceOf(HabitEntryError);
    expect((error as HabitEntryError).message).toBe("This habit takes a number.");
    expect(dayShown(view, "water", MON)).toMatchObject({ entry: null, met: false });
    // Nothing was saved: there is nothing to read again.
    expect(weekReads()).toBe(1);
    // The other habit's change is still on its way, and still shown.
    expect(dayShown(view, "mobility", MON)).toMatchObject({ entry: { done: true } });
    act(() => writes.find((write) => write.habitId === "mobility")!.save());
    expect(await mobility).toBeUndefined();
  });

  it("the habit deleted underneath it (404): the week read straight from the server, the habit gone from the step", async () => {
    const view = renderStep(new Map(), weekOver(CLIENT_WEEK));
    await waitFor(() => expect(weekReads()).toBe(1));

    const outcome = start(() => view.result.current.save(rowShown(view, "water"), MON, { value: 3.2 }));
    await waitFor(() => expect(writes).toHaveLength(1));
    habits = [MOBILITY];
    act(() => writes[0].answer(404, { success: false, error: "Habit not found." }));

    const error = await outcome;
    expect((error as HabitEntryError).status).toBe(404);
    expect(view.result.current.week.habits.map((row) => row.habit.id)).toEqual(["mobility"]);
    expect(view.result.current.week.totals).toEqual({ planned: 3, done: 0, met: 0 });
  });

  it("refused because the coach stopped the habit underneath (409): fails, though the day still holds what was sent", async () => {
    // Monday already ticked; the coach stops Mobility from the Monday, which
    // keeps the entry already made, in no figure. The tick is sent again.
    entries = [{ habitId: "mobility", date: MON, done: true, value: null, note: null }];
    const view = renderStep(new Map(), weekOver(CLIENT_WEEK));
    await waitFor(() => expect(weekReads()).toBe(1));

    const outcome = start(() => view.result.current.save(rowShown(view, "mobility"), MON, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(1));
    habits = [WATER, { ...MOBILITY, versions: [version({ weekdays: ["monday", "wednesday", "friday"], endsOn: "2026-09-27" })] }];
    act(() => writes[0].answer(409, { success: false, error: "That habit isn't running on that day." }));

    const error = await outcome;
    expect((error as HabitEntryError).status).toBe(409);
    expect(dayShown(view, "mobility", MON)).toMatchObject({ covered: false });
  });

  it("an answer on a day the coach planned differently underneath reads the week again: the habit's other days moved too", async () => {
    entries = [{ habitId: "mobility", date: MON, done: true, value: null, note: null }];
    const view = renderStep(new Map(), weekOver(CLIENT_WEEK));
    await waitFor(() => expect(weekReads()).toBe(1));

    // The client empties Monday; meanwhile the coach stopped Mobility from the
    // Monday. A clear has no day to refuse: it answers 200, the day no longer covered.
    const outcome = start(() => view.result.current.clear(rowShown(view, "mobility"), MON));
    await waitFor(() => expect(writes).toHaveLength(1));
    habits = [WATER, { ...MOBILITY, versions: [version({ weekdays: ["monday", "wednesday", "friday"], endsOn: "2026-09-27" })] }];
    act(() => writes[0].save());

    expect(await outcome).toBeUndefined();
    await waitFor(() => expect(weekReads()).toBe(2));
    // Wednesday left the habit with Monday, and the week asks for the Friday alone.
    expect(dayShown(view, "mobility", WED)).toMatchObject({ covered: false, planned: false });
    expect(figuresShown(view, "mobility")).toEqual({ planned: 1, done: 0, met: 0 });
    expect(view.result.current.week).toEqual(weekOver(CLIENT_WEEK));
  });

  it("an answer whose week counts otherwise than the step's reads the week again: the coach took another day off underneath", async () => {
    const view = renderStep(new Map(), weekOver(CLIENT_WEEK));
    await waitFor(() => expect(weekReads()).toBe(1));

    const outcome = start(() => view.result.current.save(rowShown(view, "mobility"), MON, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(1));
    // From the Tuesday, Mobility runs Mondays and Fridays: the Wednesday is no
    // longer planned, though the Monday the client ticked still is.
    habits = [
      WATER,
      {
        ...MOBILITY,
        versions: [
          version({ id: "v1", weekdays: ["monday", "wednesday", "friday"], endsOn: MON }),
          version({ id: "v2", startsOn: TUE, weekdays: ["monday", "friday"] }),
        ],
      },
    ];
    act(() => writes[0].save());

    expect(await outcome).toBeUndefined();
    expect(weekReads()).toBe(2);
    expect(dayShown(view, "mobility", WED)).toMatchObject({ planned: false });
    expect(figuresShown(view, "mobility")).toEqual({ planned: 2, done: 1, met: 1 });
    expect(view.result.current.week).toEqual(weekOver(CLIENT_WEEK));
  });

  it("lands only its own habit from the week it reads again: another habit's answer that came in meanwhile stays", async () => {
    const view = renderStep(new Map(), weekOver(CLIENT_WEEK));
    await waitFor(() => expect(weekReads()).toBe(1));

    const water = start(() => view.result.current.save(rowShown(view, "water"), MON, { value: 3.2 }));
    const mobility = start(() => view.result.current.save(rowShown(view, "mobility"), MON, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(2));
    // Water's answer is lost; the week is read again, and that read is slow.
    holdReads = true;
    act(() => writes.find((write) => write.habitId === "water")!.lose());
    await waitFor(() => expect(heldReads).toHaveLength(1));
    // Mobility saves and answers while the read is out: the read has not seen it.
    act(() => writes.find((write) => write.habitId === "mobility")!.save());
    expect(await mobility).toBeUndefined();
    act(() => heldReads[0].release());

    expect(await water).toBeInstanceOf(TypeError);
    expect(dayShown(view, "mobility", MON)).toMatchObject({ entry: { done: true }, met: true });
    expect(figuresShown(view, "mobility")).toEqual({ planned: 3, done: 1, met: 1 });
    expect(dayShown(view, "water", MON)).toMatchObject({ entry: null });
  });

  it("no answer, but saved: the week read straight from the server shows it, and the write settles as saved", async () => {
    const view = renderStep(new Map(), weekOver(CLIENT_WEEK));
    await waitFor(() => expect(weekReads()).toBe(1));

    const outcome = start(() => view.result.current.save(rowShown(view, "mobility"), MON, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(1));
    // The server saved it; the answer was lost on the way back.
    commit("mobility", MON, { done: true });
    act(() => writes[0].lose());

    expect(await outcome).toBeUndefined();
    expect(dayShown(view, "mobility", MON)).toMatchObject({ entry: { done: true }, met: true });
    expect(figuresShown(view, "mobility")).toEqual({ planned: 3, done: 1, met: 1 });
  });

  it("no answer, but saved, though the day's note changed meanwhile on another screen: the write settles as saved", async () => {
    entries = [{ habitId: "water", date: MON, done: null, value: 2.5, note: "Long day" }];
    const view = renderStep(new Map(), weekOver(CLIENT_WEEK));
    await waitFor(() => expect(weekReads()).toBe(1));

    const outcome = start(() => view.result.current.save(rowShown(view, "water"), MON, { value: 3.1 }));
    await waitFor(() => expect(writes).toHaveLength(1));
    // The server saved the number; the habits page on another device changed
    // the day's note; the answer was lost on the way back.
    commit("water", MON, { value: 3.1 });
    entries = entries.map((entry) => (entry.habitId === "water" && entry.date === MON ? { ...entry, note: "Hotel" } : entry));
    act(() => writes[0].lose());

    expect(await outcome).toBeUndefined();
    expect(dayShown(view, "water", MON)).toMatchObject({ entry: { value: 3.1, note: "Hotel" }, met: true });
  });

  it("no answer, and not saved: the change goes and the write fails", async () => {
    const view = renderStep(new Map(), weekOver(CLIENT_WEEK));
    await waitFor(() => expect(weekReads()).toBe(1));

    const outcome = start(() => view.result.current.save(rowShown(view, "mobility"), MON, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(1));
    act(() => writes[0].lose());

    expect(await outcome).toBeInstanceOf(TypeError);
    expect(dayShown(view, "mobility", MON)).toMatchObject({ entry: null, met: false });
    expect(figuresShown(view, "mobility")).toEqual({ planned: 3, done: 0, met: 0 });
  });

  it("saved but not read back (no data): the change is what the server holds, and the week is read again", async () => {
    const view = renderStep(new Map(), weekOver(CLIENT_WEEK));
    await waitFor(() => expect(weekReads()).toBe(1));

    const outcome = start(() => view.result.current.save(rowShown(view, "mobility"), MON, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(1));
    commit("mobility", MON, { done: true });
    holdReads = true;
    act(() => writes[0].answer(200, { success: true, data: null }));

    expect(await outcome).toBeUndefined();
    // While the week is read again, the change stands as what the server holds.
    await waitFor(() => expect(weekReads()).toBe(2));
    expect(dayShown(view, "mobility", MON)).toMatchObject({ entry: { done: true }, met: true });
    expect(figuresShown(view, "mobility")).toEqual({ planned: 3, done: 1, met: 1 });
    act(() => heldReads[0].release());
    await flushed();
    expect(dayShown(view, "mobility", MON)).toMatchObject({ entry: { done: true }, met: true });
  });
});

describe("what an entry moves elsewhere", () => {
  it("clears the client's other habit reads and the home's day summaries as the change is made, never the step's own week", async () => {
    const elsewhere = [clientHabitDayKey(MON), clientHabitProgressKey(8), clientDaySummaryKey(MON)];
    // Each held as SWR holds a read a screen made: its data under its key.
    const store = new Map<string, unknown>(elsewhere.map((key) => [key, { data: { success: true, data: {} }, _k: key }]));
    const cache = store as unknown as Cache;
    const view = renderStep(cache, weekOver(CLIENT_WEEK));
    await waitFor(() => expect(weekReads()).toBe(1));

    const outcome = start(() => view.result.current.save(rowShown(view, "mobility"), WED, { done: true }));
    // Before its answer: a screen opened meanwhile reads after it, never the figure from before.
    for (const key of elsewhere) expect(cache.get(key)?.data).toBeUndefined();
    expect(cache.get(checkInHabitWeekKey(CLIENT_WEEK[0], CLIENT_WEEK[6]))?.data).toBeDefined();
    await waitFor(() => expect(writes).toHaveLength(1));
    act(() => writes[0].save());
    await outcome;
    expect(cache.get(checkInHabitWeekKey(CLIENT_WEEK[0], CLIENT_WEEK[6]))?.data).toBeDefined();
  });

  it("refreshes the habits page's day in place when the write settles: opened while it was on its way, it keeps its rows", async () => {
    const { app, week, habitsPage } = renderApp(new Map(), weekOver(CLIENT_WEEK));
    await waitFor(() => expect(weekReads()).toBe(1));
    const outcome = start(() => app.step!.save(rowIn(week(), "mobility")!, MON, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(1));

    // The client opens the habits page for the Monday before the tick lands:
    // the day as the server has it, until the write settles.
    habitsPage();
    const mobilityMonday = () => app.days.at(-1)?.habits.find((item) => item.habit.id === "mobility")?.day;
    await waitFor(() => expect(app.days.at(-1)?.habits.length).toBe(2));
    const loadedAt = app.days.findIndex((day) => day !== null);
    expect(mobilityMonday()?.entry).toBeNull();

    act(() => writes[0].save());
    await outcome;
    await waitFor(() => expect(mobilityMonday()).toMatchObject({ entry: { done: true }, met: true }));
    // Never cleared under the page: every render from the first load holds the day.
    expect(app.days.slice(loadedAt).every((day) => day !== null)).toBe(true);
  });
});

describe("Back and Next", () => {
  it("shows the step's figures as the client left them when it comes back, from its first frame", async () => {
    // The context's week is the one the page read at the start, before the tick.
    const { app, week, back, next } = renderApp(new Map(), weekOver(CLIENT_WEEK));
    await waitFor(() => expect(weekReads()).toBe(1));
    const outcome = start(() => app.step!.save(rowIn(week(), "mobility")!, MON, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(1));
    act(() => writes[0].save());
    await outcome;
    back();

    app.frames = [];
    next();
    expect(dayIn(app.frames[0], "mobility", MON)).toMatchObject({ entry: { done: true }, met: true });
    expect(rowIn(app.frames[0], "mobility")?.figures).toEqual({ planned: 3, done: 1, met: 1 });
  });

  it("still shows a change on its way when the step comes back before its answer", async () => {
    const { app, week, back, next } = renderApp(new Map(), weekOver(CLIENT_WEEK));
    await waitFor(() => expect(weekReads()).toBe(1));
    const outcome = start(() => app.step!.save(rowIn(week(), "mobility")!, MON, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(1));
    back();

    app.frames = [];
    next();
    expect(dayIn(app.frames[0], "mobility", MON)).toMatchObject({ entry: { done: true } });
    act(() => writes[0].save());
    expect(await outcome).toBeUndefined();
    await waitFor(() => expect(rowIn(week(), "mobility")?.figures).toEqual({ planned: 3, done: 1, met: 1 }));
  });
});
