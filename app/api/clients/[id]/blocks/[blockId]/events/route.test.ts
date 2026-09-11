import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "./route";

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

vi.mock("@/services/client-blocks-service", () => ({
  listBlocks: vi.fn(),
}));

// The clear's own behaviour is proved in services/block-event-sync-service.test.ts;
// here only that it is FIRED with the block's own end, and only when asked.
vi.mock("@/services/block-event-sync-service", () => ({
  clearEventsOutsideBlock: vi.fn(),
}));

import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getClientTodayString } from "@/services/today-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { listBlocks } from "@/services/client-blocks-service";
import { clearEventsOutsideBlock } from "@/services/block-event-sync-service";

const TODAY = "2026-08-11";
const mockParams = {
  params: Promise.resolve({ id: "client-1", blockId: "block-b" }),
};

const BLOCK = {
  id: "block-b",
  name: "Build",
  focus: null,
  startsOn: "2026-08-01",
  endsOn: "2026-09-27",
  archivedAt: null,
};

function createMockRequest(body: unknown) {
  return new NextRequest(
    "http://localhost:3000/api/clients/client-1/blocks/block-b/events",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

// The contract is CLEAR-ONLY: a block's end never moves later, so there is no
// fill to run. The shorten's dialog posts `{ mode: "clear" }` and nothing else.
describe("/api/clients/[id]/blocks/[blockId]/events POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: true,
      coachId: "coach-1",
    });
    vi.mocked(getClientTodayString).mockResolvedValue(TODAY);
    vi.mocked(listBlocks).mockResolvedValue([BLOCK]);
    vi.mocked(clearEventsOutsideBlock).mockResolvedValue({ trainingCleared: 3 });
  });

  it("404s a client the coach does not own, before any read", async () => {
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
    });

    const response = await POST(createMockRequest({ mode: "clear" }), mockParams);

    expect(response.status).toBe(404);
    expect(listBlocks).not.toHaveBeenCalled();
    expect(clearEventsOutsideBlock).not.toHaveBeenCalled();
  });

  it("400s a fill — the route knows only the clear", async () => {
    const response = await POST(
      createMockRequest({ mode: "fill", nutrition: "keep" }),
      mockParams
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ success: false, error: "Invalid request" });
    expect(listBlocks).not.toHaveBeenCalled();
    expect(clearEventsOutsideBlock).not.toHaveBeenCalled();
  });

  it("404s a block the client does not have", async () => {
    vi.mocked(listBlocks).mockResolvedValue([{ ...BLOCK, id: "other" }]);

    const response = await POST(createMockRequest({ mode: "clear" }), mockParams);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ success: false, error: "Block not found" });
    expect(clearEventsOutsideBlock).not.toHaveBeenCalled();
  });

  it("clears past the block's own end and answers with what it cleared", async () => {
    const response = await POST(createMockRequest({ mode: "clear" }), mockParams);
    const payload = await response.json();

    expect(clearEventsOutsideBlock).toHaveBeenCalledWith({
      clientId: "client-1",
      clientToday: TODAY,
      blockEndsOn: "2026-09-27",
    });
    expect(response.status).toBe(200);
    expect(payload).toEqual({ success: true, data: { trainingCleared: 3 } });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "block.chain_update",
        targetTable: "client_phases",
        targetId: "block-b",
        clientId: "client-1",
        metadata: { mode: "clear", trainingCleared: 3 },
      })
    );
  });

  it("500s a failed clear without leaking the raw error", async () => {
    vi.mocked(clearEventsOutsideBlock).mockRejectedValue(
      new Error("duplicate key value violates unique constraint")
    );

    const response = await POST(createMockRequest({ mode: "clear" }), mockParams);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ success: false, error: "Could not update the calendar" });
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });
});
