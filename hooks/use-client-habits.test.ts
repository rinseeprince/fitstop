import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const { mutate, boundMutate, clearOverview, clearAdherence, clearFeed, clearReadiness, swr } = vi.hoisted(() => {
  const boundMutate = vi.fn();
  return {
    mutate: vi.fn(),
    // The mutate SWR binds to the key a reader subscribed with.
    boundMutate,
    clearOverview: vi.fn(),
    clearAdherence: vi.fn(),
    clearFeed: vi.fn(),
    clearReadiness: vi.fn(),
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

import {
  clientHabitsKey,
  clientHabitWeekKey,
  HabitRequestError,
  isClientHabitReadBesideList,
  isClientHabitWeekKey,
  useClearClientHabitWeeks,
  useClientHabitList,
  useClientHabitWeek,
  useHabitWrites,
} from "./use-client-habits";
import type { CoachHabitList } from "@/types/habits";

const LIST: CoachHabitList = { clientToday: "2026-09-30", habits: [] };
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

const writes = () => renderHook(() => useHabitWrites("client-7")).result.current;

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("the keys", () => {
  it("reads the list and the weeks under the client's habit area, the week holding today with no start", () => {
    expect(clientHabitsKey("c1")).toBe("/api/clients/c1/habits");
    expect(clientHabitWeekKey("c1", null)).toBe("/api/clients/c1/habits/week");
    expect(clientHabitWeekKey("c1", "2026-09-17")).toBe("/api/clients/c1/habits/week?start=2026-09-17");
  });

  it("the readers subscribe with exactly those keys", () => {
    renderHook(() => useClientHabitList("c1"));
    renderHook(() => useClientHabitWeek("c1", "2026-09-17"));
    expect(swr.mock.calls.map((call) => call[0])).toEqual([
      "/api/clients/c1/habits",
      "/api/clients/c1/habits/week?start=2026-09-17",
    ]);
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

describe("each write goes to its route and answers with the habits as they now stand", () => {
  it("add, rename, change, stop, delete and order", async () => {
    const fetchMock = stubFetch(
      respond(200, { success: true, data: { habitIds: ["h1"], habits: LIST } }),
      ...Array.from({ length: 5 }, () => respond(200, { success: true, data: { changed: true, habits: LIST } }))
    );
    const api = writes();
    const water = { name: "Water", howTo: null, measure: "number" as const, unit: "L", direction: "at_least" as const, target: 3, weekdays: ["monday" as const] };

    expect(await api.add([water])).toEqual({ habitIds: ["h1"], habits: LIST });
    await api.rename(HABIT, "Water", "A glass with each meal");
    await api.change(HABIT, { target: 3.5, weekdays: ["monday"] });
    await api.stop(HABIT);
    await api.remove(HABIT);
    await api.order([HABIT]);

    expect(sent(fetchMock, 0)).toEqual({ url: "/api/clients/client-7/habits", method: "POST", body: { habits: [water] } });
    expect(sent(fetchMock, 1)).toEqual({
      url: `/api/clients/client-7/habits/${HABIT}`,
      method: "PATCH",
      body: { name: "Water", howTo: "A glass with each meal" },
    });
    expect(sent(fetchMock, 2)).toEqual({
      url: `/api/clients/client-7/habits/${HABIT}/change`,
      method: "POST",
      body: { target: 3.5, weekdays: ["monday"] },
    });
    expect(sent(fetchMock, 3)).toEqual({ url: `/api/clients/client-7/habits/${HABIT}/stop`, method: "POST", body: {} });
    expect(sent(fetchMock, 4)).toEqual({ url: `/api/clients/client-7/habits/${HABIT}`, method: "DELETE", body: undefined });
    expect(sent(fetchMock, 5)).toEqual({ url: "/api/clients/client-7/habits/order", method: "PUT", body: { habitIds: [HABIT] } });
  });

  it("adds from a later day when one is given", async () => {
    const fetchMock = stubFetch(respond(200, { success: true, data: { habitIds: [], habits: LIST } }));
    await writes().add([], "2026-10-05");
    expect(sent(fetchMock).body).toEqual({ habits: [], startsOn: "2026-10-05" });
  });

  it("answers with no list, never a failure, when the write saved but the habits could not be read back", async () => {
    stubFetch(
      respond(200, { success: true, data: { habitIds: ["h1"], habits: null } }),
      respond(200, { success: true, data: { changed: true, habits: null } })
    );
    const api = writes();
    expect(await api.add([])).toEqual({ habitIds: ["h1"], habits: null });
    expect(await api.stop(HABIT)).toEqual({ changed: true, habits: null });
  });

  it("lands nothing by itself: the caller lands the answer as it closes what the write was made in", async () => {
    stubFetch(respond(200, { success: true, data: { changed: true, habits: LIST } }));
    await writes().stop(HABIT);
    expect(mutate).not.toHaveBeenCalled();
    expect(clearOverview).not.toHaveBeenCalled();
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

describe("land — the answer seeded, every read it changed cleared", () => {
  it("seeds the list and clears the weeks, the adherence row, the Overview, the feed and the activation card", () => {
    writes().land(LIST);

    // The list: the answer itself, never refetched.
    expect(mutate).toHaveBeenCalledWith(clientHabitsKey("client-7"), { success: true, data: LIST }, { revalidate: false });
    // Every other habit read: cleared, then refetched — its figures are definite answers.
    const [matcher, data, options] = mutate.mock.calls[1] as [(key: unknown) => boolean, unknown, unknown];
    expect(matcher(clientHabitWeekKey("client-7", null))).toBe(true);
    expect(matcher(clientHabitsKey("client-7"))).toBe(false);
    expect(data).toBeUndefined();
    expect(options).toEqual({ revalidate: true });
    expect(clearAdherence).toHaveBeenCalledWith("client-7");
    expect(clearOverview).toHaveBeenCalledWith("client-7");
    expect(clearFeed).toHaveBeenCalledTimes(1);
    expect(clearReadiness).toHaveBeenCalledWith("client-7");
  });

  // A write saved without its list read back: the list is merely old, so it
  // is refetched in place — never cleared, which would unmount the drawer
  // that renders only while the list exists — and every other read is cleared
  // exactly as for any other answer.
  it("with no list, refetches the list in place without clearing it, and clears every other read as ever", () => {
    writes().land(null);

    expect(mutate.mock.calls[0]).toEqual([clientHabitsKey("client-7")]);
    expect(mutate.mock.calls.filter(([key]) => key === clientHabitsKey("client-7"))).toHaveLength(1);
    const [matcher, data, options] = mutate.mock.calls[1] as [(key: unknown) => boolean, unknown, unknown];
    expect(matcher(clientHabitWeekKey("client-7", "2026-09-17"))).toBe(true);
    expect(matcher(clientHabitsKey("client-7"))).toBe(false);
    expect(data).toBeUndefined();
    expect(options).toEqual({ revalidate: true });
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(clearAdherence).toHaveBeenCalledWith("client-7");
    expect(clearOverview).toHaveBeenCalledWith("client-7");
    expect(clearFeed).toHaveBeenCalledTimes(1);
    expect(clearReadiness).toHaveBeenCalledWith("client-7");
  });
});

/**
 * Every coach habit write goes through `useHabitWrites`, so each one lands its
 * answer and clears the Overview, its adherence row, the feed and the
 * activation card (CONVENTIONS §7: the area that owes the clear is the one
 * that READS what was written). Derived from the tree, never a list: a screen
 * that writes a coach habit route by itself fails here.
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
