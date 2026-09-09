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

import { useClearClientOverview, overviewBriefKey, overviewPlanSummaryKey } from "./use-client-overview";
import { useOverviewBrief } from "./use-overview-brief";
import { useOverviewPlanSummary } from "./use-overview-plan-summary";

beforeEach(() => {
  mutateMock.mockClear();
  swrSubscribeMock.mockClear();
});

describe("useClearClientOverview", () => {
  function clear(clientId: string) {
    const { result } = renderHook(() => useClearClientOverview());
    void result.current(clientId);
    expect(mutateMock).toHaveBeenCalledTimes(1);
    const [predicate, data, opts] = mutateMock.mock.calls[0];
    expect(typeof predicate).toBe("function");
    return { predicate: predicate as (key: unknown) => boolean, data, opts };
  }

  it("matches both Overview reads of the client — the whole area, not one endpoint", () => {
    const { predicate } = clear("c1");
    expect(predicate(overviewBriefKey("c1"))).toBe(true);
    expect(predicate(overviewPlanSummaryKey("c1"))).toBe(true);
  });

  it("CLEARS the entries rather than revalidating them: undefined data, then a refetch", () => {
    // Both reads render definite answers ("No training plan on the calendar",
    // "No nutrition targets from 16 Feb"); a stale entry served through the
    // refetch would state something that has just stopped being true.
    const { data, opts } = clear("c1");
    expect(data).toBeUndefined();
    expect(opts).toEqual({ revalidate: true });
  });

  it("rejects other clients' keys and every other area of the same client", () => {
    const { predicate } = clear("c1");
    expect(predicate(overviewBriefKey("c2"))).toBe(false);
    expect(predicate("/api/clients/c1/training/events?startDate=x&endDate=y")).toBe(false);
    expect(predicate("/api/clients/c1/blocks/facts")).toBe(false);
    expect(predicate(undefined)).toBe(false);
    expect(predicate(["/api/clients/c1/overview-brief", "extra"])).toBe(false);
  });

  it("accepts the exact keys the two readers subscribe with (drift guard)", () => {
    renderHook(() => useOverviewBrief("c1"));
    renderHook(() => useOverviewPlanSummary("c1"));
    const subscribed = swrSubscribeMock.mock.calls.map((c) => c[0] as string);
    expect(subscribed).toEqual(["/api/clients/c1/overview-brief", "/api/clients/c1/overview-plan-summary"]);

    const { predicate } = clear("c1");
    for (const key of subscribed) expect(predicate(key)).toBe(true);
  });
});

/**
 * Every calendar writer clears the Overview and the dashboard feed.
 *
 * The rule (CONVENTIONS §7): the area that owes an invalidator is the one that
 * READS what you wrote. The Overview's Current-plan cards and Needs-attention
 * rows and the dashboard feed are derived from the plan tables, so every
 * success path that calls one of the three calendar invalidators must call
 * both clearers too. Derived from the tree at test time — never a list — so a
 * calendar writer added later without them fails here.
 */
describe("every calendar writer clears the Overview and the feed", () => {
  const ROOT = join(__dirname, "..");
  const SCAN_DIRS = ["app", "components", "hooks"];
  const INVALIDATOR_CALLS = [
    "useInvalidateTrainingData()",
    "useInvalidateNutritionCalendar()",
    "useInvalidateClientBlocks()",
  ];
  const OWNERS = new Set([
    "hooks/use-calendar-events.ts",
    "hooks/use-nutrition-calendar-events.ts",
    "components/clients/metrics/hooks/use-client-blocks.ts",
  ]);

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

  it("holds across the tree, and the scan matches the writers it exists for", () => {
    const files: string[] = [];
    for (const dir of SCAN_DIRS) walk(join(ROOT, dir), files);

    const writers: string[] = [];
    const violations: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, file);
      if (OWNERS.has(rel)) continue;
      const source = readFileSync(file, "utf8");
      if (!INVALIDATOR_CALLS.some((call) => source.includes(call))) continue;
      writers.push(rel);
      if (!source.includes("useClearClientOverview()") || !source.includes("useClearAttentionFeed()")) {
        violations.push(rel);
      }
    }

    // The ten files this shipped against; a scan matching fewer has lost its
    // subject and is not a guard.
    expect(writers.length).toBeGreaterThanOrEqual(10);
    expect(violations).toEqual([]);
  });
});
