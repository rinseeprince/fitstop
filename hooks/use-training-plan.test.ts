import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { SWRConfig } from "swr";
import {
  trainingPlanKey,
  useClearTrainingPlan,
  useTrainingPlan,
} from "./use-training-plan";
import { useInvalidateTrainingData } from "./use-calendar-events";

// Real SWR, not a mock: the contract here is how the Training tab's plan read
// behaves across its own lifecycle — what the hero may claim while the answer
// is pending, and that a refresh never takes the answer away. A mocked hook
// cannot show a frame between a refresh starting and landing.

const CLIENT = "client-1";

function planResponse(name: string) {
  return {
    success: true,
    plan: {
      id: "plan-ul",
      clientId: CLIENT,
      coachId: "coach-1",
      name,
      status: "active",
      coachPrompt: "",
      splitType: "upper_lower",
      frequencyPerWeek: 4,
      programDurationWeeks: 4,
      effectiveFrom: "2026-09-07",
      effectiveUntil: "2026-10-04",
      sessions: [],
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    },
    upcomingPlan: null,
    scheduledFor: "2026-09-07",
    clientTimezone: "Europe/London",
  };
}

type FetchResult = { ok: boolean; status: number; json: () => Promise<unknown> };
const ok = (body: unknown): FetchResult => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve(body),
});
const failed = (error: string): FetchResult => ({
  ok: false,
  status: 500,
  json: () => Promise.resolve({ error }),
});

/** A response that lands only when the test says so — the in-flight frame. */
function deferred() {
  let release!: (result: FetchResult) => void;
  const promise = new Promise<FetchResult>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

// Fresh cache per test; retries off, so a failure is one answer and no timer
// outlives the test.
function wrapper({ children }: { children: ReactNode }) {
  return createElement(
    SWRConfig,
    { value: { provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false } },
    children
  );
}

describe("useTrainingPlan", () => {
  const fetchMock = vi.fn<(url: string) => Promise<FetchResult>>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lives under one key inside the training area", () => {
    expect(trainingPlanKey(CLIENT)).toBe("/api/clients/client-1/training");
  });

  it("the training area's invalidator reaches it: a calendar write revalidates the read", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(ok(planResponse("Upper Lower"))));
    const { result } = renderHook(
      () => ({ read: useTrainingPlan({ clientId: CLIENT }), invalidate: useInvalidateTrainingData() }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.read.plan?.name).toBe("Upper Lower"));

    await act(async () => {
      await result.current.invalidate(CLIENT);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(trainingPlanKey(CLIENT));
  });

  it("claims nothing until the first answer, then carries all of it", async () => {
    const first = deferred();
    fetchMock.mockImplementationOnce(() => first.promise);
    const { result } = renderHook(() => useTrainingPlan({ clientId: CLIENT }), { wrapper });

    expect(result.current.isPending).toBe(true);
    expect(result.current.plan).toBeNull();
    expect(result.current.loadError).toBeNull();

    await act(async () => {
      first.release(ok(planResponse("Upper Lower")));
      await first.promise;
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.plan?.name).toBe("Upper Lower");
    expect(result.current.scheduledFor).toBe("2026-09-07");
    expect(result.current.clientTimezone).toBe("Europe/London");
    expect(result.current.loadError).toBeNull();
  });

  it("a refresh KEEPS the answer: no frame of the revalidation is pending or plan-less", async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve(ok(planResponse("Upper Lower"))));
    const frames: Array<{ pending: boolean; name: string | null }> = [];
    const { result } = renderHook(
      () => {
        const read = useTrainingPlan({ clientId: CLIENT });
        frames.push({ pending: read.isPending, name: read.plan?.name ?? null });
        return read;
      },
      { wrapper }
    );
    await waitFor(() => expect(result.current.plan?.name).toBe("Upper Lower"));
    const loadedAt = frames.length;

    const second = deferred();
    fetchMock.mockImplementationOnce(() => second.promise);
    act(() => {
      void result.current.refresh();
    });
    // The revalidation is in flight — the move's refresh, as the calendar
    // calls it. The pane underneath it must not notice.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.isPending).toBe(false);
    expect(result.current.plan?.name).toBe("Upper Lower");

    await act(async () => {
      second.release(ok(planResponse("Upper Lower (moved)")));
      await second.promise;
    });
    await waitFor(() => expect(result.current.plan?.name).toBe("Upper Lower (moved)"));

    const afterLoad = frames.slice(loadedAt);
    expect(afterLoad.some((frame) => frame.pending)).toBe(false);
    expect(afterLoad.some((frame) => frame.name === null)).toBe(false);
  });

  it("the clearing form drops the answer: pending until the new one lands", async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve(ok(planResponse("Upper Lower"))));
    const { result } = renderHook(
      () => ({ read: useTrainingPlan({ clientId: CLIENT }), clear: useClearTrainingPlan() }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.read.plan?.name).toBe("Upper Lower"));

    const next = deferred();
    fetchMock.mockImplementationOnce(() => next.promise);
    act(() => {
      void result.current.clear(CLIENT);
    });
    // The hero renders a definite answer from this read, so the old plan's
    // name must not stand while the new answer is fetched.
    await waitFor(() => expect(result.current.read.isPending).toBe(true));
    expect(result.current.read.plan).toBeNull();

    await act(async () => {
      next.release(ok(planResponse("Push Pull Legs")));
      await next.promise;
    });
    await waitFor(() => expect(result.current.read.plan?.name).toBe("Push Pull Legs"));
    expect(result.current.read.isPending).toBe(false);
  });

  it("a failed FIRST load is an error answer, in the server's own sentence", async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve(failed("Failed to fetch training plan")));
    const { result } = renderHook(() => useTrainingPlan({ clientId: CLIENT }), { wrapper });

    await waitFor(() =>
      expect(result.current.loadError).toBe("Failed to fetch training plan")
    );
    expect(result.current.plan).toBeNull();
  });

  it("a failed REVALIDATION keeps the plan on screen and reports no load error", async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve(ok(planResponse("Upper Lower"))));
    const { result } = renderHook(() => useTrainingPlan({ clientId: CLIENT }), { wrapper });
    await waitFor(() => expect(result.current.plan?.name).toBe("Upper Lower"));

    fetchMock.mockImplementationOnce(() => Promise.resolve(failed("Failed to fetch training plan")));
    await act(async () => {
      await result.current.refresh();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.plan?.name).toBe("Upper Lower");
    expect(result.current.isPending).toBe(false);
    expect(result.current.loadError).toBeNull();
  });
});
