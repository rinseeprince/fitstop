import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig, type Cache } from "swr";
import type { ReactNode } from "react";

import { useLogMeasurement } from "./use-log-measurement";
import { useMeasurementSeries } from "@/hooks/use-measurement-series";
import { useClientGoals } from "@/hooks/use-client-goals";
import { useNutritionOutOfDate } from "@/hooks/use-nutrition-goal";
import { useOverviewBrief } from "@/hooks/use-overview-brief";
import { swrFetcher } from "@/lib/swr-fetcher";

// Real SWR over a shared cache: what the save does to the stores it owes a
// refresh (CONVENTIONS §7) — refresh in place the ones the pane on screen
// shows, clear the ones no pane on screen shows.

vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

const CLIENT_ID = "client-1";
const SERIES_KEY = `/api/clients/${CLIENT_ID}/measurement-series`;
const GOALS_KEY = `/api/clients/${CLIENT_ID}/goals`;
const OUT_OF_DATE_KEY = `/api/clients/${CLIENT_ID}/nutrition/goal/out-of-date`;
const GOALS_OLD = { success: true, data: { current: { id: "goal-7", startReadings: { weight: 91.4 } }, planned: [] } };
const GOALS_NEW = { success: true, data: { current: { id: "goal-7", startReadings: { weight: 89.3 } }, planned: [] } };

const OLD = { success: true, data: [{ id: "e-1", value: 3 }] };
const NEW = { success: true, data: [{ id: "e-1", value: 3 }, { id: "e-2", value: 4 }] };

let answers: Record<string, () => Promise<unknown>> = {};
let reads: string[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function wrapperFor(cache: Cache) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>{children}</SWRConfig>
    );
  };
}

/** The measurement series, read through its own hook. */
function useSeriesReader() {
  const { series, isLoading } = useMeasurementSeries(CLIENT_ID);
  return { data: series ?? undefined, isLoading };
}

const input = (metricKey: "waist" | "weight") => ({ metricKey, value: 4, recordedOn: "2026-09-21" });

beforeEach(() => {
  reads = [];
  answers = {
    [SERIES_KEY]: () => Promise.resolve(OLD),
    [GOALS_KEY]: () => Promise.resolve(GOALS_OLD),
    [OUT_OF_DATE_KEY]: () =>
      Promise.resolve({ success: true, data: { clientToday: "2026-09-21", outOfDate: null } }),
  };
  vi.mocked(swrFetcher).mockImplementation((url: string) => {
    reads.push(url);
    return answers[url]() as never;
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }))
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useLogMeasurement — the measurement series", () => {
  it.each([
    ["Training", "training" as const],
    ["no Journey pane", null],
  ])("cleared when %s is on screen: no refetch now, and the next reader starts loading, never on the old copy", async (_label, onScreen) => {
    const cache: Cache = new Map();
    const wrapper = wrapperFor(cache);
    // A reader held it once — the pane the coach visited before — then left
    const first = renderHook(() => useSeriesReader(), { wrapper });
    await waitFor(() => expect(first.result.current.data).toBeDefined());
    first.unmount();

    const { result } = renderHook(() => useLogMeasurement(CLIENT_ID, onScreen), { wrapper });
    await act(() => result.current(input("weight")));
    expect(reads.filter((url) => url === SERIES_KEY)).toHaveLength(1);

    const refetch = deferred<unknown>();
    answers[SERIES_KEY] = () => refetch.promise;
    const next = renderHook(() => useSeriesReader(), { wrapper });
    expect(next.result.current).toEqual({ data: undefined, isLoading: true });
    await act(async () => {
      refetch.resolve(NEW);
      await refetch.promise;
    });
    await waitFor(() => expect(next.result.current.data).toBeDefined());
  });

  it("refreshed in place when Physique is on screen: the old copy stays until the new lands, and the save waits for it", async () => {
    const wrapper = wrapperFor(new Map());
    const { result } = renderHook(
      () => ({ shown: useSeriesReader(), log: useLogMeasurement(CLIENT_ID, "body") }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.shown.data).toBeDefined());
    const before = result.current.shown.data;

    const refetch = deferred<unknown>();
    answers[SERIES_KEY] = () => refetch.promise;
    let saved = false;
    let save!: Promise<void>;
    act(() => {
      save = result.current.log(input("weight")).then(() => {
        saved = true;
      });
    });

    await waitFor(() => expect(reads.filter((url) => url === SERIES_KEY)).toHaveLength(2));
    // Mid-refresh: what was shown is still shown, and the save has not returned
    expect(result.current.shown).toEqual({ data: before, isLoading: false });
    expect(saved).toBe(false);

    await act(async () => {
      refetch.resolve(NEW);
      await save;
    });
    expect(saved).toBe(true);
    expect(result.current.shown.data).not.toEqual(before);
  });
});

describe("useLogMeasurement — the save", () => {
  it("posts the reading to the client's measurements, as the dialog gave it", async () => {
    const { result } = renderHook(() => useLogMeasurement(CLIENT_ID, null), {
      wrapper: wrapperFor(new Map()),
    });
    await act(() => result.current(input("waist")));

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe(`/api/clients/${CLIENT_ID}/measurements`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ metricKey: "waist", value: 4, recordedOn: "2026-09-21" });
  });
});

// The Overview's "Since your last visit" lists the coach's readings, and no
// Journey pane shows it: every save clears its reads, so the next Overview opens
// on its loading state and never on the feed from before the reading.
describe("useLogMeasurement — the Overview", () => {
  const BRIEF_KEY = `/api/clients/${CLIENT_ID}/overview-brief`;

  it("clears its reads after any save: the next Overview opens loading, never on the old feed", async () => {
    const cache: Cache = new Map();
    const wrapper = wrapperFor(cache);
    answers[BRIEF_KEY] = () =>
      Promise.resolve({ success: true, data: { lastViewedAt: "2026-09-20T08:00:00Z", activity: [] } });
    const first = renderHook(() => useOverviewBrief(CLIENT_ID), { wrapper });
    await waitFor(() => expect(first.result.current.brief).not.toBeNull());
    first.unmount();

    const { result } = renderHook(() => useLogMeasurement(CLIENT_ID, "body"), { wrapper });
    await act(() => result.current(input("waist")));

    answers[BRIEF_KEY] = () => deferred<unknown>().promise;
    const next = renderHook(() => useOverviewBrief(CLIENT_ID), { wrapper });
    expect(next.result.current).toMatchObject({ brief: null, isLoading: true });
  });
});

describe("useLogMeasurement — the client record", () => {
  it("refreshes the client record for a weight or a body fat, which may be the newest reading, and not for a girth", async () => {
    const onClientUpdated = vi.fn();
    const { result } = renderHook(() => useLogMeasurement(CLIENT_ID, null, onClientUpdated), {
      wrapper: wrapperFor(new Map()),
    });
    await act(() => result.current(input("weight")));
    expect(onClientUpdated).toHaveBeenCalledTimes(1);
    await act(() => result.current(input("waist")));
    expect(onClientUpdated).toHaveBeenCalledTimes(1);
  });

  it("throws the server's sentence and refreshes nothing when the save is refused", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, error: "Entry date cannot be in the future" }), {
        status: 400,
      })
    );
    const onClientUpdated = vi.fn();
    const { result } = renderHook(() => useLogMeasurement(CLIENT_ID, "body", onClientUpdated), {
      wrapper: wrapperFor(new Map()),
    });
    await expect(result.current(input("weight"))).rejects.toThrow("Entry date cannot be in the future");
    expect(onClientUpdated).not.toHaveBeenCalled();
    expect(reads).toEqual([]);
  });
});

describe("useLogMeasurement — the goals read", () => {
  // A goal's progress runs from the reading on its start day, which the goals
  // read carries: a weight or body fat may move it, a girth never.
  const useGoalsReader = () => {
    const { current, isLoading } = useClientGoals(CLIENT_ID);
    return { data: current ?? undefined, isLoading };
  };

  it("refreshes it in place when the Physique pane is on screen", async () => {
    const wrapper = wrapperFor(new Map());
    const { result } = renderHook(
      () => ({ shown: useGoalsReader(), log: useLogMeasurement(CLIENT_ID, "body") }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.shown.data).toBeDefined());
    const refetch = deferred<unknown>();
    answers[GOALS_KEY] = () => refetch.promise;
    let save!: Promise<void>;
    act(() => {
      save = result.current.log(input("weight"));
    });
    await waitFor(() => expect(reads.filter((url) => url === GOALS_KEY)).toHaveLength(2));
    expect(result.current.shown.data).toEqual(GOALS_OLD.data.current);
    await act(async () => {
      refetch.resolve(GOALS_NEW);
      await save;
    });
    expect(result.current.shown.data).toEqual(GOALS_NEW.data.current);
  });

  it("clears it when no goals reader is on screen, so the Overview opens loading, never on the old start", async () => {
    const cache: Cache = new Map();
    const wrapper = wrapperFor(cache);
    const first = renderHook(() => useGoalsReader(), { wrapper });
    await waitFor(() => expect(first.result.current.data).toBeDefined());
    first.unmount();

    const { result } = renderHook(() => useLogMeasurement(CLIENT_ID, null), { wrapper });
    await act(() => result.current(input("weight")));

    answers[GOALS_KEY] = () => deferred<unknown>().promise;
    const next = renderHook(() => useGoalsReader(), { wrapper });
    expect(next.result.current).toEqual({ data: undefined, isLoading: true });
  });

  it("leaves it alone for a girth", async () => {
    const wrapper = wrapperFor(new Map());
    const { result } = renderHook(
      () => ({ shown: useGoalsReader(), log: useLogMeasurement(CLIENT_ID, "body") }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.shown.data).toBeDefined());
    await act(() => result.current.log(input("waist")));
    expect(reads.filter((url) => url === GOALS_KEY)).toHaveLength(1);
  });

  // The Goals pane reads the series and the goals read too — its results are
  // worked out from both — so a weight logged there refreshes both in place.
  it("refreshes it and the series in place when the Goals pane is on screen", async () => {
    const wrapper = wrapperFor(new Map());
    const { result } = renderHook(
      () => ({
        goal: useGoalsReader(),
        series: useMeasurementSeries(CLIENT_ID),
        log: useLogMeasurement(CLIENT_ID, "goals"),
      }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.goal.data).toBeDefined());
    await waitFor(() => expect(result.current.series.series).toBeDefined());
    const goalRefetch = deferred<unknown>();
    answers[GOALS_KEY] = () => goalRefetch.promise;
    let save!: Promise<void>;
    act(() => {
      save = result.current.log(input("weight"));
    });
    await waitFor(() => expect(reads.filter((url) => url === GOALS_KEY)).toHaveLength(2));
    // Mid-refresh: both still show what they held, nothing loading
    expect(reads.filter((url) => url === SERIES_KEY)).toHaveLength(2);
    expect(result.current.goal).toEqual({ data: GOALS_OLD.data.current, isLoading: false });
    expect(result.current.series.series).toEqual(OLD.data);
    await act(async () => {
      goalRefetch.resolve(GOALS_NEW);
      await save;
    });
    expect(result.current.goal.data).toEqual(GOALS_NEW.data.current);
  });
});

// docs/MEASUREMENT-LOG-PLAN.md commit 8d1: the nutrition drawer prices from the
// newest weight and the energy pair, on no screen this dialog shows — so a
// weight or body fat CLEARS how nutrition follows the goal, and a girth leaves
// it alone.
describe("useLogMeasurement — how nutrition follows the goal", () => {
  const useRuleReader = () => {
    const { outOfDate, clientToday, isLoading } = useNutritionOutOfDate(CLIENT_ID);
    return { data: clientToday ? { outOfDate } : undefined, isLoading };
  };

  it("clears it after a weight: the next reader starts loading, never on the old answer", async () => {
    const cache: Cache = new Map();
    const wrapper = wrapperFor(cache);
    const first = renderHook(() => useRuleReader(), { wrapper });
    await waitFor(() => expect(first.result.current.data).toBeDefined());
    first.unmount();

    const { result } = renderHook(() => useLogMeasurement(CLIENT_ID, "body"), { wrapper });
    await act(() => result.current(input("weight")));

    answers[OUT_OF_DATE_KEY] = () => deferred<unknown>().promise;
    const next = renderHook(() => useRuleReader(), { wrapper });
    expect(next.result.current).toEqual({ data: undefined, isLoading: true });
  });

  it("leaves it alone for a girth", async () => {
    const wrapper = wrapperFor(new Map());
    const { result } = renderHook(
      () => ({ shown: useRuleReader(), log: useLogMeasurement(CLIENT_ID, "body") }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.shown.data).toBeDefined());
    await act(() => result.current.log(input("waist")));
    expect(reads.filter((url) => url === OUT_OF_DATE_KEY)).toHaveLength(1);
  });
});
