import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const mutateMock = vi.fn();
const swrSubscribeMock = vi.fn((..._args: unknown[]) => ({
  data: undefined,
  error: undefined,
  isLoading: false,
  mutate: vi.fn(),
}));

vi.mock("swr", () => ({
  __esModule: true,
  default: (...args: unknown[]) => swrSubscribeMock(...args),
  useSWRConfig: () => ({ mutate: mutateMock }),
}));

vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

import {
  nutritionGoalForDayKey,
  nutritionOutOfDateKey,
  useClearNutritionGoal,
  useNutritionGoalForDay,
  useNutritionOutOfDate,
} from "./use-nutrition-goal";

beforeEach(() => {
  mutateMock.mockClear();
  swrSubscribeMock.mockClear();
});

describe("the reads of how nutrition follows the goal", () => {
  it("reads the Starts on day under its own key, and nothing before the day is known", () => {
    renderHook(() => useNutritionGoalForDay("c1", "2026-10-19"));
    renderHook(() => useNutritionGoalForDay("c1", null));
    const keys = swrSubscribeMock.mock.calls.map((call) => call[0]);
    expect(keys).toEqual(["/api/clients/c1/nutrition/goal?date=2026-10-19", null]);
  });

  it("reads the out-of-date answer under its own key", () => {
    renderHook(() => useNutritionOutOfDate("c1"));
    expect(swrSubscribeMock.mock.calls[0][0]).toBe("/api/clients/c1/nutrition/goal/out-of-date");
  });
});

describe("useClearNutritionGoal", () => {
  function clear(clientId: string) {
    const { result } = renderHook(() => useClearNutritionGoal());
    void result.current(clientId);
    expect(mutateMock).toHaveBeenCalledTimes(1);
    const [predicate, data, opts] = mutateMock.mock.calls[0];
    return { predicate: predicate as (key: unknown) => boolean, data, opts };
  }

  it("matches both reads of the client — every day read and the out-of-date answer", () => {
    const { predicate } = clear("c1");
    expect(predicate(nutritionGoalForDayKey("c1", "2026-09-23"))).toBe(true);
    expect(predicate(nutritionGoalForDayKey("c1", "2026-10-19"))).toBe(true);
    expect(predicate(nutritionOutOfDateKey("c1"))).toBe(true);
  });

  it("CLEARS rather than revalidates: undefined data, then a refetch", () => {
    // The notice and the Goal line are definite answers ("The goal is now
    // Build …, but the calories still aim for …", "No deadline, so calories
    // are at maintenance"); a stale entry served through the refetch would say
    // something that has just stopped being true.
    const { data, opts } = clear("c1");
    expect(data).toBeUndefined();
    expect(opts).toEqual({ revalidate: true });
  });

  it("rejects other clients and every other nutrition read of the same client", () => {
    const { predicate } = clear("c1");
    expect(predicate(nutritionOutOfDateKey("c10"))).toBe(false);
    expect(predicate(nutritionGoalForDayKey("c2", "2026-09-23"))).toBe(false);
    expect(predicate("/api/clients/c1/nutrition")).toBe(false);
    expect(predicate("/api/clients/c1/nutrition/events?startDate=a&endDate=b")).toBe(false);
    expect(predicate("/api/clients/c1/goals")).toBe(false);
    // Exact-or-child: a key that merely begins with the area's text is another area.
    expect(predicate("/api/clients/c1/nutrition/goals")).toBe(false);
    expect(predicate(undefined)).toBe(false);
  });

  it("matches the exact keys the two readers subscribe with (drift guard)", () => {
    renderHook(() => useNutritionGoalForDay("c1", "2026-11-02"));
    renderHook(() => useNutritionOutOfDate("c1"));
    const subscribed = swrSubscribeMock.mock.calls.map((call) => call[0] as string);
    const { predicate } = clear("c1");
    for (const key of subscribed) expect(predicate(key)).toBe(true);
  });
});

/**
 * Every writer of what these reads are derived from clears them (CONVENTIONS
 * §7: the area that owes a clearer is the one that READS what you wrote). The
 * day read prices from the goal, the newest weight and the energy pair; the
 * out-of-date answer judges the goals against the saved versions. So:
 *
 *  - every goal and reading writer — found as the callers of the goals
 *    invalidators, since a reading moves a goal's start reading too — clears;
 *  - the three plan writers — the drawer's save, the calendar's delete, the
 *    blocks screen's trims and deletes — clear.
 *
 * Derived from the tree at test time, so a goal or reading writer added later
 * without the clearer fails here.
 */
describe("every writer of a goal, a reading or a plan clears these reads", () => {
  const ROOT = join(__dirname, "..");
  const SCAN_DIRS = ["app", "components", "hooks"];
  const GOAL_INVALIDATORS = ["useInvalidateClientGoals()", "useClearClientGoals()"];
  const OWNERS = new Set(["hooks/use-client-goals.ts", "hooks/use-nutrition-goal.ts"]);
  const PLAN_WRITERS = [
    "hooks/use-nutrition-builder.ts",
    "components/clients/nutrition/builder/nutrition-plan-builder.tsx",
    "components/clients/metrics/blocks/blocks-subtab.tsx",
  ];

  /** The clearer is not merely taken but CALLED: the name bound to it appears
   *  as a call somewhere past its declaration. */
  function callsTheClearer(source: string): boolean {
    const bound = /const (\w+) = useClearNutritionGoal\(\)/.exec(source);
    if (!bound) return false;
    const rest = source.slice(bound.index + bound[0].length);
    return new RegExp(`\\b${bound[1]}\\(`).test(rest);
  }

  function walk(dir: string, out: string[]) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        walk(full, out);
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        out.push(full);
      }
    }
  }

  it("holds for every goal and reading writer, and the scan finds the writers it exists for", () => {
    const files: string[] = [];
    for (const dir of SCAN_DIRS) walk(join(ROOT, dir), files);

    const writers: string[] = [];
    const violations: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, file);
      if (OWNERS.has(rel)) continue;
      const source = readFileSync(file, "utf8");
      if (!GOAL_INVALIDATORS.some((call) => source.includes(call))) continue;
      writers.push(rel);
      if (!callsTheClearer(source)) violations.push(rel);
    }

    // The details sheet's save, the Journey's Log measurement and reading
    // actions, and the intake sync's two surfaces: a scan matching fewer has
    // lost its subject.
    expect(writers.length).toBeGreaterThanOrEqual(5);
    expect(violations).toEqual([]);
  });

  it("holds for the three plan writers", () => {
    for (const rel of PLAN_WRITERS) {
      expect(callsTheClearer(readFileSync(join(ROOT, rel), "utf8")), rel).toBe(true);
    }
  });
});
