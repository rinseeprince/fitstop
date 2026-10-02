import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCheckInForm } from "./use-check-in-form";

const TOKEN = "client-check-in";
const KEY = `check-in-form-data-${TOKEN}`;

/** The browser's storage, in memory: the test runtime's own needs a file to back it. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, String(value));
    },
  };
}

/** A draft the client left on `step`, as the wizard saves it. */
function saveDraft(step: number) {
  localStorage.setItem(KEY, JSON.stringify({ data: { notes: "Long week" }, step, savedAt: "2026-10-02T08:00:00Z" }));
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useCheckInForm — the draft's step against the wizard's steps", () => {
  it("keeps a draft saved on its last step, Habits, while the step count is not known yet", () => {
    saveDraft(5);
    const { result, rerender } = renderHook(({ total }: { total: number | null }) => useCheckInForm(TOKEN, total), {
      initialProps: { total: null as number | null },
    });
    expect(result.current.currentStep).toBe(5);

    // The context arrives: the week held a habit, so Habits is step 5.
    rerender({ total: 5 });
    expect(result.current.currentStep).toBe(5);
  });

  it("pulls the draft back into range once the steps are known and fewer", () => {
    saveDraft(5);
    const { result, rerender } = renderHook(({ total }: { total: number | null }) => useCheckInForm(TOKEN, total), {
      initialProps: { total: null as number | null },
    });
    // A week without habits: four steps, Training last.
    rerender({ total: 4 });
    expect(result.current.currentStep).toBe(4);
  });

  it("shows a draft restored past the last step on the last step from the render the count arrives in, and moves from there", () => {
    saveDraft(5);
    const { result, rerender } = renderHook(({ total }: { total: number | null }) => useCheckInForm(TOKEN, total), {
      initialProps: { total: null as number | null },
    });
    // No effect pulls it in: the step shown is worked out as the count arrives.
    rerender({ total: 4 });
    expect(result.current.currentStep).toBe(4);
    act(() => result.current.prevStep());
    expect(result.current.currentStep).toBe(3);
  });

  it("moves through the known steps and no further", () => {
    const { result } = renderHook(() => useCheckInForm(TOKEN, 2));
    act(() => result.current.nextStep());
    act(() => result.current.nextStep());
    expect(result.current.currentStep).toBe(2);
    act(() => result.current.prevStep());
    expect(result.current.currentStep).toBe(1);
  });

  it("does not move while the step count is unknown", () => {
    const { result } = renderHook(() => useCheckInForm(TOKEN, null));
    act(() => result.current.nextStep());
    expect(result.current.currentStep).toBe(1);
  });
});
