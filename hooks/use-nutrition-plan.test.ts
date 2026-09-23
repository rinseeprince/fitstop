import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useNutritionPlan } from "./use-nutrition-plan";
import type { Client } from "@/types/check-in";

const CLIENT = { id: "client-3" } as Client;

function respond(ok: boolean, body: unknown = {}) {
  return vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useNutritionPlan — a failed read says so", () => {
  it("a refused read is a failure, never an empty plan", async () => {
    vi.stubGlobal("fetch", respond(false));
    const { result } = renderHook(() => useNutritionPlan({ client: CLIENT }));

    await waitFor(() => expect(result.current.isLoadingNutrition).toBe(false));
    expect(result.current.isNutritionError).toBe(true);
    expect(result.current.nutritionData).toBeNull();
  });

  it("a network error is a failure too", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useNutritionPlan({ client: CLIENT }));

    await waitFor(() => expect(result.current.isNutritionError).toBe(true));
  });

  it("a retry clears the failure, and an answer ends it", async () => {
    const fetchMock = respond(false);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useNutritionPlan({ client: CLIENT }));
    await waitFor(() => expect(result.current.isNutritionError).toBe(true));

    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ hasPlan: true, clientToday: "2026-10-06" }),
    });
    act(() => result.current.refetchNutrition());
    expect(result.current.isNutritionError).toBe(false);

    await waitFor(() => expect(result.current.nutritionData?.clientToday).toBe("2026-10-06"));
    expect(result.current.isNutritionError).toBe(false);
  });

  it("any later answer ends a failure, not only a retry's", async () => {
    const fetchMock = respond(false);
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(({ client }) => useNutritionPlan({ client }), {
      initialProps: { client: CLIENT },
    });
    await waitFor(() => expect(result.current.isNutritionError).toBe(true));

    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ hasPlan: false, clientToday: "2026-10-13" }),
    });
    rerender({ client: { id: "client-8" } as Client });

    await waitFor(() => expect(result.current.nutritionData?.clientToday).toBe("2026-10-13"));
    expect(result.current.isNutritionError).toBe(false);
  });
});
