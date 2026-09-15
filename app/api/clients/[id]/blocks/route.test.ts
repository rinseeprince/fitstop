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

// The plan-start floor rides the chain payload; its own rules are proved in
// services/event-deletion-floor.test.ts.
vi.mock("@/services/event-deletion-floor", () => ({
  resolveEventDeletionFloor: vi.fn(),
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
  class BlockTrimsPendingError extends Error {
    constructor(readonly trims: unknown[]) {
      super("Saving this block changes plans that are already on the calendar.");
    }
  }
  return {
    listBlocks: vi.fn(),
    replaceBlockChain: vi.fn(),
    deleteBlock: vi.fn(),
    ElapsedBlockImmutableError,
    BlockWindowError,
    BlockPayloadError,
    UnknownBlockIdError,
    BlockTrimsPendingError,
  };
});

import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getClientTodayString } from "@/services/today-service";
import { resolveEventDeletionFloor } from "@/services/event-deletion-floor";
import { recordAuditEvent } from "@/services/audit-log-service";
import {
  listBlocks,
  replaceBlockChain,
  ElapsedBlockImmutableError,
  BlockWindowError,
  BlockPayloadError,
  BlockTrimsPendingError,
} from "@/services/client-blocks-service";
import { updateGoals, getCurrentGoals } from "@/services/client-goals-service";

const TODAY = "2026-08-11";
const mockParams = { params: Promise.resolve({ id: "client-1" }) };

// Domain-shaped fixtures (what the service returns).
const CURRENT_BLOCK = {
  id: "a",
  name: "Build",
  focus: null,
  startsOn: "2026-08-11",
  endsOn: "2026-09-07",
  archivedAt: null,
};
const FUTURE_BLOCK = {
  id: "b",
  name: "Cut",
  focus: "steady deficit",
  startsOn: "2026-09-08",
  endsOn: "2026-10-19",
  archivedAt: null,
};

const VALID_PUT_BODY = {
  blocks: [
    // Payload ids must be UUID-shaped (the schema pins the format the stored
    // ids actually have). Each block carries its OWN window (migration 164).
    {
      id: "3f2c8a4e-9d1b-4f6a-8e2d-1a2b3c4d5e6f",
      name: "Build",
      startsOn: "2026-08-11",
      endsOn: "2026-09-07",
    },
    { name: "Cut", startsOn: "2026-09-08", endsOn: "2026-10-19" },
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
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue(TODAY);
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
      // clientToday rides the payload (Session 3.4) so the delete-preview
      // runs computeDeleteShift with the SAME today the DELETE executes with.
      expect(payload.data.clientToday).toBe(TODAY);
      expect(payload.data.planStartFloor).toBe(TODAY);
    });

    it("carries the plan-start floor the server resolved, not merely today", async () => {
      // The client has logged today, so the earliest day a plan may start is
      // tomorrow. Both setup surfaces floor their pickers on this value, and
      // only the server can answer it — it depends on the client's logs.
      vi.mocked(listBlocks).mockResolvedValue([CURRENT_BLOCK]);
      vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-08-12");

      const response = await GET(createMockRequest("GET"), mockParams);
      const payload = await response.json();

      expect(resolveEventDeletionFloor).toHaveBeenCalledWith("client-1", TODAY);
      expect(payload.data.clientToday).toBe(TODAY);
      expect(payload.data.planStartFloor).toBe("2026-08-12");
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
        { blocks: [{ name: "X", startsOn: "2026-13-99", endsOn: "2026-09-07" }] }, // fake start date
        { blocks: [] }, // no blocks
        { blocks: [{ name: "", startsOn: "2026-08-11", endsOn: "2026-09-07" }] }, // no name
        { blocks: [{ name: "X", startsOn: "2026-08-11", endsOn: "2026-13-99" }] }, // fake end date
      ]) {
        const response = await PUT(createMockRequest("PUT", body), mockParams);
        expect(response.status).toBe(400);
      }
      expect(replaceBlockChain).not.toHaveBeenCalled();
    });

    it("saves the chain with the client's today and returns it decorated", async () => {
      vi.mocked(replaceBlockChain).mockResolvedValue({
        blocks: [CURRENT_BLOCK, FUTURE_BLOCK],
        trimmed: 0,
      });

      const response = await PUT(
        createMockRequest("PUT", VALID_PUT_BODY),
        mockParams
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(replaceBlockChain).toHaveBeenCalledWith(
        "client-1",
        TODAY,
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({ name: "Build", startsOn: "2026-08-11" }),
          ]),
        })
      );
      expect(payload.data.blocks).toHaveLength(2);
      // The seed helper writes this response straight into the chain cache,
      // so every echo of the payload carries the floor.
      expect(payload.data.planStartFloor).toBe(TODAY);
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "block.chain_update",
          targetTable: "client_phases",
          clientId: "client-1",
          metadata: { blockCount: 2, trimmedPlans: 0 },
        })
      );
    });

    it("answers 409 with the trims when the save changes plans and the coach has not said yes", async () => {
      const trims = [
        { track: "training", id: "p-1", name: "Power", startsOn: "2026-09-08", endsOn: "2026-11-01", newEndsOn: "2026-10-19" },
      ];
      vi.mocked(replaceBlockChain).mockRejectedValue(new BlockTrimsPendingError(trims as never));

      const response = await PUT(createMockRequest("PUT", VALID_PUT_BODY), mockParams);
      const payload = await response.json();

      expect(response.status).toBe(409);
      expect(payload).toEqual({
        success: false,
        error: "Saving this block changes plans that are already on the calendar.",
        data: { trims },
      });
      expect(recordAuditEvent).not.toHaveBeenCalled();
    });

    it("carries the coach's yes to the service, and audits how many plans it trimmed", async () => {
      vi.mocked(replaceBlockChain).mockResolvedValue({ blocks: [CURRENT_BLOCK], trimmed: 2 });

      const response = await PUT(
        createMockRequest("PUT", { ...VALID_PUT_BODY, confirmTrims: true }),
        mockParams
      );

      expect(response.status).toBe(200);
      const [, , input] = vi.mocked(replaceBlockChain).mock.calls[0];
      expect(input.confirmTrims).toBe(true);
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { blockCount: 1, trimmedPlans: 2 } })
      );
    });

    it("400s a yes that is anything but true", async () => {
      const response = await PUT(
        createMockRequest("PUT", { ...VALID_PUT_BODY, confirmTrims: "yes" }),
        mockParams
      );
      expect(response.status).toBe(400);
      expect(replaceBlockChain).not.toHaveBeenCalled();
    });

    it("strips a targetWeightKg a stale caller still sends — never refuses it", async () => {
      // A block carries no target. The schema has no such field, so the key
      // is dropped before the service sees the payload.
      vi.mocked(replaceBlockChain).mockResolvedValue({ blocks: [CURRENT_BLOCK], trimmed: 0 });

      const response = await PUT(
        createMockRequest("PUT", {
          blocks: [
            { name: "Cut", startsOn: "2026-09-08", endsOn: "2026-10-19", targetWeightKg: 85 },
          ],
        }),
        mockParams
      );

      expect(response.status).toBe(200);
      const [, , input] = vi.mocked(replaceBlockChain).mock.calls[0];
      expect(input.blocks[0]).toEqual({
        name: "Cut",
        startsOn: "2026-09-08",
        endsOn: "2026-10-19",
      });
    });

    it("NEVER touches the goal layer (invariant 7)", async () => {
      vi.mocked(replaceBlockChain).mockResolvedValue({ blocks: [CURRENT_BLOCK], trimmed: 0 });

      await PUT(createMockRequest("PUT", VALID_PUT_BODY), mockParams);

      expect(updateGoals).not.toHaveBeenCalled();
      expect(getCurrentGoals).not.toHaveBeenCalled();
    });

    it.each<[string, Error]>([
      ["elapsed immutability", new ElapsedBlockImmutableError("Past blocks can't be edited.")],
      ["window floor", new BlockWindowError("The block in progress must still cover today.")],
      ["extension", new BlockWindowError("A block can't be extended. Add a block after it.")],
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
