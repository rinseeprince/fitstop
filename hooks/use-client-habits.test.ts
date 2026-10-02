import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const { mutate, boundMutate, clearOverview, clearAdherence, clearFeed, clearReadiness, clearGoalHistory, swr } = vi.hoisted(() => {
  const boundMutate = vi.fn();
  return {
    mutate: vi.fn(),
    // The mutate SWR binds to the key a reader subscribed with.
    boundMutate,
    clearOverview: vi.fn(),
    clearAdherence: vi.fn(),
    clearFeed: vi.fn(),
    clearReadiness: vi.fn(),
    clearGoalHistory: vi.fn(),
    swr: vi.fn((..._args: unknown[]) => ({ data: undefined, error: undefined, isLoading: false, mutate: boundMutate })),
  };
});
vi.mock("swr", () => ({
  __esModule: true,
  default: (...args: unknown[]) => swr(...args),
  useSWRConfig: () => ({ mutate }),
}));
vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));
vi.mock("@/hooks/use-client-overview", () => ({ useClearClientOverview: () => clearOverview }));
vi.mock("@/hooks/use-client-adherence", () => ({ useClearClientAdherence: () => clearAdherence }));
vi.mock("@/hooks/use-attention-feed", () => ({ useClearAttentionFeed: () => clearFeed }));
vi.mock("@/hooks/use-activation-readiness", () => ({ useClearActivationReadiness: () => clearReadiness }));
vi.mock("@/hooks/use-client-goals", () => ({ useClearClientGoalHistory: () => clearGoalHistory }));

import {
  clientHabitChoicesKey,
  clientHabitsKey,
  clientHabitWeekKey,
  HabitRequestError,
  isClientHabitReadBesideList,
  isClientHabitWeekKey,
  useClearClientHabitWeeks,
  useClientHabitChoices,
  useClientHabitList,
  useClientHabitWeek,
  useHabitWrites,
} from "./use-client-habits";
import type { CoachHabitList, CoachHabitWeek } from "@/types/habits";

const LIST: CoachHabitList = { clientToday: "2026-09-30", habits: [] };
const WEEK: CoachHabitWeek = {
  clientToday: "2026-09-30",
  start: "2026-09-17",
  end: "2026-09-23",
  dates: [],
  habits: [],
  totals: { planned: 0, done: 0, met: 0 },
  today: null,
};
const HABIT = "7c1a4d8e-2f3b-4c5d-8e9f-0a1b2c3d4e5f";

function respond(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response;
}

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const sent = (fetchMock: ReturnType<typeof vi.fn>, call = 0) => {
  const [url, init] = fetchMock.mock.calls[call] as [string, RequestInit];
  return { url, method: init.method, body: init.body ? JSON.parse(init.body as string) : undefined };
};

/** The writes of the tab showing the client's current week, or the week starting `weekStart`. */
const writes = (weekStart: string | null = null) => renderHook(() => useHabitWrites("client-7", weekStart)).result.current;

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("the keys", () => {
  it("reads the list, the weeks and the choices under the client's habit area, the week holding today with no start", () => {
    expect(clientHabitsKey("c1")).toBe("/api/clients/c1/habits");
    expect(clientHabitWeekKey("c1", null)).toBe("/api/clients/c1/habits/week");
    expect(clientHabitWeekKey("c1", "2026-09-17")).toBe("/api/clients/c1/habits/week?start=2026-09-17");
    expect(clientHabitChoicesKey("c1")).toBe("/api/clients/c1/habits/choices");
  });

  it("the readers subscribe with exactly those keys", () => {
    renderHook(() => useClientHabitList("c1"));
    renderHook(() => useClientHabitWeek("c1", "2026-09-17"));
    renderHook(() => useClientHabitChoices("c1", true));
    expect(swr.mock.calls.map((call) => call[0])).toEqual([
      "/api/clients/c1/habits",
      "/api/clients/c1/habits/week?start=2026-09-17",
      "/api/clients/c1/habits/choices",
    ]);
  });

  // The choices are the Add habits sheet's alone: nothing reads them while it
  // is shut, and the closing sheet keeps the list it showed.
  it("reads the choices only while the sheet is open, keeping the list shown through the close", () => {
    renderHook(() => useClientHabitChoices("c1", false));
    expect(swr.mock.calls.map((call) => call[0])).toEqual([null]);
    expect(swr.mock.calls[0][2]).toMatchObject({ keepPreviousData: true });
  });

  // The client writes a week's entries in their own browser, which no
  // invalidator here reaches: the week is read again on the coach's return.
  it("reads a week again when the coach comes back to the page, and the list only on its own writes", () => {
    renderHook(() => useClientHabitWeek("c1", null));
    renderHook(() => useClientHabitList("c1"));
    expect(swr.mock.calls[0][2]).toMatchObject({ revalidateOnFocus: true });
    expect(swr.mock.calls[1][2]).toMatchObject({ revalidateOnFocus: false });
  });

  it("the list is read again on a retry", () => {
    renderHook(() => useClientHabitList("c1")).result.current.retry();
    expect(boundMutate).toHaveBeenCalledTimes(1);
    expect(boundMutate).toHaveBeenCalledWith();
  });

  it("the weeks are every week read of the client, whatever its start, and nothing else", () => {
    const weeks = isClientHabitWeekKey("c1");
    expect(weeks(clientHabitWeekKey("c1", null))).toBe(true);
    expect(weeks(clientHabitWeekKey("c1", "2026-09-17"))).toBe(true);
    expect(weeks(clientHabitsKey("c1"))).toBe(false);
    expect(weeks("/api/clients/c1/habits/choices")).toBe(false);
    expect(weeks(clientHabitWeekKey("c12", null))).toBe(false);
    expect(weeks("/api/clients/c1/habits/weekly")).toBe(false);
    expect(weeks(undefined)).toBe(false);
  });

  it("clears the client's weeks, then refetches them, for a write that moves the week without writing a habit", () => {
    void renderHook(() => useClearClientHabitWeeks()).result.current("c1");
    const [matcher, data, options] = mutate.mock.calls[0] as [(key: unknown) => boolean, unknown, unknown];
    expect(matcher(clientHabitWeekKey("c1", "2026-09-17"))).toBe(true);
    expect(matcher(clientHabitsKey("c1"))).toBe(false);
    expect(data).toBeUndefined();
    expect(options).toEqual({ revalidate: true });
  });

  it("the reads beside the list are every other key under the area, never the list or another client's", () => {
    const beside = isClientHabitReadBesideList("c1");
    expect(beside(clientHabitWeekKey("c1", null))).toBe(true);
    expect(beside(clientHabitWeekKey("c1", "2026-09-17"))).toBe(true);
    expect(beside("/api/clients/c1/habits/choices")).toBe(true);
    expect(beside(clientHabitsKey("c1"))).toBe(false);
    expect(beside(clientHabitWeekKey("c2", null))).toBe(false);
    expect(beside("/api/clients/c1/adherence?days=14")).toBe(false);
    expect(beside(undefined)).toBe(false);
  });
});

describe("each write goes to its route and answers with the habits and the week as they now stand", () => {
  it("add, rename, change, stop, delete, order, a one-date edit and its reset, each naming the week on screen", async () => {
    const fetchMock = stubFetch(
      respond(200, { success: true, data: { habitIds: ["h1"], habits: LIST, week: WEEK } }),
      ...Array.from({ length: 7 }, () => respond(200, { success: true, data: { changed: true, habits: LIST, week: WEEK } }))
    );
    const api = writes("2026-09-17");
    const water = { name: "Water", howTo: null, measure: "number" as const, unit: "L", direction: "at_least" as const, target: 3, weekdays: ["monday" as const] };

    // Each answer carries the week it named, so it lands under that week's key.
    expect(await api.add([water])).toEqual({ habitIds: ["h1"], habits: LIST, week: WEEK, weekStart: "2026-09-17" });
    await api.rename(HABIT, "Water", "A glass with each meal");
    await api.change(HABIT, { target: 3.5, weekdays: ["monday"] });
    await api.stop(HABIT);
    await api.remove(HABIT);
    await api.order([HABIT]);
    expect(await api.setDay(HABIT, "2026-10-07", { planned: true, target: 2.5 })).toEqual({
      changed: true,
      habits: LIST,
      week: WEEK,
      weekStart: "2026-09-17",
    });
    await api.resetDay(HABIT, "2026-10-07");

    const week = "?week=2026-09-17";
    expect(sent(fetchMock, 0)).toEqual({ url: `/api/clients/client-7/habits${week}`, method: "POST", body: { habits: [water] } });
    expect(sent(fetchMock, 1)).toEqual({
      url: `/api/clients/client-7/habits/${HABIT}${week}`,
      method: "PATCH",
      body: { name: "Water", howTo: "A glass with each meal" },
    });
    expect(sent(fetchMock, 2)).toEqual({
      url: `/api/clients/client-7/habits/${HABIT}/change${week}`,
      method: "POST",
      body: { target: 3.5, weekdays: ["monday"] },
    });
    expect(sent(fetchMock, 3)).toEqual({ url: `/api/clients/client-7/habits/${HABIT}/stop${week}`, method: "POST", body: {} });
    expect(sent(fetchMock, 4)).toEqual({ url: `/api/clients/client-7/habits/${HABIT}${week}`, method: "DELETE", body: undefined });
    expect(sent(fetchMock, 5)).toEqual({ url: `/api/clients/client-7/habits/order${week}`, method: "PUT", body: { habitIds: [HABIT] } });
    expect(sent(fetchMock, 6)).toEqual({
      url: `/api/clients/client-7/habits/${HABIT}/days/2026-10-07${week}`,
      method: "PUT",
      body: { planned: true, target: 2.5 },
    });
    expect(sent(fetchMock, 7)).toEqual({
      url: `/api/clients/client-7/habits/${HABIT}/days/2026-10-07${week}`,
      method: "DELETE",
      body: undefined,
    });
  });

  it("names no week on the client's current week, and its answers say so", async () => {
    const fetchMock = stubFetch(respond(200, { success: true, data: { changed: true, habits: LIST, week: WEEK } }));
    expect(await writes(null).stop(HABIT)).toEqual({ changed: true, habits: LIST, week: WEEK, weekStart: null });
    expect(sent(fetchMock).url).toBe(`/api/clients/client-7/habits/${HABIT}/stop`);
  });

  it("adds from a later day, stops from a later day, and takes a day off with no target", async () => {
    const fetchMock = stubFetch(
      respond(200, { success: true, data: { habitIds: [], habits: LIST, week: WEEK } }),
      respond(200, { success: true, data: { changed: true, habits: LIST, week: WEEK } }),
      respond(200, { success: true, data: { changed: true, habits: LIST, week: WEEK } })
    );
    const api = writes();
    await api.add([], "2026-10-05");
    await api.stop(HABIT, "2026-10-12");
    await api.setDay(HABIT, "2026-10-07", { planned: false, target: null });
    expect(sent(fetchMock, 0).body).toEqual({ habits: [], startsOn: "2026-10-05" });
    expect(sent(fetchMock, 1).body).toEqual({ stopsOn: "2026-10-12" });
    expect(sent(fetchMock, 2).body).toEqual({ planned: false });
  });

  it("answers with neither, never a failure, when the write saved but the habits and the week could not be read back", async () => {
    stubFetch(
      respond(200, { success: true, data: { habitIds: ["h1"], habits: null, week: null } }),
      respond(200, { success: true, data: { changed: true, habits: null, week: null } })
    );
    const api = writes();
    expect(await api.add([])).toEqual({ habitIds: ["h1"], habits: null, week: null, weekStart: null });
    expect(await api.stop(HABIT)).toEqual({ changed: true, habits: null, week: null, weekStart: null });
  });

  it("lands nothing by itself: the caller lands the answer as it closes what the write was made in", async () => {
    stubFetch(respond(200, { success: true, data: { changed: true, habits: LIST, week: WEEK } }));
    await writes().stop(HABIT);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("throws the server's sentence and its status on a refusal", async () => {
    stubFetch(respond(409, { success: false, error: "Pick today or a later day to stop from.", code: "stops_in_past" }));
    const failure = await writes().stop(HABIT).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HabitRequestError);
    expect(failure).toMatchObject({ message: "Pick today or a later day to stop from.", status: 409 });
  });

  it("says something went wrong when the answer carries no sentence", async () => {
    stubFetch({ ok: false, status: 500, json: () => Promise.reject(new Error("not json")) } as Response);
    await expect(writes().stop(HABIT)).rejects.toMatchObject({ message: "Something went wrong. Try again.", status: 500 });
  });
});

/**
 * The reads on other screens a habit write changes — the Overview (its Needs
 * attention rows), its adherence row, the dashboard feed, the activation card
 * and the Journey's goals table — are cleared by the write itself as its
 * answer arrives, never left to its caller: a screen that saved a habit and
 * forgot to land the answer would otherwise leave every one of them stale.
 */
describe("a saved write clears the reads on other screens as its answer arrives", () => {
  const clearsElsewhere = (times: number) => {
    expect(clearAdherence).toHaveBeenCalledTimes(times);
    expect(clearOverview).toHaveBeenCalledTimes(times);
    expect(clearFeed).toHaveBeenCalledTimes(times);
    expect(clearReadiness).toHaveBeenCalledTimes(times);
    expect(clearGoalHistory).toHaveBeenCalledTimes(times);
    if (times > 0) {
      for (const clear of [clearAdherence, clearOverview, clearReadiness, clearGoalHistory]) {
        expect(clear).toHaveBeenCalledWith("client-7");
      }
    }
  };

  it("clears them when the write changed something, before anything is landed", async () => {
    stubFetch(respond(200, { success: true, data: { changed: true, habits: LIST, week: WEEK } }));
    await writes().stop(HABIT);
    clearsElsewhere(1);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("clears them on an add, which always changes something", async () => {
    stubFetch(respond(200, { success: true, data: { habitIds: ["h1"], habits: LIST, week: WEEK } }));
    await writes().add([]);
    clearsElsewhere(1);
  });

  // Saved, its habits not read back: still a change.
  it("clears them when the write saved without its habits and week read back", async () => {
    stubFetch(respond(200, { success: true, data: { changed: true, habits: null, week: null } }));
    await writes().remove(HABIT);
    clearsElsewhere(1);
  });

  // A stop dated after the stop already scheduled, a change to what the habit
  // already has: no other read moved.
  it("clears none when the write changed nothing, its answer read back or not", async () => {
    stubFetch(
      respond(200, { success: true, data: { changed: false, habits: LIST, week: WEEK } }),
      respond(200, { success: true, data: { changed: false, habits: null, week: null } })
    );
    await writes().stop(HABIT, "2026-10-12");
    await writes().stop(HABIT, "2026-10-12");
    clearsElsewhere(0);
  });

  it("clears none when the write is refused", async () => {
    stubFetch(respond(409, { success: false, error: "That habit isn't running then.", code: "not_running" }));
    await writes()
      .stop(HABIT)
      .catch(() => undefined);
    clearsElsewhere(0);
  });

  it("leaves them to no caller: landing an answer clears none of them", () => {
    writes().land({ habits: LIST, week: WEEK, currentWeek: null, weekStart: null });
    writes().land({ habits: null, week: null, currentWeek: null, weekStart: null });
    clearsElsewhere(0);
  });
});

describe("land — the answer seeded, every other habit read it changed cleared", () => {
  // The fix CONVENTIONS §7 names for a post-write flash: the write's own answer
  // put in the cache in one tick, so no frame exists between the save and the
  // settled card — never a clear-and-refetch of what is on screen.
  it("seeds the list, the week the write named and the current week in one tick, then clears every other habit read the write changed", () => {
    const current = { ...WEEK, start: "2026-09-24", end: "2026-09-30" };
    writes().land({ habits: LIST, week: WEEK, currentWeek: current, weekStart: "2026-09-17" });

    expect(mutate.mock.calls[0]).toEqual([clientHabitsKey("client-7"), { success: true, data: LIST }, { revalidate: false }]);
    expect(mutate.mock.calls[1]).toEqual([
      clientHabitWeekKey("client-7", "2026-09-17"),
      { success: true, data: WEEK },
      { revalidate: false },
    ]);
    // The summary shows now, read under the current week's key: seeded too.
    expect(mutate.mock.calls[2]).toEqual([clientHabitWeekKey("client-7", null), { success: true, data: current }, { revalidate: false }]);
    // Every other habit read — the other weeks held: cleared, then refetched,
    // as each renders a definite answer. Never a week just seeded.
    const [matcher, data, options] = mutate.mock.calls[3] as [(key: unknown) => boolean, unknown, unknown];
    expect(matcher(clientHabitWeekKey("client-7", "2026-09-17"))).toBe(false);
    expect(matcher(clientHabitWeekKey("client-7", null))).toBe(false);
    expect(matcher(clientHabitWeekKey("client-7", "2026-09-10"))).toBe(true);
    expect(matcher(clientHabitsKey("client-7"))).toBe(false);
    expect(matcher(clientHabitWeekKey("client-8", "2026-09-10"))).toBe(false);
    expect(data).toBeUndefined();
    expect(options).toEqual({ revalidate: true });
    // The choices: cleared and NOT refetched — only the Add habits sheet shows
    // them; it reads them afresh on its next opening, and the closing sheet
    // keeps the list it showed rather than change it as it slides away.
    expect(matcher(clientHabitChoicesKey("client-7"))).toBe(false);
    expect(mutate.mock.calls[4]).toEqual([clientHabitChoicesKey("client-7"), undefined, { revalidate: false }]);
    expect(mutate).toHaveBeenCalledTimes(5);
  });

  it("seeds the client's current week under its own key when the write named none", () => {
    writes().land({ habits: LIST, week: WEEK, currentWeek: null, weekStart: null });
    expect(mutate.mock.calls[1][0]).toBe(clientHabitWeekKey("client-7", null));
    const matcher = mutate.mock.calls[2][0] as (key: unknown) => boolean;
    expect(matcher(clientHabitWeekKey("client-7", null))).toBe(false);
    expect(matcher(clientHabitWeekKey("client-7", "2026-09-17"))).toBe(true);
  });

  // A save that changed nothing — a stop dated after the stop already
  // scheduled, a change to what the habit already has — changed no other read.
  it("with nothing changed, seeds what it answered and clears nothing else", () => {
    writes().land({ changed: false, habits: LIST, week: WEEK, currentWeek: null, weekStart: null });
    expect(mutate).toHaveBeenCalledTimes(2);
  });

  // A write saved without its habits read back: the list is refetched in
  // place — never cleared, since the Add habits sheet and the row dialogs
  // render only while it exists — and every week is cleared, the one on
  // screen included, so it reloads rather than show a figure the write moved.
  it("with none of them, refetches the list in place without clearing it, and clears every week", () => {
    writes().land({ habits: null, week: null, currentWeek: null, weekStart: "2026-09-17" });

    expect(mutate.mock.calls[0]).toEqual([clientHabitsKey("client-7")]);
    expect(mutate.mock.calls.filter(([key]) => key === clientHabitsKey("client-7"))).toHaveLength(1);
    const [matcher, data, options] = mutate.mock.calls[1] as [(key: unknown) => boolean, unknown, unknown];
    expect(matcher(clientHabitWeekKey("client-7", "2026-09-17"))).toBe(true);
    expect(matcher(clientHabitWeekKey("client-7", null))).toBe(true);
    expect(matcher(clientHabitsKey("client-7"))).toBe(false);
    expect(matcher(clientHabitChoicesKey("client-7"))).toBe(false);
    expect(data).toBeUndefined();
    expect(options).toEqual({ revalidate: true });
    expect(mutate.mock.calls[2]).toEqual([clientHabitChoicesKey("client-7"), undefined, { revalidate: false }]);
    expect(mutate).toHaveBeenCalledTimes(3);
  });
});

/**
 * Every coach habit write goes through `useHabitWrites`, whose writes clear
 * the Overview, its adherence row, the feed, the activation card and the goals
 * table as each saved answer arrives (CONVENTIONS §7: the area that owes the
 * clear is the one that READS what was written). Derived from the tree, never
 * a list: a screen that writes a coach habit route by itself fails here.
 */
describe("every coach habit write goes through useHabitWrites", () => {
  const ROOT = join(__dirname, "..");
  const OWNER = "hooks/use-client-habits.ts";
  const COACH_HABIT_ROUTE = /\/api\/clients\/\$\{[^}]+\}\/habits/;
  const WRITE_METHOD = /method:\s*["'`](POST|PUT|PATCH|DELETE)["'`]/;

  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        sourceFiles(full, out);
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        out.push(full);
      }
    }
    return out;
  }

  it("holds across the screens and hooks, and the scan sees the hook it exists for", () => {
    const files = ["app", "components", "hooks"].flatMap((dir) => sourceFiles(join(ROOT, dir)));
    const writers = files
      .map((file) => ({ rel: relative(ROOT, file), src: readFileSync(file, "utf8") }))
      .filter(({ src }) => COACH_HABIT_ROUTE.test(src) || src.includes("clientHabitsKey("))
      .filter(({ src }) => WRITE_METHOD.test(src) || /\bsend</.test(src));

    expect(writers.map((writer) => writer.rel)).toEqual([OWNER]);
  });

  it("recognises what it forbids", () => {
    expect(COACH_HABIT_ROUTE.test("fetch(`/api/clients/${clientId}/habits/${id}/stop`")).toBe(true);
    expect(WRITE_METHOD.test('{ method: "POST" }')).toBe(true);
    expect(COACH_HABIT_ROUTE.test("`/api/client/habits/day?date=${date}`")).toBe(false);
  });
});
