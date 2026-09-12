import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { back, coachHistory } = vi.hoisted(() => ({
  back: vi.fn(),
  coachHistory: { current: false },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back }) }));
vi.mock("@/lib/coach-history", () => ({
  hasCoachHistory: () => coachHistory.current,
}));

import { useCoachBack } from "./use-coach-back";

beforeEach(() => {
  back.mockClear();
  coachHistory.current = false;
});

describe("useCoachBack", () => {
  it("goes back when a coach page precedes the entry", () => {
    coachHistory.current = true;
    const fallback = vi.fn();
    const { result } = renderHook(() => useCoachBack(fallback));
    result.current();
    expect(back).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("goes to the parent when nothing in-app precedes it", () => {
    const fallback = vi.fn();
    const { result } = renderHook(() => useCoachBack(fallback));
    result.current();
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
  });
});
