import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useJourneyReturnBlock, useJourneyRoundTrip } from "./use-journey-round-trip";

// The landmine this hook exists for: a returnTo that outlives its own flow.
// The whole query rides across every tab change, so a return target left alive
// after an abandoned trip bounces the coach to Journey on some LATER,
// unrelated save — and a lingering ?apply=1 re-opens the tray on every
// hand-return to the tab, because Radix remounts TabsContent on each visit.

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
    // The strip REPLACES the entry: history never holds an address that
    // re-opens the tray, so Back and Forward cannot re-fire the trip.
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
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

// The addressed surfaces' half: the apply tray (`?apply=1`) and the plan
// editor (`?plan=<planId>`) are open by their address, which the host reads
// and hands in as `open`. Only the return target is one-shot — captured, then
// the two return params stripped while the surface's own param stays.
describe("useJourneyReturnBlock", () => {
  it("captures the block on arrival and strips ONLY the return params", () => {
    search = new URLSearchParams(
      "tab=training&training=plans&apply=1&returnTo=journey&returnBlock=blk-7"
    );
    const { result } = renderHook(() => useJourneyReturnBlock(true));

    expect(result.current.returnBlockId).toBe("blk-7");
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("?tab=training&training=plans&apply=1", {
      scroll: false,
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("captures the block for the plan editor and keeps its address", () => {
    // Journey's "edit plan": the block card sends the coach straight into the
    // plan editor, with no tray and no ?apply=1 on the address.
    search = new URLSearchParams(
      "tab=training&training=plans&plan=plan-9&returnTo=journey&returnBlock=blk-7"
    );
    const { result } = renderHook(() => useJourneyReturnBlock(true));

    expect(result.current.returnBlockId).toBe("blk-7");
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(
      "?tab=training&training=plans&plan=plan-9",
      { scroll: false }
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("consumes ONCE, so a re-render before the stripped URL commits cannot re-fire", () => {
    search = new URLSearchParams("apply=1&returnTo=journey&returnBlock=blk-7");
    const { result, rerender } = renderHook(() => useJourneyReturnBlock(true));
    rerender();
    expect(result.current.returnBlockId).toBe("blk-7");
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it("keeps the block across the address changes of the flow, and clears it on demand", () => {
    search = new URLSearchParams("apply=1&returnTo=journey&returnBlock=blk-7");
    const { result, rerender } = renderHook(() => useJourneyReturnBlock(true));
    // The pick and the arrow replace the address; the state is untouched.
    search = new URLSearchParams("editor=plan-1");
    rerender();
    expect(result.current.returnBlockId).toBe("blk-7");

    act(() => result.current.clearReturnBlock());
    expect(result.current.returnBlockId).toBe(null);
  });

  it("strips a return target naming something else, capturing nothing", () => {
    search = new URLSearchParams("apply=1&returnTo=elsewhere&returnBlock=blk-7");
    const { result } = renderHook(() => useJourneyReturnBlock(true));
    expect(result.current.returnBlockId).toBe(null);
    expect(mockReplace).toHaveBeenCalledWith("?apply=1", { scroll: false });
  });

  it("writes nothing on a plain surface address", () => {
    search = new URLSearchParams("tab=training&apply=1");
    const plain = renderHook(() => useJourneyReturnBlock(true));
    expect(plain.result.current.returnBlockId).toBe(null);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("writes nothing while no surface is open, whatever trip the address carries", () => {
    // The nutrition drawer's trip, or a trip whose surface is not up: not this
    // hook's to consume.
    search = new URLSearchParams("edit=1&returnTo=journey&returnBlock=blk-7");
    const other = renderHook(() => useJourneyReturnBlock(false));
    expect(other.result.current.returnBlockId).toBe(null);
    expect(mockReplace).not.toHaveBeenCalled();

    search = new URLSearchParams("tab=training&returnTo=journey&returnBlock=blk-7");
    const shut = renderHook(() => useJourneyReturnBlock(false));
    expect(shut.result.current.returnBlockId).toBe(null);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
