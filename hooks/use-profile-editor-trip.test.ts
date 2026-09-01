import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { replace, mockParams, mockPathname } = vi.hoisted(() => ({
  replace: vi.fn(),
  mockParams: { current: new URLSearchParams() },
  mockPathname: { current: "/clients/c1" },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => mockPathname.current,
  useSearchParams: () => mockParams.current,
}));

import { useProfileEditorTrip } from "./use-profile-editor-trip";

function arriveWith(query: string) {
  mockParams.current = new URLSearchParams(query);
  const onOpen = vi.fn();
  const utils = renderHook(() => useProfileEditorTrip(onOpen));
  return { onOpen, ...utils };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPathname.current = "/clients/c1";
});

describe("useProfileEditorTrip", () => {
  it("opens the editor when the param arrives", () => {
    const { onOpen } = arriveWith("tab=overview&editProfile=1");

    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("STRIPS the param, keeping the rest of the query", () => {
    // The whole query rides across every tab change, and Radix remounts this
    // tab on every visit — a param left behind re-opens the sheet each time.
    arriveWith("tab=overview&editProfile=1&journey=blocks");

    expect(replace).toHaveBeenCalledWith("/clients/c1?tab=overview&journey=blocks", {
      scroll: false,
    });
  });

  it("does nothing when the param is absent", () => {
    const { onOpen } = arriveWith("tab=overview");

    expect(onOpen).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("ignores a value that is not the one it writes", () => {
    const { onOpen } = arriveWith("tab=overview&editProfile=yes");

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens ONCE even while the stripped URL has not committed", () => {
    // The effect re-runs on any re-render before `router.replace` lands, and
    // the param is still there — without the guard it re-opens a sheet the
    // coach may already have closed.
    const { onOpen, rerender } = arriveWith("tab=overview&editProfile=1");

    rerender();
    rerender();

    expect(onOpen).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledOnce();
  });

  it("drops the ? when the param was the only thing in the query", () => {
    arriveWith("editProfile=1");

    expect(replace).toHaveBeenCalledWith("/clients/c1", { scroll: false });
  });
});
