import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useJourneyRoundTrip } from "./use-journey-round-trip";

// The landmine this hook exists for: a returnTo that outlives its own flow.
// The whole query rides across every tab change, so a return target left alive
// after an abandoned trip bounces the coach to Journey on some LATER,
// unrelated save — and a lingering ?apply=1 re-opens the tray on every
// hand-return to the tab, because Radix remounts TabsContent on each visit.

const mockReplace = vi.fn();
let search = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => search,
}));

beforeEach(() => {
  mockReplace.mockClear();
  search = new URLSearchParams();
});

describe("useJourneyRoundTrip", () => {
  it("stays shut, with no return target, when no trip params are present", () => {
    search = new URLSearchParams("tab=training&training=plans");
    const { result } = renderHook(() => useJourneyRoundTrip("apply"));
    expect(result.current.open).toBe(false);
    expect(result.current.returnBlockId).toBe(null);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("opens on arrival, captures the block, and strips the one-shot params", () => {
    search = new URLSearchParams(
      "tab=training&training=plans&apply=1&returnTo=journey&returnBlock=blk-7"
    );
    const { result } = renderHook(() => useJourneyRoundTrip("apply"));

    expect(result.current.open).toBe(true);
    expect(result.current.returnBlockId).toBe("blk-7");

    const [url] = mockReplace.mock.calls[0] as [string];
    expect(url).not.toContain("apply=");
    expect(url).not.toContain("returnTo=");
    expect(url).not.toContain("returnBlock=");
    // The pane it was sent to survives — only the one-shot params go.
    expect(url).toContain("training=plans");
  });

  it("consumes ONCE, so a re-render before the stripped URL commits cannot re-fire", () => {
    search = new URLSearchParams("apply=1&returnTo=journey&returnBlock=blk-7");
    const { result, rerender } = renderHook(() => useJourneyRoundTrip("apply"));
    act(() => result.current.setOpen(false));
    rerender();
    expect(result.current.open).toBe(false);
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it("ABANDONED FLOW: closing without applying leaves nothing for a later apply", () => {
    search = new URLSearchParams("apply=1&returnTo=journey&returnBlock=blk-7");
    const { result } = renderHook(() => useJourneyRoundTrip("apply"));
    expect(result.current.returnBlockId).toBe("blk-7");

    // The coach closes the tray without applying.
    act(() => result.current.setOpen(false));
    expect(result.current.returnBlockId).toBe(null);

    // Later, they open the tray by hand and apply. Nothing may bounce them.
    act(() => result.current.setOpen(true));
    expect(result.current.open).toBe(true);
    expect(result.current.returnBlockId).toBe(null);
  });

  it("opens WITHOUT a return target when returnTo names something else", () => {
    search = new URLSearchParams("apply=1&returnTo=elsewhere&returnBlock=blk-7");
    const { result } = renderHook(() => useJourneyRoundTrip("apply"));
    expect(result.current.open).toBe(true);
    expect(result.current.returnBlockId).toBe(null);
  });

  it("ignores the OTHER surface's open param", () => {
    search = new URLSearchParams("edit=1&returnTo=journey&returnBlock=blk-7");
    const { result } = renderHook(() => useJourneyRoundTrip("apply"));
    expect(result.current.open).toBe(false);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
