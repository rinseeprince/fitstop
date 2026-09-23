import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { seed, clearHistory, clearNutritionGoal, clearComparisons, toast } = vi.hoisted(() => ({
  seed: vi.fn(),
  clearHistory: vi.fn(),
  clearNutritionGoal: vi.fn(),
  clearComparisons: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));
// The goals read is seeded, never refetched: the module offers the write no
// invalidator of it.
vi.mock("@/hooks/use-client-goals", () => ({
  useSeedClientGoals: () => seed,
  useClearClientGoalHistory: () => clearHistory,
}));
vi.mock("@/hooks/use-nutrition-goal", () => ({ useClearNutritionGoal: () => clearNutritionGoal }));
vi.mock("@/hooks/use-check-in-detail-data", () => ({
  useClearCheckInComparisons: () => clearComparisons,
}));
vi.mock("sonner", () => ({ toast }));

import { GoalRefusal, useGoalWrites } from "./use-goal-writes";
import { GOAL_UNDO_WINDOW_MS } from "@/lib/constants";
import type { ClientGoalsOverview, GoalOnDay } from "@/types/client-goals";

const ANSWER: ClientGoalsOverview = { current: null, planned: [], previous: null, clientToday: "2026-11-03" };

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

const PLANNED: GoalOnDay = {
  id: "goal-peak",
  clientId: "client-7",
  name: "Peak",
  type: "build_muscle",
  targetWeight: 87.9,
  targetBodyFatPercentage: null,
  description: "Size for the season",
  startsOn: "2026-12-07",
  source: "coach",
  setBy: "coach-3",
  createdAt: "2026-10-01T09:00:00Z",
  updatedAt: "2026-10-01T09:00:00Z",
  deadline: "2027-02-26",
};

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

  it("a delete answers with the goals and the signed copy its undo sends back", async () => {
    const fetchMock = stubFetch(respond(200, { success: true, data: { ...ANSWER, undo: "copy.sig" } }));

    expect(await writes().remove("goal-peak")).toMatchObject({ undo: "copy.sig" });
    expect(sent(fetchMock)).toEqual({
      url: "/api/clients/client-7/goals/goal-peak",
      method: "DELETE",
      body: undefined,
    });
  });

  it("a refusal is a GoalRefusal carrying the rule's sentence and its fixes; anything else an error", async () => {
    const fixes = [{ kind: "delete_goal", goalId: "goal-peak", name: "Peak" }];
    stubFetch(
      respond(409, { success: false, error: "The deadline runs into Peak.", fixes }),
      respond(500, { success: false, error: "Failed to save the goal" })
    );
    const api = writes();

    const refused = await api.run({ kind: "deadline", goalId: "goal-a", deadline: "2026-12-20" }).catch((e) => e);
    expect(refused).toBeInstanceOf(GoalRefusal);
    expect(refused).toMatchObject({ message: "The deadline runs into Peak.", fixes });

    const failed = await api.run({ kind: "deadline", goalId: "goal-a", deadline: "2026-12-20" }).catch((e) => e);
    expect(failed).not.toBeInstanceOf(GoalRefusal);
    expect(failed.message).toBe("Failed to save the goal");
  });
});

describe("the fixes a refusal offers", () => {
  it("moves a planned goal by rewriting it whole on its new day", async () => {
    const fetchMock = stubFetch(respond(200, { success: true, data: ANSWER }));
    await writes().applyFix({ kind: "move_goal", goalId: "goal-peak", name: "Peak", startsOn: "2026-12-21" }, [PLANNED]);

    expect(sent(fetchMock)).toEqual({
      url: "/api/clients/client-7/goals/goal-peak",
      method: "PATCH",
      body: {
        type: "build_muscle",
        name: "Peak",
        targetWeight: 87.9,
        targetBodyFatPercentage: null,
        description: "Size for the season",
        startsOn: "2026-12-21",
        deadline: "2027-02-26",
      },
    });
  });

  it("ends the previous goal's deadline", async () => {
    const fetchMock = stubFetch(respond(200, { success: true, data: ANSWER }));
    await writes().applyFix(
      { kind: "end_deadline", goalId: "goal-lean", name: "Lean", deadline: "2026-12-06" },
      []
    );

    expect(sent(fetchMock)).toEqual({
      url: "/api/clients/client-7/goals/goal-lean/deadline",
      method: "PUT",
      body: { deadline: "2026-12-06" },
    });
  });

  it("refuses to move a goal that is no longer planned, and sends nothing", async () => {
    const fetchMock = stubFetch();
    await expect(
      writes().applyFix({ kind: "move_goal", goalId: "goal-gone", name: "Gone", startsOn: "2026-12-21" }, [PLANNED])
    ).rejects.toThrow("Gone is no longer planned.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("landing a write's answer", () => {
  it("seeds the goals read and clears every read derived from goals", () => {
    writes().land(ANSWER);

    expect(seed).toHaveBeenCalledWith("client-7", ANSWER);
    expect(clearHistory).toHaveBeenCalledWith("client-7");
    expect(clearNutritionGoal).toHaveBeenCalledWith("client-7");
    expect(clearComparisons).toHaveBeenCalled();
  });

  it("lands the goals alone — a delete's signed copy stays out of the read", () => {
    writes().land({ ...ANSWER, undo: "copy.sig" } as ClientGoalsOverview);

    expect(seed).toHaveBeenCalledWith("client-7", ANSWER);
  });
});

describe("Goal deleted · Undo", () => {
  /** The toast the delete raised, and its Undo action. */
  function raised() {
    const [title, options] = toast.success.mock.calls[0] as [
      string,
      { duration: number; action: { label: string; onClick: (event: { preventDefault: () => void }) => void } },
    ];
    return { title, options };
  }

  it("stays up for as long as the undo is good, with Undo as its action", () => {
    toast.success.mockReturnValue("toast-9");
    writes().announceDeleted("copy.sig");

    const { title, options } = raised();
    expect(title).toBe("Goal deleted");
    expect(options.duration).toBe(GOAL_UNDO_WINDOW_MS);
    expect(options.action.label).toBe("Undo");
  });

  it("raises nothing without an undo to offer", () => {
    writes().announceDeleted(undefined);
    expect(toast.success).not.toHaveBeenCalled();
  });

  // The frame test: the toast stays until the goal is back, then the answer is
  // seeded and the toast closed in one tick — even with the seed still going.
  it("keeps the toast up while restoring, then lands the answer and closes it in one tick", async () => {
    toast.success.mockReturnValueOnce("toast-9");
    seed.mockReturnValue(new Promise(() => {}));
    let resolveRestore: (response: Response) => void = () => {};
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((resolve) => (resolveRestore = resolve)));
    vi.stubGlobal("fetch", fetchMock);
    writes().announceDeleted("copy.sig");

    const preventDefault = vi.fn();
    raised().options.action.onClick({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(sent(fetchMock)).toEqual({
      url: "/api/clients/client-7/goals/restore",
      method: "POST",
      body: { undo: "copy.sig" },
    });
    expect(toast.dismiss).not.toHaveBeenCalled();

    // A second press while the first is out sends nothing.
    raised().options.action.onClick({ preventDefault: vi.fn() });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRestore(respond(200, { success: true, data: ANSWER }));
      await Promise.resolve();
    });
    expect(seed).toHaveBeenCalledWith("client-7", ANSWER);
    expect(toast.dismiss).toHaveBeenCalledWith("toast-9");
    expect(toast.success).toHaveBeenLastCalledWith("Goal restored");
  });

  it("says so when the undo is refused, and closes the toast", async () => {
    toast.success.mockReturnValueOnce("toast-9");
    stubFetch(respond(410, { success: false, error: "Too late to undo — set the goal again instead." }));
    writes().announceDeleted("copy.sig");

    await act(async () => {
      raised().options.action.onClick({ preventDefault: vi.fn() });
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith("Undo failed", {
      description: "Too late to undo — set the goal again instead.",
    });
    expect(toast.dismiss).toHaveBeenCalledWith("toast-9");
    expect(seed).not.toHaveBeenCalled();
  });
});
