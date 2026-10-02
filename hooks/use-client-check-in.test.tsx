import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig, type Cache } from "swr";
import type { ReactNode } from "react";

import { useClientCheckIn } from "./use-client-check-in";
import { checkInHabitWeekKey } from "./use-check-in-habit-week";
import { useHabitEntryLine } from "./use-client-habit-entries";
import type { ClientHabitWeek } from "@/types/habits";

// The check-in context read, and the habit week it hands the Habits step: on
// every visit the step's first answer is the week this visit read, never a
// week cached from an earlier visit in the same tab, and never one read
// before a habit entry on its way had its answer.

// One user for every render, as the auth context holds it: a new object each
// render would read the context again on every render.
const { authUser } = vi.hoisted(() => ({ authUser: { id: "user-1" } }));
vi.mock("@/contexts/auth-context", () => ({ useAuth: () => ({ user: authUser }) }));

const week = (done: number): ClientHabitWeek => ({
  start: "2026-09-26",
  end: "2026-10-02",
  dates: ["2026-09-26"],
  habits: [
    {
      habit: { id: "walk", name: "Walk", howTo: null, measure: "tick", unit: null, direction: null },
      words: { schedule: "Every day", target: null },
      days: [],
      figures: { planned: 7, done, met: done },
    },
  ],
  totals: { planned: 7, done, met: done },
});

let context: Record<string, unknown>;

beforeEach(() => {
  context = { clientInfo: { id: "client-1", name: "Alex", email: "a@x.com", coachName: "Coach" }, habitWeek: week(3) };
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ success: true, data: context }), { status: 200 })))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderWith<T>(cache: Cache, hook: () => T) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SWRConfig value={{ provider: () => cache }}>{children}</SWRConfig>
  );
  return renderHook(hook, { wrapper });
}

describe("useClientCheckIn — the habit week the Habits step opens on", () => {
  it("puts this visit's habit week in the cache, over a week an earlier visit left there", async () => {
    const cache: Cache = new Map();
    const key = checkInHabitWeekKey("2026-09-26", "2026-10-02");
    cache.set(key, { data: { success: true, data: week(1) } });

    const view = renderWith(cache, useClientCheckIn);
    await waitFor(() => expect(view.result.current.contextData).not.toBeNull());

    expect((cache.get(key)?.data as { data: ClientHabitWeek }).data).toEqual(week(3));
  });

  it("reads the context only once every habit entry on its way has its answer, so the week it lays in holds them", async () => {
    const cache: Cache = new Map();
    // A tick made on the step on the last visit, still on its way.
    let answer: () => void = () => {};
    const line = renderWith(cache, useHabitEntryLine).result.current;
    void line(
      "walk",
      () =>
        new Promise<void>((resolve) => {
          answer = resolve;
        })
    );

    const view = renderWith(cache, useClientCheckIn);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(view.result.current.isLoadingContext).toBe(true);

    act(() => answer());
    await waitFor(() => expect(view.result.current.contextData).not.toBeNull());
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("puts nothing in the cache for a context with no habit week", async () => {
    delete context.habitWeek;
    const cache: Cache = new Map();

    const view = renderWith(cache, useClientCheckIn);
    await waitFor(() => expect(view.result.current.contextData).not.toBeNull());

    expect([...cache.keys()].some((key) => key.startsWith("/api/client/habits/"))).toBe(false);
  });
});
