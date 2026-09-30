import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";

import { clientHabitDayKey, HabitEntryError, useClientHabitDay, useHabitEntryWrites } from "./use-client-portal-habits";
import type { ClientHabitDay, ClientHabitDayItem, HabitEntryResult } from "@/types/habits";

// Real SWR: the habits page shows two habits, and the client ticks the second
// before the first one's save has answered. The page keeps a habit's own row
// busy while its write is in flight, so writes on ONE habit never overlap;
// writes on two habits do, and each must keep its own change and its own
// answer whatever order the answers come back in.

const DATE = "2026-09-29";
const WEEK = { start: "2026-09-24", end: "2026-09-30" };

function tickHabit(id: string, name: string): ClientHabitDayItem {
  return {
    habit: { id, name, howTo: null, measure: "tick", unit: null, direction: null },
    day: { date: DATE, covered: true, planned: true, target: null, edited: false, versionId: `${id}-v`, timesPerWeek: null, entry: null, met: false },
    week: { planned: 7, done: 2, met: 2, ...WEEK },
    words: { schedule: "Every day", target: null, week: "2 of 7" },
  };
}

const stretch = tickHabit("h-stretch", "Stretch");
const walk = tickHabit("h-walk", "Walk");

/** What the server answers once a habit's tick is saved: the day done, the week one further on. */
function ticked(item: ClientHabitDayItem): HabitEntryResult {
  return {
    day: { ...item.day, entry: { done: true, value: null, note: null }, met: true },
    week: { planned: 7, done: 3, met: 3, ...WEEK },
  };
}

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Each entry write, held until the test answers it. */
type Pending = { habitId: string; answer: (status: number, body: unknown) => void };
let pending: Pending[] = [];

function wrapper({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>;
}

beforeEach(() => {
  pending = [];
  const day: ClientHabitDay = { date: DATE, habits: [stretch, walk] };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      // The day read answers at once; every entry write waits for the test.
      if (!init?.method || init.method === "GET") {
        return Promise.resolve(
          url === clientHabitDayKey(DATE) ? reply(200, { success: true, data: day }) : reply(404, { success: false })
        );
      }
      return new Promise<Response>((resolve) => {
        pending.push({ habitId: url.split("/")[4], answer: (status, body) => resolve(reply(status, body)) });
      });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The page's two hooks, rendered together over one cache, the day loaded. */
async function renderPage() {
  const { result } = renderHook(() => ({ day: useClientHabitDay(DATE), entries: useHabitEntryWrites(DATE) }), { wrapper });
  await waitFor(() => expect(result.current.day.day).not.toBeNull());
  return result;
}

type Page = Awaited<ReturnType<typeof renderPage>>;

/** Each habit as the page shows it: ticked or not, and its week in words. */
function shown(result: Page) {
  return Object.fromEntries(
    (result.current.day.day?.habits ?? []).map((item) => [item.habit.name, { ticked: item.day.entry?.done === true, week: item.words.week }])
  );
}

/** Ticks Stretch, then Walk before Stretch's save has answered; each write settles to its error, or undefined. */
async function tickBoth(result: Page) {
  const writes: Promise<unknown>[] = [];
  act(() => {
    writes.push(result.current.entries.save(stretch, { done: true }).catch((error: unknown) => error));
  });
  act(() => {
    writes.push(result.current.entries.save(walk, { done: true }).catch((error: unknown) => error));
  });
  await waitFor(() => expect(pending.map((write) => write.habitId)).toEqual(["h-stretch", "h-walk"]));
  // Both show at once, before either save has answered.
  expect(shown(result)).toEqual({ Stretch: { ticked: true, week: "2 of 7" }, Walk: { ticked: true, week: "2 of 7" } });
  return writes;
}

describe("two habits ticked before the first save answers", () => {
  it("keeps both ticks when the first answer lands first", async () => {
    const result = await renderPage();
    const writes = await tickBoth(result);

    pending[0].answer(200, { success: true, data: ticked(stretch) });
    await waitFor(() =>
      expect(shown(result)).toEqual({ Stretch: { ticked: true, week: "3 of 7" }, Walk: { ticked: true, week: "2 of 7" } })
    );

    pending[1].answer(200, { success: true, data: ticked(walk) });
    expect(await Promise.all(writes)).toEqual([undefined, undefined]);
    await waitFor(() =>
      expect(shown(result)).toEqual({ Stretch: { ticked: true, week: "3 of 7" }, Walk: { ticked: true, week: "3 of 7" } })
    );
  });

  it("keeps both ticks when the second answer lands first", async () => {
    const result = await renderPage();
    const writes = await tickBoth(result);

    pending[1].answer(200, { success: true, data: ticked(walk) });
    await waitFor(() =>
      expect(shown(result)).toEqual({ Stretch: { ticked: true, week: "2 of 7" }, Walk: { ticked: true, week: "3 of 7" } })
    );

    pending[0].answer(200, { success: true, data: ticked(stretch) });
    expect(await Promise.all(writes)).toEqual([undefined, undefined]);
    await waitFor(() =>
      expect(shown(result)).toEqual({ Stretch: { ticked: true, week: "3 of 7" }, Walk: { ticked: true, week: "3 of 7" } })
    );
  });

  it("puts back only the refused habit: the other keeps its tick, in flight and once answered", async () => {
    const result = await renderPage();
    const writes = await tickBoth(result);

    pending[1].answer(409, { success: false, error: "That habit isn't running on that day." });
    await waitFor(() =>
      expect(shown(result)).toEqual({ Stretch: { ticked: true, week: "2 of 7" }, Walk: { ticked: false, week: "2 of 7" } })
    );

    pending[0].answer(200, { success: true, data: ticked(stretch) });
    const [stretchWrite, walkWrite] = await Promise.all(writes);
    await waitFor(() =>
      expect(shown(result)).toEqual({ Stretch: { ticked: true, week: "3 of 7" }, Walk: { ticked: false, week: "2 of 7" } })
    );
    // The refusal reaches the page with the server's sentence; the saved tick throws nothing.
    expect(stretchWrite).toBeUndefined();
    expect(walkWrite).toBeInstanceOf(HabitEntryError);
    expect(walkWrite).toMatchObject({ message: "That habit isn't running on that day.", status: 409 });
  });

  it("puts back only the refused habit when it was ticked first: the later tick stays", async () => {
    const result = await renderPage();
    const writes = await tickBoth(result);

    pending[0].answer(403, { success: false, error: "This day is locked." });
    await waitFor(() =>
      expect(shown(result)).toEqual({ Stretch: { ticked: false, week: "2 of 7" }, Walk: { ticked: true, week: "2 of 7" } })
    );

    pending[1].answer(200, { success: true, data: ticked(walk) });
    const [stretchWrite, walkWrite] = await Promise.all(writes);
    await waitFor(() =>
      expect(shown(result)).toEqual({ Stretch: { ticked: false, week: "2 of 7" }, Walk: { ticked: true, week: "3 of 7" } })
    );
    expect(stretchWrite).toMatchObject({ message: "This day is locked.", status: 403 });
    expect(walkWrite).toBeUndefined();
  });
});
