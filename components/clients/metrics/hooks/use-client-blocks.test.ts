import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { mockUseSWR } = vi.hoisted(() => ({ mockUseSWR: vi.fn() }));
vi.mock("swr", () => ({
  __esModule: true,
  default: (key: unknown) => mockUseSWR(key),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}));

import { useClientBlocks } from "./use-client-blocks";

describe("useClientBlocks", () => {
  beforeEach(() => {
    mockUseSWR.mockReset();
    mockUseSWR.mockReturnValue({ data: undefined, error: undefined, isLoading: true });
  });

  it("reads the plan-start floor off the chain payload, beside the client's today", () => {
    // The floor is a server answer (it depends on the client's logs); the two
    // setup surfaces floor their date pickers on it (commit B).
    mockUseSWR.mockReturnValue({
      data: {
        success: true,
        data: { blocks: [], clientToday: "2026-03-09", planStartFloor: "2026-03-10" },
      },
      error: undefined,
      isLoading: false,
    });

    const { result } = renderHook(() => useClientBlocks("client-1"));

    expect(mockUseSWR).toHaveBeenCalledWith("/api/clients/client-1/blocks");
    expect(result.current.clientToday).toBe("2026-03-09");
    expect(result.current.planStartFloor).toBe("2026-03-10");
  });

  it("fetches nothing for an empty client id, and reads as nothing yet", () => {
    // The apply dialog holds this until a client is picked on the library path.
    const { result } = renderHook(() => useClientBlocks(""));

    expect(mockUseSWR).toHaveBeenCalledWith(null);
    expect(result.current.blocks).toEqual([]);
    expect(result.current.clientToday).toBeNull();
    expect(result.current.planStartFloor).toBeNull();
  });
});
