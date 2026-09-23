import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { seed, clearHistory, refreshHistory, clearNutritionGoal, clearComparisons } = vi.hoisted(() => ({
  seed: vi.fn(),
  clearHistory: vi.fn(),
  refreshHistory: vi.fn(),
  clearNutritionGoal: vi.fn(),
  clearComparisons: vi.fn(),
}));
// The goals read is seeded, never refetched: the module offers the write no
// invalidator of it.
vi.mock("@/hooks/use-client-goals", () => ({
  useSeedClientGoals: () => seed,
  useClearClientGoalHistory: () => clearHistory,
  useRefreshClientGoalHistory: () => refreshHistory,
}));
vi.mock("@/hooks/use-nutrition-goal", () => ({ useClearNutritionGoal: () => clearNutritionGoal }));
vi.mock("@/hooks/use-check-in-detail-data", () => ({
  useClearCheckInComparisons: () => clearComparisons,
}));

import { GoalRefusal, useGoalWrites } from "./use-goal-writes";
import type { ClientGoalsOverview } from "@/types/client-goals";

const ANSWER: ClientGoalsOverview = { current: null, planned: [], clientToday: "2026-11-03" };

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

function writes() {
  return renderHook(() => useGoalWrites("client-7")).result.current;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("each write goes to its route and answers with the goals as they stand", () => {
  it("add, edit, deadline and rename", async () => {
    const body = {
      type: "maintain" as const,
      name: "Hold",
      targetWeight: null,
      targetBodyFatPercentage: null,
      description: null,
      deadline: null,
      startsOn: "2026-11-03",
    };
    const fetchMock = stubFetch(
      respond(201, { success: true, data: ANSWER }),
      respond(200, { success: true, data: ANSWER }),
      respond(200, { success: true, data: ANSWER }),
      respond(200, { success: true, data: ANSWER })
    );
    const api = writes();

    expect(await api.run({ kind: "add", body })).toEqual(ANSWER);
    await api.run({ kind: "edit", goalId: "goal-a", body });
    await api.run({ kind: "deadline", goalId: "goal-a", deadline: "2027-01-15" });
    await api.run({ kind: "rename", goalId: "goal-a", name: "Hold steady", description: null });

    expect(sent(fetchMock, 0)).toEqual({ url: "/api/clients/client-7/goals", method: "POST", body });
    expect(sent(fetchMock, 1)).toEqual({ url: "/api/clients/client-7/goals/goal-a", method: "PATCH", body });
    expect(sent(fetchMock, 2)).toEqual({
      url: "/api/clients/client-7/goals/goal-a/deadline",
      method: "PUT",
      body: { deadline: "2027-01-15" },
    });
    expect(sent(fetchMock, 3)).toEqual({
      url: "/api/clients/client-7/goals/goal-a/name",
      method: "PUT",
      body: { name: "Hold steady", description: null },
    });
  });

  it("a delete answers with the goals", async () => {
    const fetchMock = stubFetch(respond(200, { success: true, data: ANSWER }));

    expect(await writes().remove("goal-peak")).toEqual(ANSWER);
    expect(sent(fetchMock)).toEqual({
      url: "/api/clients/client-7/goals/goal-peak",
      method: "DELETE",
      body: undefined,
    });
  });

  it("a refusal is a GoalRefusal carrying the rule's sentence; anything else an error", async () => {
    const sentence = "The deadline runs into Peak, which starts 5 Oct. Move Peak to 12 Oct or delete it.";
    stubFetch(
      respond(409, { success: false, error: sentence }),
      respond(500, { success: false, error: "Failed to save the goal" })
    );
    const api = writes();

    const refused = await api.run({ kind: "deadline", goalId: "goal-a", deadline: "2026-12-20" }).catch((e) => e);
    expect(refused).toBeInstanceOf(GoalRefusal);
    expect(refused.message).toBe(sentence);

    const failed = await api.run({ kind: "deadline", goalId: "goal-a", deadline: "2026-12-20" }).catch((e) => e);
    expect(failed).not.toBeInstanceOf(GoalRefusal);
    expect(failed.message).toBe("Failed to save the goal");
  });
});

describe("landing a write's answer", () => {
  it("off the goals table: seeds the goals read and clears every read derived from goals, before it returns", () => {
    void writes().land(ANSWER);

    expect(seed).toHaveBeenCalledWith("client-7", ANSWER);
    expect(clearHistory).toHaveBeenCalledWith("client-7");
    expect(clearNutritionGoal).toHaveBeenCalledWith("client-7");
    expect(clearComparisons).toHaveBeenCalled();
    expect(refreshHistory).not.toHaveBeenCalled();
  });

  it("from the goals table: refreshes the table in place and resolves only once it has", async () => {
    let refreshed!: () => void;
    refreshHistory.mockReturnValue(new Promise<void>((resolve) => (refreshed = resolve)));
    const api = renderHook(() => useGoalWrites("client-7", true)).result.current;

    let landed = false;
    const landing = api.land(ANSWER).then(() => (landed = true));
    await Promise.resolve();

    expect(seed).toHaveBeenCalledWith("client-7", ANSWER);
    expect(refreshHistory).toHaveBeenCalledWith("client-7");
    expect(clearHistory).not.toHaveBeenCalled();
    expect(clearNutritionGoal).toHaveBeenCalledWith("client-7");
    expect(clearComparisons).toHaveBeenCalled();
    expect(landed).toBe(false);

    refreshed();
    await landing;
    expect(landed).toBe(true);
  });

  it("from the goals table: a refresh that fails drops the table's rows instead, so they never pass for new", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    refreshHistory.mockRejectedValue(new Error("timeout"));
    const api = renderHook(() => useGoalWrites("client-7", true)).result.current;

    await api.land(ANSWER);

    expect(clearHistory).toHaveBeenCalledWith("client-7");
  });
});
