import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useNutritionDrawerTrip } from "./use-nutrition-drawer-trip";

// The landmine this hook exists for: a one-shot param that outlives its own
// arrival. The whole query rides across every tab change, so a lingering
// ?edit=1 re-opens the drawer on every hand-return to the tab, because Radix
// remounts TabsContent on each visit.

const mockReplace = vi.fn();
const mockPush = vi.fn();
let search = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useSearchParams: () => search,
}));

beforeEach(() => {
  mockReplace.mockClear();
  mockPush.mockClear();
  search = new URLSearchParams();
});

describe("useNutritionDrawerTrip", () => {
  // docs/MEASUREMENT-LOG-PLAN.md commit 8d1: "Set nutrition from 19 Oct" on the
  // Overview. The day is captured in the same update that opens the drawer —
  // so it never opens on another day first — stripped with the open param, and
  // dropped on any close.
  it("opens on arrival with the start day, strips both, and drops the day on a close", () => {
    search = new URLSearchParams("tab=nutrition&nutrition=plans&edit=1&startsOn=2026-10-19");
    const { result } = renderHook(() => useNutritionDrawerTrip());

    expect(result.current.open).toBe(true);
    expect(result.current.startsOn).toBe("2026-10-19");
    const [url] = mockReplace.mock.calls[0] as [string];
    expect(url).not.toContain("edit=");
    expect(url).not.toContain("startsOn=");
    // The pane it was sent to survives — only the one-shot params go.
    expect(url).toContain("nutrition=plans");
    // The strip REPLACES the entry: history never holds an address that
    // re-opens the drawer, so Back and Forward cannot re-fire the arrival.
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();

    act(() => result.current.setOpen(false));
    expect(result.current.open).toBe(false);
    expect(result.current.startsOn).toBe(null);
  });

  it("opens from the client's today when the arrival names no day (Regenerate)", () => {
    search = new URLSearchParams("tab=nutrition&nutrition=plans&edit=1");
    const { result } = renderHook(() => useNutritionDrawerTrip());

    expect(result.current.open).toBe(true);
    expect(result.current.startsOn).toBe(null);
  });

  it("stays shut, and writes nothing, when the address does not open it", () => {
    search = new URLSearchParams("tab=nutrition&nutrition=plans");
    const { result } = renderHook(() => useNutritionDrawerTrip());
    expect(result.current.open).toBe(false);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("ignores the apply tray's open param", () => {
    search = new URLSearchParams("tab=training&apply=1");
    const { result } = renderHook(() => useNutritionDrawerTrip());
    expect(result.current.open).toBe(false);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("consumes ONCE, so a re-render before the stripped URL commits cannot re-fire", () => {
    search = new URLSearchParams("edit=1&startsOn=2026-10-19");
    const { result, rerender } = renderHook(() => useNutritionDrawerTrip());
    act(() => result.current.setOpen(false));
    rerender();
    expect(result.current.open).toBe(false);
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it("a hand open after a close starts from no day", () => {
    search = new URLSearchParams("edit=1&startsOn=2026-10-19");
    const { result } = renderHook(() => useNutritionDrawerTrip());

    act(() => result.current.setOpen(false));
    act(() => result.current.setOpen(true));
    expect(result.current.open).toBe(true);
    expect(result.current.startsOn).toBe(null);
  });
});
