import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { DELETE, PATCH } from "./route";

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

// The factory defines the error classes so the route and this test share the
// same class objects for instanceof.
// The route reaches the two plan-delete services only behind ?clearPlans=true;
// both are stubbed so importing them does not pull in supabase-admin. Their own
// behaviour is proved in their own suites — here only that they are FIRED, in
// the right order, and only when asked.
vi.mock("@/services/training-plan-clear-service", () => ({
  clearTrainingPlansForClient: vi.fn().mockResolvedValue({ plansCleared: 0 }),
}));

vi.mock("@/services/nutrition-plan-clear-service", () => ({
  clearNutritionPlansForClient: vi.fn().mockResolvedValue({ versionsCleared: 0, versionIds: [] }),
}));

vi.mock("@/services/client-blocks-service", () => {
  class ElapsedBlockImmutableError extends Error {}
  class BlockWindowError extends Error {}
  class BlockPayloadError extends Error {}
  class UnknownBlockIdError extends Error {}
  return {
    listBlocks: vi.fn(),
    replaceBlockChain: vi.fn(),
    deleteBlock: vi.fn(),
    setBlockArchived: vi.fn(),
    ElapsedBlockImmutableError,
    BlockWindowError,
    BlockPayloadError,
    UnknownBlockIdError,
  };
});

import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getClientTodayString } from "@/services/today-service";
import { resolveEventDeletionFloor } from "@/services/event-deletion-floor";
import { recordAuditEvent } from "@/services/audit-log-service";
import { clearTrainingPlansForClient } from "@/services/training-plan-clear-service";
import { clearNutritionPlansForClient } from "@/services/nutrition-plan-clear-service";
import {
  BlockWindowError,
  deleteBlock,
  ElapsedBlockImmutableError,
  listBlocks,
  setBlockArchived,
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
  archivedAt: null,
};


function createMockRequest(search = "") {
  return new NextRequest(
    `http://localhost:3000/api/clients/client-1/blocks/block-b${search}`,
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
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue(TODAY);
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

  it("deletes with the client's today and returns the fresh chain", async () => {
    // No mode and no realized changes on the wire: a block owns its own window,
    // so deleting one moves nothing else and there is no consequence to report.
    vi.mocked(deleteBlock).mockResolvedValue({ blocks: [REMAINING_BLOCK] });

    const response = await DELETE(createMockRequest(), mockParams);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(deleteBlock).toHaveBeenCalledWith("client-1", TODAY, "block-b");
    expect(payload.data.mode).toBeUndefined();
    expect(payload.data.changes).toBeUndefined();
    expect(payload.data.clientToday).toBe(TODAY);
    // Every echo of the chain payload carries the plan-start floor: the seed
    // helper writes this response straight into the chain cache.
    expect(payload.data.planStartFloor).toBe(TODAY);
    expect(payload.data.blocks[0]).toEqual(
      expect.objectContaining({ id: "a", state: "past", weeks: 2 })
    );
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "block.delete",
        targetTable: "client_phases",
        targetId: "block-b",
        clientId: "client-1",
        metadata: { blockCount: 1, clearedPlans: false },
      })
    );
  });

  it("scopes both plan deletes to THIS block's window, nutrition first", async () => {
    // A block delete is about one block's date range. Both tracks answer
    // "does this plan belong here?" from dates — a program is truncated to the
    // block it is placed in, a version's end is resolved to the block its start
    // falls in — so a LATER block keeps its own program and its own targets.
    //
    // NUTRITION FIRST is load-bearing: its clear archives the block's versions
    // and removes their days, so the training clear's own cascade then finds no
    // active version governing those days and rebuilds nothing.
    vi.mocked(deleteBlock).mockResolvedValue({ blocks: [REMAINING_BLOCK] });
    vi.mocked(listBlocks).mockResolvedValue([
      {
        id: "block-b",
        name: "Cut",
        focus: null,
        targetWeightKg: null,
        startsOn: "2026-08-11",
        endsOn: "2026-09-07",
        archivedAt: null,
      },
    ]);

    const response = await DELETE(createMockRequest("?clearPlans=true"), mockParams);

    expect(response.status).toBe(200);
    expect(clearNutritionPlansForClient).toHaveBeenCalledWith("client-1", TODAY, {
      from: "2026-08-11",
      to: "2026-09-07",
    });
    expect(clearTrainingPlansForClient).toHaveBeenCalledWith("client-1", TODAY, {
      from: "2026-08-11",
      to: "2026-09-07",
    });
    expect(
      vi.mocked(clearNutritionPlansForClient).mock.invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(clearTrainingPlansForClient).mock.invocationCallOrder[0]
    );
    // Both BEFORE the row goes.
    expect(
      vi.mocked(clearTrainingPlansForClient).mock.invocationCallOrder[0]
    ).toBeLessThan(vi.mocked(deleteBlock).mock.invocationCallOrder[0]);
  });

  it("touches no plan without ?clearPlans=true", async () => {
    // What keeps "a block edit writes nothing on its own" true.
    vi.mocked(deleteBlock).mockResolvedValue({ blocks: [REMAINING_BLOCK] });

    await DELETE(createMockRequest(), mockParams);

    expect(clearNutritionPlansForClient).not.toHaveBeenCalled();
    expect(clearTrainingPlansForClient).not.toHaveBeenCalled();
  });

  it("stops before deleting the block when a plan delete fails", async () => {
    // Losing the block while its plans survive is the one outcome that cannot
    // be undone from the UI: the label is gone and the prescription is not.
    vi.mocked(listBlocks).mockResolvedValue([
      {
        id: "block-b", name: "Cut", focus: null, targetWeightKg: null,
        startsOn: "2026-08-11", endsOn: "2026-09-07", archivedAt: null,
      },
    ]);
    vi.mocked(clearNutritionPlansForClient).mockRejectedValueOnce(new Error("boom"));

    const response = await DELETE(createMockRequest("?clearPlans=true"), mockParams);

    expect(response.status).toBe(500);
    expect(clearTrainingPlansForClient).not.toHaveBeenCalled();
    expect(deleteBlock).not.toHaveBeenCalled();
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

function createPatchRequest(body: Record<string, unknown>) {
  return new NextRequest(
    "http://localhost:3000/api/clients/client-1/blocks/block-b",
    {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );
}

describe("/api/clients/[id]/blocks/[blockId] PATCH (archive)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: true,
      coachId: "coach-1",
    });
    vi.mocked(getClientTodayString).mockResolvedValue(TODAY);
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue(TODAY);
  });

  it("404s a client the coach does not own, before any read", async () => {
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
    });

    const response = await PATCH(createPatchRequest({ archived: true }), mockParams);

    expect(response.status).toBe(404);
    expect(setBlockArchived).not.toHaveBeenCalled();
  });

  it("400s a non-boolean payload before the service runs", async () => {
    const response = await PATCH(
      createPatchRequest({ archived: "yes" }),
      mockParams
    );
    expect(response.status).toBe(400);
    expect(setBlockArchived).not.toHaveBeenCalled();
  });

  it("archives with the client's today, audits, and returns the decorated chain", async () => {
    vi.mocked(setBlockArchived).mockResolvedValue([
      { ...REMAINING_BLOCK, archivedAt: "2026-08-12T09:00:00Z" },
    ]);

    const response = await PATCH(createPatchRequest({ archived: true }), mockParams);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(setBlockArchived).toHaveBeenCalledWith(
      "client-1",
      TODAY,
      "block-b",
      true
    );
    expect(payload.data.clientToday).toBe(TODAY);
    expect(payload.data.planStartFloor).toBe(TODAY);
    expect(payload.data.blocks[0]).toEqual(
      expect.objectContaining({ id: "a", archivedAt: "2026-08-12T09:00:00Z" })
    );
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "block.archive",
        targetTable: "client_phases",
        targetId: "block-b",
        clientId: "client-1",
        metadata: { archived: true },
      })
    );
  });

  it("422s a non-elapsed block with the service's message", async () => {
    vi.mocked(setBlockArchived).mockRejectedValue(
      new BlockWindowError("Only completed blocks can be archived.")
    );

    const response = await PATCH(createPatchRequest({ archived: true }), mockParams);
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload.error).toBe("Only completed blocks can be archived.");
  });

  it("404s an unknown block id", async () => {
    vi.mocked(setBlockArchived).mockRejectedValue(
      new UnknownBlockIdError("Block not found")
    );

    const response = await PATCH(createPatchRequest({ archived: false }), mockParams);
    expect(response.status).toBe(404);
  });

  it("500s unexpected failures without leaking the raw error", async () => {
    vi.mocked(setBlockArchived).mockRejectedValue(new Error("connection reset"));

    const response = await PATCH(createPatchRequest({ archived: true }), mockParams);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe("Failed to archive block");
  });
});
