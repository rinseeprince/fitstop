import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig, type Cache } from "swr";
import type { ReactNode } from "react";

import { useLogMeasurement } from "./use-log-measurement";
import { useMetricEntries } from "@/hooks/use-metric-entries";
import { useMeasurementSeries } from "@/hooks/use-measurement-series";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { MetricTab } from "../metrics-view-types";

// Real SWR over a shared cache: what the save does to the two stores it owes a
// refresh (CONVENTIONS §7) — refresh in place the one the pane on screen shows,
// clear the one no pane on screen shows.

vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

const CLIENT_ID = "client-1";
const ENTRIES_KEY = `/api/clients/${CLIENT_ID}/metric-entries`;
const SERIES_KEY = `/api/clients/${CLIENT_ID}/measurement-series`;

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

/** The store each key belongs to, read through its own hook. */
const READERS = {
  entries: { key: ENTRIES_KEY, metricKey: "mood" as const, pane: "wellness" as MetricTab },
  series: { key: SERIES_KEY, metricKey: "weight" as const, pane: "body" as MetricTab },
};

function useReader(store: keyof typeof READERS) {
  const entries = useMetricEntries(store === "entries" ? CLIENT_ID : "");
  const series = useMeasurementSeries(store === "series" ? CLIENT_ID : "");
  return store === "entries"
    ? { data: entries.entries.length ? entries.entries : undefined, isLoading: entries.isLoading }
    : { data: series.series ?? undefined, isLoading: series.isLoading };
}

const input = (metricKey: "mood" | "weight") => ({ metricKey, value: 4, entryDate: "2026-09-21" });

beforeEach(() => {
  reads = [];
  answers = {
    [ENTRIES_KEY]: () => Promise.resolve(OLD),
    [SERIES_KEY]: () => Promise.resolve(OLD),
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

describe.each(Object.entries(READERS))("useLogMeasurement — the %s", (store, { key, metricKey, pane }) => {
  const reader = store as keyof typeof READERS;
  const otherPane: MetricTab = pane === "body" ? "wellness" : "body";

  it.each([
    ["the other metric pane", otherPane],
    ["Training or Blocks", null],
  ])("cleared when %s is on screen: no refetch now, and the next reader starts loading, never on the old copy", async (_label, onScreen) => {
    const cache: Cache = new Map();
    const wrapper = wrapperFor(cache);
    // A reader held it once — the pane the coach visited before — then left
    const first = renderHook(() => useReader(reader), { wrapper });
    await waitFor(() => expect(first.result.current.data).toBeDefined());
    first.unmount();

    const { result } = renderHook(() => useLogMeasurement(CLIENT_ID, onScreen), { wrapper });
    await act(() => result.current(input(metricKey)));
    expect(reads.filter((url) => url === key)).toHaveLength(1);

    const refetch = deferred<unknown>();
    answers[key] = () => refetch.promise;
    const next = renderHook(() => useReader(reader), { wrapper });
    expect(next.result.current).toEqual({ data: undefined, isLoading: true });
    await act(async () => {
      refetch.resolve(NEW);
      await refetch.promise;
    });
    await waitFor(() => expect(next.result.current.data).toBeDefined());
  });

  it("refreshed in place when its pane is on screen: the old copy stays until the new lands, and the save waits for it", async () => {
    const wrapper = wrapperFor(new Map());
    const { result } = renderHook(
      () => ({ shown: useReader(reader), log: useLogMeasurement(CLIENT_ID, pane) }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.shown.data).toBeDefined());
    const before = result.current.shown.data;

    const refetch = deferred<unknown>();
    answers[key] = () => refetch.promise;
    let saved = false;
    let save!: Promise<void>;
    act(() => {
      save = result.current.log(input(metricKey)).then(() => {
        saved = true;
      });
    });

    await waitFor(() => expect(reads.filter((url) => url === key)).toHaveLength(2));
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

describe("useLogMeasurement — the client record", () => {
  it("refreshes the client record for a weight or a body fat, which may be the newest reading, and not for a score", async () => {
    const onClientUpdated = vi.fn();
    const { result } = renderHook(() => useLogMeasurement(CLIENT_ID, null, onClientUpdated), {
      wrapper: wrapperFor(new Map()),
    });
    await act(() => result.current(input("weight")));
    expect(onClientUpdated).toHaveBeenCalledTimes(1);
    await act(() => result.current(input("mood")));
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
