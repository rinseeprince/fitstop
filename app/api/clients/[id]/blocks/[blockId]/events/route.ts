import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { listBlocks } from "@/services/client-blocks-service";
import { clearEventsOutsideBlock } from "@/services/block-event-sync-service";
import { getClientTodayString } from "@/services/today-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { captureApiError } from "@/lib/error-handler";

// Bring a client's calendar in line with a block the coach has just SHORTENED.
// NEVER automatic: the blocks screen saves the dates first, then offers this,
// and nothing here runs without the coach picking it. That is what keeps "a
// block edit writes nothing on its own" true.
//
// The one mode is `clear`: remove the scheduled days that now sit outside the
// block and pull both tracks' windows back to it. A block's end never moves
// later (the chain PUT refuses it), so there is nothing to fill. The clear
// reconciles rather than replaying a diff — it needs no memory of the old
// window and re-running it changes nothing.

const syncSchema = z.object({
  mode: z.literal("clear"),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; blockId: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  const { id: clientId, blockId } = await params;
  const auth = await requireCoachOwnsClient(clientId, request);
  if (!auth.authorized) return auth.response;

  const parsed = syncSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid request" },
      { status: 400 }
    );
  }

  try {
    const clientToday = await getClientTodayString(clientId);
    const block = (await listBlocks(clientId)).find((b) => b.id === blockId);
    if (!block) {
      return NextResponse.json(
        { success: false, error: "Block not found" },
        { status: 404 }
      );
    }

    const cleared = await clearEventsOutsideBlock({
      clientId,
      clientToday,
      blockEndsOn: block.endsOn,
    });
    void recordAuditEvent({
      actorId: auth.coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.BLOCK_CHAIN_UPDATE,
      targetTable: "client_phases",
      targetId: blockId,
      clientId,
      metadata: { mode: parsed.data.mode, ...cleared },
      request,
    });
    return NextResponse.json({ success: true, data: cleared }, { status: 200 });
  } catch (error) {
    captureApiError(error, { action: "block-event-sync", clientId });
    return NextResponse.json(
      { success: false, error: "Could not update the calendar" },
      { status: 500 }
    );
  }
}
