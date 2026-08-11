import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { DELETE } from "./route";

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/require-coach-auth", () => ({
  requireCoachOwnsClient: vi.fn(),
}));

vi.mock("@/services/audit-log-service", () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/today-service", () => ({
  getClientTodayString: vi.fn(),
}));

// The factory defines the error classes so the route and this test share the
// same class objects for instanceof.
vi.mock("@/services/client-blocks-service", () => {
  class ElapsedBlockImmutableError extends Error {}
  class BlockWindowError extends Error {}
  class BlockPayloadError extends Error {}
  class UnknownBlockIdError extends Error {}
  return {
    listBlocks: vi.fn(),
    replaceBlockChain: vi.fn(),
    deleteBlock: vi.fn(),
    ElapsedBlockImmutableError,
    BlockWindowError,
    BlockPayloadError,
    UnknownBlockIdError,
  };
});

import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getClientTodayString } from "@/services/today-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import {
  deleteBlock,
  ElapsedBlockImmutableError,
  UnknownBlockIdError,
} from "@/services/client-blocks-service";

const TODAY = "2026-08-11";
const mockParams = {
  params: Promise.resolve({ id: "client-1", blockId: "block-b" }),
};

const REMAINING_BLOCK = {
  id: "a",
  name: "Build",
  focus: null,
  targetWeightKg: null,
  startsOn: "2026-08-01",
  endsOn: "2026-08-10", // truncated at yesterday
};

const CHANGES = [
  {
    id: "a",
    name: "Build",
    previous: { startsOn: "2026-08-01", endsOn: "2026-09-11" },
    next: { startsOn: "2026-08-01", endsOn: "2026-08-10" },
  },
];

function createMockRequest() {
  return new NextRequest(
    "http://localhost:3000/api/clients/client-1/blocks/block-b",
    { method: "DELETE" }
  );
}

describe("/api/clients/[id]/blocks/[blockId] DELETE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: true,
      coachId: "coach-1",
    });
    vi.mocked(getClientTodayString).mockResolvedValue(TODAY);
  });

  it("404s a client the coach does not own, before any read", async () => {
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
    });

    const response = await DELETE(createMockRequest(), mockParams);

    expect(response.status).toBe(404);
    expect(deleteBlock).not.toHaveBeenCalled();
  });

  it("deletes with the client's today and returns mode + realized changes + fresh chain", async () => {
    vi.mocked(deleteBlock).mockResolvedValue({
      mode: "truncated",
      changes: CHANGES,
      blocks: [REMAINING_BLOCK],
    });

    const response = await DELETE(createMockRequest(), mockParams);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(deleteBlock).toHaveBeenCalledWith("client-1", TODAY, "block-b");
    expect(payload.data.mode).toBe("truncated");
    expect(payload.data.changes).toEqual(CHANGES);
    expect(payload.data.blocks[0]).toEqual(
      expect.objectContaining({ id: "a", state: "past", weeks: 2 })
    );
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "block.delete",
        targetTable: "client_phases",
        targetId: "block-b",
        clientId: "client-1",
        metadata: { mode: "truncated", shiftedCount: 1 },
      })
    );
  });

  it("404s an unknown block id", async () => {
    vi.mocked(deleteBlock).mockRejectedValue(new UnknownBlockIdError("Block not found"));

    const response = await DELETE(createMockRequest(), mockParams);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe("Block not found");
  });

  it("422s an elapsed block", async () => {
    vi.mocked(deleteBlock).mockRejectedValue(
      new ElapsedBlockImmutableError("Past blocks are read-only.")
    );

    const response = await DELETE(createMockRequest(), mockParams);

    expect(response.status).toBe(422);
  });

  it("500s unexpected failures without leaking the raw error", async () => {
    vi.mocked(deleteBlock).mockRejectedValue(new Error("connection reset"));

    const response = await DELETE(createMockRequest(), mockParams);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe("Failed to delete block");
  });
});
