import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { mutate, swr } = vi.hoisted(() => ({
  mutate: vi.fn(),
  swr: vi.fn((..._args: unknown[]) => ({ data: undefined, error: undefined, isLoading: false, mutate: vi.fn() })),
}));
vi.mock("swr", () => ({
  __esModule: true,
  default: (...args: unknown[]) => swr(...args),
  useSWRConfig: () => ({ mutate }),
}));
vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

import {
  clientHabitDayKey,
  clientHabitProgressKey,
  HabitEntryError,
  isClientHabitsAreaKey,
  useClientHabitDay,
  useClientHabitProgress,
  useHabitEntryWrites,
} from "./use-client-portal-habits";
import { clientDaySummaryKey } from "./use-client-training-data";
import type { ClientHabitDay, ClientHabitDayItem, HabitEntryResult } from "@/types/habits";

const DATE = "2026-09-29";
const DAY_KEY = clientHabitDayKey(DATE);

const water: ClientHabitDayItem = {
  habit: { id: "h-water", name: "Water", howTo: null, measure: "number", unit: "L", direction: "at_least" },
  day: { date: DATE, covered: true, planned: true, target: 3, edited: false, versionId: "v", timesPerWeek: null, entry: null, met: false },
  week: { planned: 7, done: 2, met: 2, start: "2026-09-24", end: "2026-09-30" },
  words: { schedule: "Every day", target: "at least 3 L", week: "2 of 7" },
};
const walk: ClientHabitDayItem = {
  ...water,
  habit: { id: "h-walk", name: "Walk", howTo: null, measure: "tick", unit: null, direction: null },
  day: { ...water.day, target: null },
  words: { schedule: "Every day", target: null, week: "2 of 7" },
};
type DayResponse = { success: boolean; data: ClientHabitDay };
const DAY: DayResponse = { success: true, data: { date: DATE, habits: [water, walk] } };

const ANSWER: HabitEntryResult = {
  day: { ...water.day, entry: { done: null, value: 3.2, note: null }, met: true },
  week: { planned: 7, done: 3, met: 3, start: "2026-09-24", end: "2026-09-30" },
};

function respond(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response;
}

/**
 * The day read's cache, as the page displays it. The mocked `mutate` applies
 * a function update to it at once, the way SWR applies a synchronous one.
 */
let cached: DayResponse | undefined;
function showDay(day: DayResponse) {
  cached = day;
  mutate.mockImplementation((key: unknown, update?: unknown) => {
    if (key === DAY_KEY && typeof update === "function") {
      cached = (update as (current: DayResponse | undefined) => DayResponse | undefined)(cached);
    }
    return Promise.resolve(cached);
  });
}
const shownHabit = (index: number) => cached?.data.habits[index];

/** The entry write, held until the test answers it. */
function holdFetch() {
  let answer: (response: Response) => void = () => {};
  const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (answer = resolve)));
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, answer: (response: Response) => answer(response) };
}

/** Every day-read update: each replaces items at once, and none asks for a read. */
const dayUpdates = () => mutate.mock.calls.filter((call) => call[0] === DAY_KEY && typeof call[1] === "function");
/** Every other `mutate` call: the reads refreshed around the write. */
const refreshes = () => mutate.mock.calls.filter((call) => !(call[0] === DAY_KEY && typeof call[1] === "function"));

const entries = () => renderHook(() => useHabitEntryWrites(DATE)).result.current;

beforeEach(() => {
  vi.clearAllMocks();
  showDay(DAY);
});
afterEach(() => vi.unstubAllGlobals());

describe("the keys", () => {
  it("reads the day and the Journey under the client's habit area", () => {
    expect(clientHabitDayKey(DATE)).toBe("/api/client/habits/day?date=2026-09-29");
    expect(clientHabitProgressKey(8)).toBe("/api/client/habits/progress?weeks=8");
    renderHook(() => useClientHabitDay(DATE));
    renderHook(() => useClientHabitProgress(8));
    expect(swr.mock.calls.map((call) => call[0])).toEqual([clientHabitDayKey(DATE), clientHabitProgressKey(8)]);
  });

  it("the area is every habit read of the client and nothing else", () => {
    expect(isClientHabitsAreaKey(clientHabitDayKey(DATE))).toBe(true);
    expect(isClientHabitsAreaKey(clientHabitProgressKey(8))).toBe(true);
    expect(isClientHabitsAreaKey("/api/client/habits/week?start=2026-09-24&end=2026-09-30")).toBe(true);
    expect(isClientHabitsAreaKey(clientDaySummaryKey(DATE))).toBe(false);
    expect(isClientHabitsAreaKey("/api/clients/c1/habits")).toBe(false);
    expect(isClientHabitsAreaKey(undefined)).toBe(false);
  });
});

describe("save — the entry, its answer landed on its own habit", () => {
  it("puts the answer for the habit and day, lands the day and week it answers on that habit alone, and refreshes the Journey and the home day", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(200, { success: true, data: ANSWER }));
    vi.stubGlobal("fetch", fetchMock);

    await entries().save(water, { value: 3.2 });

    // The write.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/client/habits/h-water/days/${DATE}`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ value: 3.2 });

    // The day read as it now stands, changed in place: no read of the day follows.
    expect(dayUpdates().length).toBeGreaterThan(0);
    dayUpdates().forEach((call) => expect(call[2]).toEqual({ revalidate: false }));
    expect(shownHabit(0)).toMatchObject({ day: ANSWER.day, week: ANSWER.week, words: { week: "3 of 7" } });
    // The other habit is as it was.
    expect(shownHabit(1)).toBe(walk);

    // Then the rest of the area and the home day.
    const refreshed = refreshes().map((call) => call[0]);
    expect(refreshed).toContain(clientDaySummaryKey(DATE));
    const areaMatcher = refreshed.find((arg) => typeof arg === "function") as (key: unknown) => boolean;
    expect(areaMatcher(clientHabitProgressKey(8))).toBe(true);
    expect(areaMatcher(DAY_KEY)).toBe(false);
  });

  it("shows the entry at once, judged by the kernel, keeping the day's note, before the save answers", async () => {
    const noted = { ...walk, day: { ...walk.day, entry: { done: false, value: null, note: "Rain" } } };
    showDay({ ...DAY, data: { ...DAY.data, habits: [water, noted] } });
    const { answer } = holdFetch();

    const saving = entries().save(noted, { done: true });

    expect(shownHabit(1)?.day).toMatchObject({ entry: { done: true, value: null, note: "Rain" }, met: true });
    expect(shownHabit(0)).toBe(water);
    // Nothing is refreshed while the write is in flight.
    expect(refreshes()).toEqual([]);

    answer(respond(200, { success: true, data: { day: { ...noted.day, entry: { done: true, value: null, note: "Rain" }, met: true }, week: ANSWER.week } }));
    await saving;
  });

  it("throws the server's sentence and status on a refusal, puts that habit back as it was, and refreshes nothing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(403, { success: false, error: "This day is locked." })));

    const failure = await entries().save(walk, { done: true }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(HabitEntryError);
    expect(failure).toMatchObject({ message: "This day is locked.", status: 403 });
    // The tick rolls back: the habit is the item it was when the write began.
    expect(shownHabit(1)).toBe(walk);
    expect(shownHabit(0)).toBe(water);
    expect(refreshes()).toEqual([]);
  });

  it("puts that habit back and throws what fetch threw when the request gets no answer, so the page can tell it from a refusal", async () => {
    const offline = new TypeError("Failed to fetch");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(offline));

    const failure = await entries().save(walk, { done: true }).catch((error: unknown) => error);

    expect(failure).toBe(offline);
    expect(failure).not.toBeInstanceOf(HabitEntryError);
    expect(shownHabit(1)).toBe(walk);
    expect(refreshes()).toEqual([]);
  });

  it("keeps the change when the server saved it but could not read the day back, reads the day again, and refreshes around, with no error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(200, { success: true, data: null })));

    await expect(entries().save(walk, { done: true })).resolves.toBeUndefined();

    expect(shownHabit(1)?.day).toMatchObject({ entry: { done: true, value: null, note: null }, met: true });
    const refreshed = refreshes().map((call) => call.slice(0, 2));
    // The day read again: a plain `mutate(key)`, no data.
    expect(refreshed).toContainEqual([DAY_KEY]);
    expect(refreshed.map((call) => call[0])).toContain(clientDaySummaryKey(DATE));
    const areaMatcher = refreshed.map((call) => call[0]).find((arg) => typeof arg === "function") as (key: unknown) => boolean;
    expect(areaMatcher(clientHabitProgressKey(8))).toBe(true);
  });
});

describe("clear — the entry removed", () => {
  const logged: ClientHabitDayItem = {
    ...water,
    day: { ...water.day, entry: { done: null, value: 3.2, note: null }, met: true },
    week: { ...water.week, done: 3, met: 3 },
    words: { ...water.words, week: "3 of 7" },
  };
  const cleared: HabitEntryResult = {
    day: { ...water.day, entry: null, met: false },
    week: { ...water.week, done: 2, met: 2 },
  };

  it("deletes the entry and lands the day and week it answers", async () => {
    showDay({ ...DAY, data: { ...DAY.data, habits: [logged, walk] } });
    const { fetchMock, answer } = holdFetch();

    const clearing = entries().clear(logged);

    // The frame while the delete is in flight: the entry gone and the day no
    // longer met, so no "Done" stays beside the box the client emptied.
    expect(shownHabit(0)?.day).toMatchObject({ entry: null, met: false });
    expect(shownHabit(1)).toBe(walk);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect([url, init.method, init.body]).toEqual([`/api/client/habits/h-water/days/${DATE}`, "DELETE", undefined]);

    answer(respond(200, { success: true, data: cleared }));
    await clearing;

    dayUpdates().forEach((call) => expect(call[2]).toEqual({ revalidate: false }));
    expect(shownHabit(0)).toMatchObject({ day: { entry: null, met: false }, week: cleared.week, words: { week: "2 of 7" } });
    expect(shownHabit(1)).toBe(walk);
    expect(refreshes().map((call) => call[0])).toContain(clientDaySummaryKey(DATE));
  });

  it("puts the entry back on a refusal", async () => {
    showDay({ ...DAY, data: { ...DAY.data, habits: [logged, walk] } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(403, { success: false, error: "This day is locked." })));

    const failure = await entries().clear(logged).catch((error: unknown) => error);

    expect(failure).toMatchObject({ message: "This day is locked.", status: 403 });
    expect(shownHabit(0)).toBe(logged);
    expect(refreshes()).toEqual([]);
  });

  it("keeps the box empty when the server cleared it but could not read the day back, and reads the day again", async () => {
    showDay({ ...DAY, data: { ...DAY.data, habits: [logged, walk] } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(200, { success: true, data: null })));

    await expect(entries().clear(logged)).resolves.toBeUndefined();

    expect(shownHabit(0)?.day).toMatchObject({ entry: null, met: false });
    expect(refreshes().map((call) => call.slice(0, 2))).toContainEqual([DAY_KEY]);
    expect(refreshes().map((call) => call[0])).toContain(clientDaySummaryKey(DATE));
  });
});
