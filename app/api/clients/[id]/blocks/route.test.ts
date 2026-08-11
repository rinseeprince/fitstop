import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET, PUT } from "./route";

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

// Invariant 7's route-half tripwire: blocks save independently of the goal.
// The goals service is mocked with spies so that if anyone ever wires
// updateGoals into this route, the never-called pin below fails.
vi.mock("@/services/client-goals-service", () => ({
  getCurrentGoals: vi.fn(),
  updateGoals: vi.fn(),
  getGoalsHistory: vi.fn(),
}));

// The factory defines the error classes so the route (importing from the
// mocked module) and this test throw/instanceof-check the SAME class objects.
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
  listBlocks,
  replaceBlockChain,
  ElapsedBlockImmutableError,
  BlockWindowError,
  BlockPayloadError,
} from "@/services/client-blocks-service";
import { updateGoals, getCurrentGoals } from "@/services/client-goals-service";

const TODAY = "2026-08-11";
const mockParams = { params: Promise.resolve({ id: "client-1" }) };

// Domain-shaped fixtures (what the service returns).
const CURRENT_BLOCK = {
  id: "a",
  name: "Build",
  focus: null,
  targetWeightKg: null,
  startsOn: "2026-08-11",
  endsOn: "2026-09-07",
};
const FUTURE_BLOCK = {
  id: "b",
  name: "Cut",
  focus: "steady deficit",
  targetWeightKg: 85,
  startsOn: "2026-09-08",
  endsOn: "2026-10-19",
};

const VALID_PUT_BODY = {
  startsOn: "2026-08-11",
  blocks: [
    // Payload ids must be UUID-shaped (the schema pins the format the stored
    // ids actually have).
    { id: "3f2c8a4e-9d1b-4f6a-8e2d-1a2b3c4d5e6f", name: "Build", weeks: 4 },
    { name: "Cut", weeks: 6, targetWeightKg: 85 },
  ],
};

function createMockRequest(method: string, body?: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/clients/client-1/blocks", {
    method,
    ...(body
      ? {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        }
      : {}),
  });
}

const notFoundAuth = {
  authorized: false as const,
  response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
};

describe("/api/clients/[id]/blocks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: true,
      coachId: "coach-1",
    });
    vi.mocked(getClientTodayString).mockResolvedValue(TODAY);
  });

  describe("GET", () => {
    it("404s a client the coach does not own, before any read", async () => {
      vi.mocked(requireCoachOwnsClient).mockResolvedValue(notFoundAuth);

      const response = await GET(createMockRequest("GET"), mockParams);

      expect(response.status).toBe(404);
      expect(listBlocks).not.toHaveBeenCalled();
    });

    it("returns the chain decorated with date-derived fields, no-store", async () => {
      vi.mocked(listBlocks).mockResolvedValue([CURRENT_BLOCK, FUTURE_BLOCK]);

      const response = await GET(createMockRequest("GET"), mockParams);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(payload.data.blocks).toEqual([
        {
          ...CURRENT_BLOCK,
          weeks: 4,
          state: "current",
          weekOfTotal: { current: 1, total: 4 },
        },
        { ...FUTURE_BLOCK, weeks: 6, state: "future", weekOfTotal: null },
      ]);
      // No pace field on the wire: pace is a client-side derivation fed by
      // the merged series (plan doc Task 3.2 — "no new API").
      expect(payload.data.blocks[0]).not.toHaveProperty("pace");
    });
  });

  describe("PUT", () => {
    it("404s a client the coach does not own, before validation", async () => {
      vi.mocked(requireCoachOwnsClient).mockResolvedValue(notFoundAuth);

      const response = await PUT(
        createMockRequest("PUT", VALID_PUT_BODY),
        mockParams
      );

      expect(response.status).toBe(404);
      expect(replaceBlockChain).not.toHaveBeenCalled();
    });

    it("400s invalid payloads before the service runs", async () => {
      for (const body of [
        { startsOn: "2026-13-99", blocks: [{ name: "X", weeks: 4 }] }, // fake date
        { startsOn: "2026-08-11", blocks: [] }, // empty chain
        { startsOn: "2026-08-11", blocks: [{ name: "", weeks: 4 }] }, // no name
        { startsOn: "2026-08-11", blocks: [{ name: "X", weeks: 0 }] }, // weeks < 1
      ]) {
        const response = await PUT(createMockRequest("PUT", body), mockParams);
        expect(response.status).toBe(400);
      }
      expect(replaceBlockChain).not.toHaveBeenCalled();
    });

    it("saves the chain with the client's today and returns it decorated", async () => {
      vi.mocked(replaceBlockChain).mockResolvedValue([
        CURRENT_BLOCK,
        FUTURE_BLOCK,
      ]);

      const response = await PUT(
        createMockRequest("PUT", VALID_PUT_BODY),
        mockParams
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(replaceBlockChain).toHaveBeenCalledWith(
        "client-1",
        TODAY,
        expect.objectContaining({ startsOn: "2026-08-11" })
      );
      expect(payload.data.blocks).toHaveLength(2);
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "block.chain_update",
          targetTable: "client_phases",
          clientId: "client-1",
        })
      );
    });

    it("NEVER touches the goal layer (invariant 7)", async () => {
      vi.mocked(replaceBlockChain).mockResolvedValue([CURRENT_BLOCK]);

      await PUT(createMockRequest("PUT", VALID_PUT_BODY), mockParams);

      expect(updateGoals).not.toHaveBeenCalled();
      expect(getCurrentGoals).not.toHaveBeenCalled();
    });

    it.each<[string, Error]>([
      ["elapsed immutability", new ElapsedBlockImmutableError("Past blocks can't be edited.")],
      ["window floor", new BlockWindowError("The block in progress must still cover today.")],
      ["payload shape", new BlockPayloadError("Unknown block id in payload.")],
    ])("maps a %s rejection to 422 with the service message", async (_label, error) => {
      vi.mocked(replaceBlockChain).mockRejectedValue(error);

      const response = await PUT(
        createMockRequest("PUT", VALID_PUT_BODY),
        mockParams
      );
      const payload = await response.json();

      expect(response.status).toBe(422);
      expect(payload).toEqual({ success: false, error: error.message });
    });

    it("500s on unexpected failures without leaking the raw error", async () => {
      vi.mocked(replaceBlockChain).mockRejectedValue(
        new Error("duplicate key value violates unique constraint")
      );

      const response = await PUT(
        createMockRequest("PUT", VALID_PUT_BODY),
        mockParams
      );
      const payload = await response.json();

      expect(response.status).toBe(500);
      expect(payload.error).toBe("Failed to save blocks");
    });
  });
});
