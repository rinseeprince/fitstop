import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig, type Cache, type State } from "swr";
import type { ReactNode } from "react";

import {
  clientHabitDayKey,
  clientHabitProgressKey,
  HabitEntryError,
  useClientHabitDayEntries,
  useReadAfterHabitEntries,
} from "./use-client-portal-habits";
import { clientDaySummaryKey } from "./use-client-training-data";
import type { ClientHabitDay, ClientHabitDayItem, HabitEntryResult } from "@/types/habits";

import { CLIENT_PROFILE_KEY as PROFILE_KEY } from "@/lib/client-profile-key";

// The habits page's day and its entries over a real SWR cache; only the
// network is stubbed. What these guard is SWR's own behaviour — a read that a
// landing overtakes is thrown away, a mutate on a key with no data writes
// nothing worth showing — which a mocked `mutate` cannot show.

const MON = "2026-09-28";
const TUE = "2026-09-29";
const WEEK = { start: "2026-09-24", end: "2026-09-30" };
const DAY_PREFIX = "/api/client/habits/day?date=";

function tickHabit(id: string, date: string, done = 2): ClientHabitDayItem {
  return {
    habit: { id, name: id, howTo: null, measure: "tick", unit: null, direction: null },
    day: { date, covered: true, planned: true, target: null, edited: false, versionId: `${id}-v`, timesPerWeek: null, entry: null, met: false },
    week: { planned: 7, done, met: done, ...WEEK },
    words: { schedule: "Every day", target: null, week: `${done} of 7` },
  };
}

/** What the server answers once a habit's day is ticked, its week at `done`. */
function ticked(item: ClientHabitDayItem, done: number, note: string | null = null): HabitEntryResult {
  return {
    day: { ...item.day, entry: { done: true, value: null, note }, met: true },
    week: { planned: 7, done, met: done, ...WEEK },
  };
}

/** The day as the server has it, by date: what every read of it answers. */
let server: Record<string, ClientHabitDay>;
/** Every entry write, held until the test answers it. */
type Write = { habitId: string; method: string; body: unknown; answer: (status: number, body: unknown) => void; lose: () => void };
let writes: Write[];
/** Day reads held by the test, when `holdReads` is set: each answers with the server's day once released. */
type HeldRead = { date: string; release: (day?: ClientHabitDay) => void; fail: () => void };
let heldReads: HeldRead[];
let holdReads: boolean;
let fetchMock: ReturnType<typeof vi.fn>;

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  server = {};
  writes = [];
  heldReads = [];
  holdReads = false;
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      return new Promise<Response>((resolve, reject) => {
        writes.push({
          habitId: url.split("/")[4],
          method,
          body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
          answer: (status, body) => resolve(reply(status, body)),
          lose: () => reject(new TypeError("Failed to fetch")),
        });
      });
    }
    if (url.startsWith(DAY_PREFIX)) {
      const date = url.slice(DAY_PREFIX.length);
      if (!holdReads) return Promise.resolve(reply(200, { success: true, data: server[date] }));
      return new Promise<Response>((resolve, reject) => {
        heldReads.push({
          date,
          release: (day) => resolve(reply(200, { success: true, data: day ?? server[date] })),
          fail: () => reject(new TypeError("Failed to fetch")),
        });
      });
    }
    if (url === PROFILE_KEY) return Promise.resolve(reply(200, { success: true, data: { logsOpenFrom: "2026-10-03" } }));
    return Promise.resolve(reply(200, { success: true, data: {} }));
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const dayReads = (date: string) =>
  fetchMock.mock.calls.filter(([url, init]) => url === clientHabitDayKey(date) && ((init as RequestInit | undefined)?.method ?? "GET") === "GET").length;

/** The page's day and entries over one cache, the day loaded. */
async function renderDay(cache: Cache, date: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0, errorRetryCount: 0 }}>{children}</SWRConfig>
  );
  const view = renderHook(({ on }) => useClientHabitDayEntries(on), { initialProps: { on: date }, wrapper });
  if (!holdReads) await waitFor(() => expect(view.result.current.day?.date).toBe(date));
  return view;
}

type View = Awaited<ReturnType<typeof renderDay>>;

/** Each habit as the page shows it: ticked or not, its note, its week in words. */
function shown(view: View) {
  return Object.fromEntries(
    (view.result.current.day?.habits ?? []).map((item) => [
      item.habit.name,
      { ticked: item.day.entry?.done === true, note: item.day.entry?.note ?? null, week: item.words.week },
    ])
  );
}

/** Each habit as a cached day read holds it, read straight from the cache. */
function cachedWeek(cache: Cache, date: string, name: string) {
  const day = (cache.get(clientHabitDayKey(date))?.data as { data: ClientHabitDay } | undefined)?.data;
  return day?.habits.find((item) => item.habit.name === name)?.words.week ?? null;
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

async function answer(index: number, status: number, body: unknown) {
  await act(async () => {
    writes[index].answer(status, body);
    await Promise.resolve();
  });
}

describe("two habits ticked before the first save answers", () => {
  const stretch = tickHabit("Stretch", TUE);
  const walk = tickHabit("Walk", TUE);

  beforeEach(() => {
    server[TUE] = { date: TUE, habits: [stretch, walk] };
  });

  async function tickBoth(view: View) {
    const outcomes = [start(() => view.result.current.save(stretch, { done: true })), start(() => view.result.current.save(walk, { done: true }))];
    await waitFor(() => expect(writes.map((write) => write.habitId)).toEqual(["Stretch", "Walk"]));
    // Both show at once, their weeks moved, before either save has answered.
    expect(shown(view)).toMatchObject({ Stretch: { ticked: true, week: "3 of 7" }, Walk: { ticked: true, week: "3 of 7" } });
    return outcomes;
  }

  it("keeps both ticks when the first answer lands first", async () => {
    const view = await renderDay(new Map() as unknown as Cache, TUE);
    const outcomes = await tickBoth(view);
    await answer(0, 200, { success: true, data: ticked(stretch, 3) });
    expect(shown(view)).toMatchObject({ Stretch: { ticked: true, week: "3 of 7" }, Walk: { ticked: true, week: "3 of 7" } });
    await answer(1, 200, { success: true, data: ticked(walk, 3) });
    expect(await Promise.all(outcomes)).toEqual([undefined, undefined]);
    expect(shown(view)).toMatchObject({ Stretch: { ticked: true, week: "3 of 7" }, Walk: { ticked: true, week: "3 of 7" } });
  });

  it("keeps both ticks when the second answer lands first", async () => {
    const view = await renderDay(new Map() as unknown as Cache, TUE);
    const outcomes = await tickBoth(view);
    await answer(1, 200, { success: true, data: ticked(walk, 3) });
    expect(shown(view)).toMatchObject({ Stretch: { ticked: true, week: "3 of 7" }, Walk: { ticked: true, week: "3 of 7" } });
    await answer(0, 200, { success: true, data: ticked(stretch, 3) });
    expect(await Promise.all(outcomes)).toEqual([undefined, undefined]);
    expect(shown(view)).toMatchObject({ Stretch: { ticked: true, week: "3 of 7" }, Walk: { ticked: true, week: "3 of 7" } });
  });

  it("puts back only the refused habit: the other keeps its tick, in flight and once answered", async () => {
    const view = await renderDay(new Map() as unknown as Cache, TUE);
    const outcomes = await tickBoth(view);
    await answer(1, 409, { success: false, error: "That habit isn't running on that day." });
    await waitFor(() => expect(shown(view)).toMatchObject({ Walk: { ticked: false, week: "2 of 7" } }));
    expect(shown(view)).toMatchObject({ Stretch: { ticked: true, week: "3 of 7" } });

    await answer(0, 200, { success: true, data: ticked(stretch, 3) });
    const [stretchWrite, walkWrite] = await Promise.all(outcomes);
    expect(shown(view)).toMatchObject({ Stretch: { ticked: true, week: "3 of 7" }, Walk: { ticked: false, week: "2 of 7" } });
    // The refusal reaches the page with the server's sentence; the saved tick throws nothing.
    expect(stretchWrite).toBeUndefined();
    expect(walkWrite).toBeInstanceOf(HabitEntryError);
    expect(walkWrite).toMatchObject({ message: "That habit isn't running on that day.", status: 409 });
  });

  it("puts back only the refused habit when it was ticked first: the later tick stays", async () => {
    const view = await renderDay(new Map() as unknown as Cache, TUE);
    const outcomes = await tickBoth(view);
    await answer(0, 403, { success: false, error: "This day is locked." });
    // Back in the commit the refusal lands: no read of the day stands between.
    expect(shown(view)).toMatchObject({ Stretch: { ticked: false, week: "2 of 7" }, Walk: { ticked: true, week: "3 of 7" } });

    await answer(1, 200, { success: true, data: ticked(walk, 3) });
    const [stretchWrite, walkWrite] = await Promise.all(outcomes);
    expect(shown(view)).toMatchObject({ Stretch: { ticked: false, week: "2 of 7" }, Walk: { ticked: true, week: "3 of 7" } });
    expect(stretchWrite).toMatchObject({ message: "This day is locked.", status: 403 });
    expect(walkWrite).toBeUndefined();
  });
});

describe("one habit's writes go one after another", () => {
  const walk = tickHabit("Walk", TUE);

  beforeEach(() => {
    server[TUE] = { date: TUE, habits: [walk] };
  });

  it("a note, then a tick before the note's save answers: both show at once, and the tick is sent once the note has its answer", async () => {
    const view = await renderDay(new Map() as unknown as Cache, TUE);
    const noted = start(() => view.result.current.save(walk, { done: false }, "Rain all day"));
    const tick = start(() => view.result.current.save(walk, { done: true }));

    expect(shown(view)).toEqual({ Walk: { ticked: true, note: "Rain all day", week: "3 of 7" } });
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({ done: false, note: "Rain all day" });

    await answer(0, 200, {
      success: true,
      data: { day: { ...walk.day, entry: { done: false, value: null, note: "Rain all day" }, met: false }, week: { ...walk.week } },
    });
    // The tick still shows over the note's answer, and only now goes.
    expect(shown(view)).toEqual({ Walk: { ticked: true, note: "Rain all day", week: "3 of 7" } });
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1].body).toEqual({ done: true });

    await answer(1, 200, { success: true, data: ticked(walk, 3, "Rain all day") });
    expect(await Promise.all([noted, tick])).toEqual([undefined, undefined]);
    expect(shown(view)).toEqual({ Walk: { ticked: true, note: "Rain all day", week: "3 of 7" } });
  });

  it("a refusal in the middle of the line takes only its own change: the next still shows, and goes", async () => {
    const view = await renderDay(new Map() as unknown as Cache, TUE);
    const first = start(() => view.result.current.save(walk, { done: true }));
    const second = start(() => view.result.current.save(walk, { done: true }, "Felt good"));
    await waitFor(() => expect(writes).toHaveLength(1));

    await answer(0, 403, { success: false, error: "This day is locked." });
    expect(shown(view)).toEqual({ Walk: { ticked: true, note: "Felt good", week: "3 of 7" } });
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1].body).toEqual({ done: true, note: "Felt good" });

    await answer(1, 200, { success: true, data: ticked(walk, 3, "Felt good") });
    expect(await first).toMatchObject({ status: 403 });
    expect(await second).toBeUndefined();
    expect(shown(view)).toEqual({ Walk: { ticked: true, note: "Felt good", week: "3 of 7" } });
  });

  it("a read that started before an answer never puts back what the answer replaced", async () => {
    const view = await renderDay(new Map() as unknown as Cache, TUE);
    const tick = start(() => view.result.current.save(walk, { done: true }));
    const noted = start(() => view.result.current.save(walk, { done: true }, "Rain"));
    await waitFor(() => expect(writes).toHaveLength(1));

    // A read goes out before the tick has its answer, and comes back after it, unticked.
    holdReads = true;
    act(() => view.result.current.retry());
    await waitFor(() => expect(heldReads).toHaveLength(1));
    await answer(0, 200, { success: true, data: ticked(walk, 3) });
    await act(async () => {
      heldReads[0].release({ date: TUE, habits: [walk] });
      await Promise.resolve();
    });

    // The note is refused: what shows is the tick as answered, not the late read.
    await waitFor(() => expect(writes).toHaveLength(2));
    await answer(1, 403, { success: false, error: "This day is locked." });
    expect(await tick).toBeUndefined();
    expect(await noted).toMatchObject({ status: 403 });
    expect(shown(view)).toEqual({ Walk: { ticked: true, note: null, week: "3 of 7" } });
  });

  it("a client who leaves the page and comes back while a write is on its way still sees it, and their next write waits its turn", async () => {
    const cache = new Map() as unknown as Cache;
    const first = await renderDay(cache, TUE);
    const tick = start(() => first.result.current.save(walk, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(1));
    first.unmount();

    // Back on the page: its read on arriving says unticked, the server not having saved yet.
    const again = await renderDay(cache, TUE);
    await waitFor(() => expect(dayReads(TUE)).toBe(2));
    await waitFor(() => expect(again.result.current.day).not.toBeNull());
    expect(shown(again)).toEqual({ Walk: { ticked: true, note: null, week: "3 of 7" } });

    const noted = start(() => again.result.current.save(walk, { done: true }, "Rain"));
    expect(shown(again)).toEqual({ Walk: { ticked: true, note: "Rain", week: "3 of 7" } });
    expect(writes).toHaveLength(1);

    await answer(0, 200, { success: true, data: ticked(walk, 3) });
    await waitFor(() => expect(writes).toHaveLength(2));
    await answer(1, 200, { success: true, data: ticked(walk, 3, "Rain") });
    expect(await Promise.all([tick, noted])).toEqual([undefined, undefined]);
    expect(shown(again)).toEqual({ Walk: { ticked: true, note: "Rain", week: "3 of 7" } });
  });

  it("a read of the day landing while a write is on its way keeps the change on screen", async () => {
    const view = await renderDay(new Map() as unknown as Cache, TUE);
    const tick = start(() => view.result.current.save(walk, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(1));

    // The server has not saved it yet: the read says unticked.
    act(() => view.result.current.retry());
    await waitFor(() => expect(dayReads(TUE)).toBe(2));
    expect(shown(view)).toEqual({ Walk: { ticked: true, note: null, week: "3 of 7" } });

    await answer(0, 200, { success: true, data: ticked(walk, 3) });
    expect(await tick).toBeUndefined();
    expect(shown(view)).toEqual({ Walk: { ticked: true, note: null, week: "3 of 7" } });
  });
});

describe("an answer reaches the rest of its week", () => {
  const monWalk = tickHabit("Walk", MON);
  const tueWalk = tickHabit("Walk", TUE);

  beforeEach(() => {
    server[MON] = { date: MON, habits: [monWalk] };
    server[TUE] = { date: TUE, habits: [tueWalk] };
  });

  it("lands the habit's week on another day of that week the cache holds", async () => {
    const cache = new Map() as unknown as Cache;
    const view = await renderDay(cache, MON);
    view.rerender({ on: TUE });
    await waitFor(() => expect(view.result.current.day?.date).toBe(TUE));

    const tick = start(() => view.result.current.save(tueWalk, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(1));
    await answer(0, 200, { success: true, data: ticked(tueWalk, 3) });
    expect(await tick).toBeUndefined();
    expect(cachedWeek(cache, MON, "Walk")).toBe("3 of 7");
    // The other day was moved, never cleared: its read stands.
    expect(dayReads(MON)).toBe(1);
  });

  it("shows a change on its way on every day of its week, and lands it under that day's own change", async () => {
    const cache = new Map() as unknown as Cache;
    const view = await renderDay(cache, MON);
    const monTick = start(() => view.result.current.save(monWalk, { done: true }));
    view.rerender({ on: TUE });
    await waitFor(() => expect(view.result.current.day?.date).toBe(TUE));
    // Monday's tick, still on its way, already counts on Tuesday.
    expect(shown(view)).toMatchObject({ Walk: { ticked: false, week: "3 of 7" } });
    const tueTick = start(() => view.result.current.save(tueWalk, { done: true }));
    // Tuesday's write waits for Monday's: one habit, one line.
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(shown(view)).toMatchObject({ Walk: { ticked: true, week: "4 of 7" } });

    await answer(0, 200, { success: true, data: ticked(monWalk, 3) });
    // Monday saved: Tuesday's tick still counts on top of it, the figure unmoved.
    expect(shown(view)).toMatchObject({ Walk: { ticked: true, week: "4 of 7" } });
    await waitFor(() => expect(writes).toHaveLength(2));

    await answer(1, 200, { success: true, data: ticked(tueWalk, 4) });
    expect(await Promise.all([monTick, tueTick])).toEqual([undefined, undefined]);
    expect(shown(view)).toMatchObject({ Walk: { ticked: true, week: "4 of 7" } });
    expect(cachedWeek(cache, MON, "Walk")).toBe("4 of 7");
  });

  it("asks again for a day of that week whose first read is still on its way, so it never sticks unread", async () => {
    const cache = new Map() as unknown as Cache;
    const view = await renderDay(cache, MON);
    const tick = start(() => view.result.current.save(monWalk, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(1));

    holdReads = true;
    view.rerender({ on: TUE });
    await waitFor(() => expect(heldReads).toHaveLength(1));
    expect(view.result.current.day).toBeNull();

    // Monday's answer moves the week while Tuesday's first read is out: it is asked again.
    server[TUE] = { date: TUE, habits: [{ ...tueWalk, week: { ...tueWalk.week, done: 3, met: 3 }, words: { ...tueWalk.words, week: "3 of 7" } }] };
    await answer(0, 200, { success: true, data: ticked(monWalk, 3) });
    expect(await tick).toBeUndefined();
    await waitFor(() => expect(heldReads).toHaveLength(2));
    await act(async () => {
      heldReads[0].release({ date: TUE, habits: [tueWalk] });
      heldReads[1].release();
      await Promise.resolve();
    });
    await waitFor(() => expect(view.result.current.day?.date).toBe(TUE));
    expect(shown(view)).toEqual({ Walk: { ticked: false, note: null, week: "3 of 7" } });
  });

  it("a read of the day already on its way when the answer lands is read again, and the answer is what shows", async () => {
    const cache = new Map() as unknown as Cache;
    const view = await renderDay(cache, TUE);
    const tick = start(() => view.result.current.save(tueWalk, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(1));

    holdReads = true;
    act(() => view.result.current.retry());
    await waitFor(() => expect(heldReads).toHaveLength(1));
    server[TUE] = { date: TUE, habits: [{ ...tueWalk, day: ticked(tueWalk, 3).day, week: ticked(tueWalk, 3).week, words: { ...tueWalk.words, week: "3 of 7" } }] };
    await answer(0, 200, { success: true, data: ticked(tueWalk, 3) });
    expect(await tick).toBeUndefined();
    // The landing asked for another read; the one that started before the answer is thrown away.
    await waitFor(() => expect(heldReads).toHaveLength(2));
    await act(async () => {
      heldReads[0].release({ date: TUE, habits: [tueWalk] });
      heldReads[1].release();
      await Promise.resolve();
    });
    await waitFor(() => expect(cache.get(clientHabitDayKey(TUE))?.isValidating).toBe(false));
    expect(shown(view)).toEqual({ Walk: { ticked: true, note: null, week: "3 of 7" } });
  });
});

describe("when the answer is not the habit's day", () => {
  const walk = tickHabit("Walk", TUE);
  const stretch = tickHabit("Stretch", TUE);

  beforeEach(() => {
    server[TUE] = { date: TUE, habits: [stretch, walk] };
  });

  it("the coach stopped the habit underneath the write (409): the day is read, and the habit leaves it in one landing", async () => {
    const view = await renderDay(new Map() as unknown as Cache, TUE);
    const tick = start(() => view.result.current.save(walk, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(1));
    server[TUE] = { date: TUE, habits: [stretch] };

    holdReads = true;
    await answer(0, 409, { success: false, error: "That habit isn't running on that day." });
    await waitFor(() => expect(heldReads).toHaveLength(1));
    // Until the day is read the change stays: no frame puts the row back first.
    expect(shown(view)).toMatchObject({ Walk: { ticked: true } });
    await act(async () => {
      heldReads[0].release();
      await Promise.resolve();
    });
    expect(await tick).toMatchObject({ status: 409 });
    expect(Object.keys(shown(view))).toEqual(["Stretch"]);
  });

  it("saved but not read back (data: null): the change stays as saved, and the day read decides the rest", async () => {
    const cache = new Map() as unknown as Cache;
    const view = await renderDay(cache, TUE);
    const tick = start(() => view.result.current.save(walk, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(1));
    server[TUE] = { date: TUE, habits: [stretch, { ...walk, ...ticked(walk, 4), words: { ...walk.words, week: "4 of 7" } }] };

    await answer(0, 200, { success: true, data: null });
    expect(await tick).toBeUndefined();
    expect(shown(view)).toMatchObject({ Walk: { ticked: true, week: "4 of 7" }, Stretch: { ticked: false, week: "2 of 7" } });
  });

  it("no answer at all, and the day read shows it saved: it settles as saved, and the week reaches the rest of the week", async () => {
    const cache = new Map() as unknown as Cache;
    server[MON] = { date: MON, habits: [tickHabit("Walk", MON)] };
    const view = await renderDay(cache, MON);
    view.rerender({ on: TUE });
    await waitFor(() => expect(view.result.current.day?.date).toBe(TUE));
    const tick = start(() => view.result.current.save(walk, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(1));
    // Saved, and another device's entry made the week 4.
    server[TUE] = { date: TUE, habits: [stretch, { ...walk, ...ticked(walk, 4), words: { ...walk.words, week: "4 of 7" } }] };

    await act(async () => {
      writes[0].lose();
      await Promise.resolve();
    });
    expect(await tick).toBeUndefined();
    expect(shown(view)).toMatchObject({ Walk: { ticked: true, week: "4 of 7" } });
    expect(cachedWeek(cache, MON, "Walk")).toBe("4 of 7");
  });

  it("no answer, and the day read shows it was not saved: the habit goes back and the write says so", async () => {
    const view = await renderDay(new Map() as unknown as Cache, TUE);
    const tick = start(() => view.result.current.save(walk, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(1));
    await act(async () => {
      writes[0].lose();
      await Promise.resolve();
    });
    expect(await tick).toBeInstanceOf(TypeError);
    expect(shown(view)).toMatchObject({ Walk: { ticked: false, week: "2 of 7" } });
  });

  it("the coach deleted the habit underneath the write (404): the day is read, the habit leaves it, and the write says why", async () => {
    const view = await renderDay(new Map() as unknown as Cache, TUE);
    const tick = start(() => view.result.current.save(walk, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(1));
    server[TUE] = { date: TUE, habits: [stretch] };
    await answer(0, 404, { success: false, error: "Habit not found." });
    expect(await tick).toMatchObject({ status: 404 });
    expect(Object.keys(shown(view))).toEqual(["Stretch"]);
  });

  it("an answer that does not fit (400) takes the change back at once, with no read of the day", async () => {
    const view = await renderDay(new Map() as unknown as Cache, TUE);
    const tick = start(() => view.result.current.save(walk, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(1));
    await answer(0, 400, { success: false, error: "This habit takes a number." });
    expect(shown(view)).toMatchObject({ Walk: { ticked: false, week: "2 of 7" } });
    expect(await tick).toMatchObject({ status: 400 });
    expect(dayReads(TUE)).toBe(1);
  });

  it("a locked day (403) reads the client's day rule again and lands it with the habit taken back", async () => {
    const cache = new Map() as unknown as Cache;
    const view = await renderDay(cache, TUE);
    const tick = start(() => view.result.current.save(walk, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(1));
    await answer(0, 403, { success: false, error: "This day is locked." });
    expect(await tick).toMatchObject({ status: 403 });
    expect(shown(view)).toMatchObject({ Walk: { ticked: false } });
    expect(cache.get(PROFILE_KEY)?.data).toEqual({ success: true, data: { logsOpenFrom: "2026-10-03" } });
  });

  it("no answer, and the day cannot be read either: the habit goes back, and the day is asked for again", async () => {
    const view = await renderDay(new Map() as unknown as Cache, TUE);
    const tick = start(() => view.result.current.save(walk, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(1));

    holdReads = true;
    await act(async () => {
      writes[0].lose();
      await Promise.resolve();
    });
    await waitFor(() => expect(heldReads).toHaveLength(1));
    await act(async () => {
      heldReads[0].fail();
      await Promise.resolve();
    });
    expect(await tick).toBeInstanceOf(TypeError);
    expect(shown(view)).toMatchObject({ Walk: { ticked: false, week: "2 of 7" } });
    await waitFor(() => expect(heldReads).toHaveLength(2));
  });
});

describe("what an entry clears", () => {
  const walk = tickHabit("Walk", TUE);

  async function seeded() {
    server[TUE] = { date: TUE, habits: [walk] };
    const cache = new Map() as unknown as Cache;
    // As a read leaves them: SWR's key filters match on `_k`, the key as read,
    // which its public State type leaves out.
    const seed = (key: string, data: unknown) => cache.set(key, { data: { success: true, data }, _k: key } as State);
    seed(clientHabitProgressKey(8), { clientToday: TUE, habits: [] });
    seed(clientDaySummaryKey(MON), {});
    seed(clientDaySummaryKey(TUE), {});
    const view = await renderDay(cache, TUE);
    return { cache, view };
  }

  it("making an entry clears the Journey and every home day at once, before its answer, and never a day read", async () => {
    const { cache, view } = await seeded();
    const tick = start(() => view.result.current.save(walk, { done: true }));
    expect(cache.get(clientHabitProgressKey(8))?.data).toBeUndefined();
    expect(cache.get(clientDaySummaryKey(MON))?.data).toBeUndefined();
    expect(cache.get(clientDaySummaryKey(TUE))?.data).toBeUndefined();
    expect(cache.get(clientHabitDayKey(TUE))?.data).toBeDefined();
    await waitFor(() => expect(writes).toHaveLength(1));
    await answer(0, 200, { success: true, data: ticked(walk, 3) });
    expect(await tick).toBeUndefined();
  });

  it("a read of a figure an entry moves waits until the entry has settled", async () => {
    const { cache, view } = await seeded();
    const wrapper = ({ children }: { children: ReactNode }) => <SWRConfig value={{ provider: () => cache }}>{children}</SWRConfig>;
    const fetcher = vi.fn((url: string) => Promise.resolve(url));
    const reader = renderHook(() => useReadAfterHabitEntries(fetcher), { wrapper });
    const tick = start(() => view.result.current.save(walk, { done: true }));
    let read: string | undefined;
    void reader.result.current(clientDaySummaryKey(TUE)).then((value) => (read = value));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(fetcher).not.toHaveBeenCalled();

    await answer(0, 200, { success: true, data: ticked(walk, 3) });
    expect(await tick).toBeUndefined();
    await waitFor(() => expect(read).toBe(clientDaySummaryKey(TUE)));
  });
});

describe("what settles a change", () => {
  const walk = tickHabit("Walk", TUE);

  beforeEach(() => {
    server[TUE] = { date: TUE, habits: [walk] };
  });

  it("a saved answer closes its change: a later read shows the day as the server has it", async () => {
    const view = await renderDay(new Map() as unknown as Cache, TUE);
    const tick = start(() => view.result.current.save(walk, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(1));
    await answer(0, 200, { success: true, data: ticked(walk, 3) });
    expect(await tick).toBeUndefined();

    // Unticked on another device since.
    act(() => view.result.current.retry());
    await waitFor(() => expect(dayReads(TUE)).toBe(2));
    await waitFor(() => expect(shown(view)).toEqual({ Walk: { ticked: false, note: null, week: "2 of 7" } }));
  });

  it("saved but not read back: nothing takes the change back while the day is read", async () => {
    const view = await renderDay(new Map() as unknown as Cache, TUE);
    const tick = start(() => view.result.current.save(walk, { done: true }));
    await waitFor(() => expect(writes).toHaveLength(1));
    holdReads = true;
    await answer(0, 200, { success: true, data: null });
    await waitFor(() => expect(heldReads).toHaveLength(1));
    expect(shown(view)).toEqual({ Walk: { ticked: true, note: null, week: "3 of 7" } });

    server[TUE] = { date: TUE, habits: [{ ...walk, ...ticked(walk, 3), words: { ...walk.words, week: "3 of 7" } }] };
    await act(async () => {
      heldReads[0].release();
      await Promise.resolve();
    });
    expect(await tick).toBeUndefined();
    expect(shown(view)).toEqual({ Walk: { ticked: true, note: null, week: "3 of 7" } });
  });

  it("a read a landing overtakes is asked for again, even when an older read of the day failed meanwhile", async () => {
    const cache = new Map() as unknown as Cache;
    const first = await renderDay(cache, TUE);
    first.unmount();
    // Back on the day: its cached copy shows, and a read goes out.
    holdReads = true;
    const view = await renderDay(cache, TUE);
    await waitFor(() => expect(heldReads).toHaveLength(1));
    const tick = start(() => view.result.current.save(walk, { done: true }));
    await waitFor(() => expect(heldReads).toHaveLength(2));
    await waitFor(() => expect(writes).toHaveLength(1));

    await act(async () => {
      heldReads[0].fail();
      await Promise.resolve();
    });
    await answer(0, 200, { success: true, data: ticked(walk, 3) });
    expect(await tick).toBeUndefined();
    await waitFor(() => expect(heldReads).toHaveLength(3));

    // The coach added Sauna meanwhile: the day read that lands shows it.
    const sauna = { ...tickHabit("Sauna", TUE), day: { ...tickHabit("Sauna", TUE).day, planned: false, timesPerWeek: 3 } };
    server[TUE] = { date: TUE, habits: [{ ...walk, ...ticked(walk, 3), words: { ...walk.words, week: "3 of 7" } }, sauna] };
    await act(async () => {
      heldReads[1].release();
      heldReads[2].release();
      await Promise.resolve();
    });
    await waitFor(() => expect(Object.keys(shown(view))).toEqual(["Walk", "Sauna"]));
    expect(shown(view)).toMatchObject({ Walk: { ticked: true, week: "3 of 7" } });
  });
});

describe("the number and the clear", () => {
  const water: ClientHabitDayItem = {
    habit: { id: "Water", name: "Water", howTo: null, measure: "number", unit: "L", direction: "at_least" },
    day: { date: TUE, covered: true, planned: true, target: 3, edited: false, versionId: "w", timesPerWeek: null, entry: { done: null, value: 2, note: "Hot" }, met: false },
    week: { planned: 7, done: 3, met: 3, ...WEEK },
    words: { schedule: "Every day", target: "at least 3 L", week: "3 of 7" },
  };

  beforeEach(() => {
    server[TUE] = { date: TUE, habits: [water] };
  });

  it("a number shows at once, judged against the day's target with its note kept; the answer rebuilds the target's words from the day it gives", async () => {
    const view = await renderDay(new Map() as unknown as Cache, TUE);
    const save = start(() => view.result.current.save(water, { value: 2.5 }));
    expect(view.result.current.day?.habits[0]).toMatchObject({ day: { entry: { value: 2.5, note: "Hot" }, met: false }, words: { week: "3 of 7" } });
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({ value: 2.5 });

    // The coach moved today's target to 2 L meanwhile: the answer judges 2.5 met.
    await answer(0, 200, {
      success: true,
      data: { day: { ...water.day, target: 2, entry: { done: null, value: 2.5, note: "Hot" }, met: true }, week: { ...water.week, done: 4, met: 4 } },
    });
    expect(await save).toBeUndefined();
    expect(view.result.current.day?.habits[0]).toMatchObject({ day: { met: true }, words: { target: "at least 2 L", week: "4 of 7" } });
  });

  it("clearing takes the entry and its note off at once, and sends the clear", async () => {
    const view = await renderDay(new Map() as unknown as Cache, TUE);
    const clear = start(() => view.result.current.clear(water));
    expect(view.result.current.day?.habits[0].day.entry).toBeNull();
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].method).toBe("DELETE");
    await answer(0, 200, { success: true, data: { day: { ...water.day, entry: null, met: false }, week: water.week } });
    expect(await clear).toBeUndefined();
    expect(view.result.current.day?.habits[0].day.entry).toBeNull();
  });
});
