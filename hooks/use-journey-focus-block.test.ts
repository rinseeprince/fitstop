import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useJourneyFocusBlock } from "./use-journey-focus-block";

// The Blocks pane's one-shot: the return trip's `?block=<id>` opens that card
// and is stripped, so no later return to the pane re-opens the trip's block.

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

describe("useJourneyFocusBlock", () => {
  it("returns the block on the first render and strips the param, keeping the pane", () => {
    search = new URLSearchParams("tab=metrics&journey=blocks&block=blk-7");
    const { result } = renderHook(() => useJourneyFocusBlock());

    expect(result.current).toBe("blk-7");
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("?tab=metrics&journey=blocks", { scroll: false });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("keeps the block for the cards that mount after the strip commits", () => {
    search = new URLSearchParams("tab=metrics&journey=blocks&block=blk-7");
    const { result, rerender } = renderHook(() => useJourneyFocusBlock());
    search = new URLSearchParams("tab=metrics&journey=blocks");
    rerender();

    expect(result.current).toBe("blk-7");
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it("returns null and writes nothing without the param", () => {
    search = new URLSearchParams("tab=metrics&journey=blocks");
    const { result } = renderHook(() => useJourneyFocusBlock());

    expect(result.current).toBe(null);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
