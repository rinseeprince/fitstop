import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { mockUseSWR } = vi.hoisted(() => ({ mockUseSWR: vi.fn() }));
vi.mock("swr", () => ({
  __esModule: true,
  default: (key: unknown) => mockUseSWR(key),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}));

import { deleteBlockRequest, putBlockChain, useClientBlocks } from "./use-client-blocks";

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("putBlockChain — a save, or the question it raises", () => {
  const payload = { blocks: [{ name: "Build", startsOn: "2026-10-06", endsOn: "2026-11-02" }] };
  const respond = (status: number, body: unknown) =>
    vi.fn().mockResolvedValue({ ok: status < 400, status, json: () => Promise.resolve(body) });

  it("a save comes back with the chain", async () => {
    const data = { blocks: [], clientToday: "2026-09-15", planStartFloor: "2026-09-15" };
    vi.stubGlobal("fetch", respond(200, { success: true, data }));

    await expect(putBlockChain("c1", payload)).resolves.toEqual({ saved: data });
  });

  it("a 409 carrying trims is the question, not a failure", async () => {
    const trims = [{ track: "training", id: "p-1", name: "Power", startsOn: "2026-10-06", endsOn: "2026-11-29", newEndsOn: "2026-11-02" }];
    vi.stubGlobal("fetch", respond(409, { success: false, error: "Saving this block changes plans that are already on the calendar.", data: { trims } }));

    await expect(putBlockChain("c1", payload)).resolves.toEqual({ trims });
  });

  it("any other refusal throws its sentence", async () => {
    vi.stubGlobal("fetch", respond(422, { success: false, error: "A block can't be extended. Add a block after it." }));

    await expect(putBlockChain("c1", payload)).rejects.toThrow("A block can't be extended. Add a block after it.");
  });
});

describe("deleteBlockRequest — a block goes with its plans", () => {
  it("asks for nothing but the delete: there is no keep-the-plans variant", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { blocks: [], clientToday: "2026-09-15", planStartFloor: "2026-09-15" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await deleteBlockRequest("c1", "blk-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/clients/c1/blocks/blk-1", { method: "DELETE" });
  });
});
