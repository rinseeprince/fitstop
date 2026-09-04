import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { listBlocks } from "@/services/client-blocks-service";
import {
  clearEventsOutsideBlock,
  extendTrainingToBlockEnd,
  fillNutritionAcrossBlock,
  regenerateNutritionForBlock,
} from "@/services/block-event-sync-service";
import { getClientTodayString } from "@/services/today-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { captureApiError } from "@/lib/error-handler";

// Bring a client's calendar in line with a block whose dates the coach has just
// changed. NEVER automatic: the blocks screen saves the dates first, then offers
// this, and nothing here runs without the coach picking it. That is what keeps
// "a block edit writes nothing on its own" true.
//
// It reconciles rather than replaying a diff — `fill` covers the block, `clear`
// removes what now sits outside it — so it needs no memory of the old window and
// re-running it changes nothing.

const syncSchema = z.object({
  mode: z.enum(["fill", "clear"]),
  // fill only: keep the targets the client is working to, or re-price them
  // against their current weight and goal.
  nutrition: z.enum(["keep", "regenerate"]).optional(),
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

    if (parsed.data.mode === "clear") {
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
        metadata: { mode: "clear", ...cleared },
        request,
      });
      return NextResponse.json({ success: true, data: cleared }, { status: 200 });
    }

    // ORDER IS LOAD-BEARING, in three steps.
    //
    // 1. `regenerate` mints the version whose numbers the fill will materialise,
    //    so it has to precede it or the fill writes the outgoing prescription.
    if (parsed.data.nutrition === "regenerate") {
      await regenerateNutritionForBlock({ clientId, clientToday, block });
    }

    // 2. The training extension SECOND: its new days carry the surpluses, and
    //    the nutrition generator reads the training event on each date it
    //    writes. Filled first, every new day would be priced as a rest day and
    //    only a later cascade would correct it.
    const training = await extendTrainingToBlockEnd({
      clientId,
      clientToday,
      blockStartsOn: block.startsOn,
      blockEndsOn: block.endsOn,
    });

    // 3. The nutrition fill LAST, so it sees both.
    const nutrition = await fillNutritionAcrossBlock({
      clientId,
      clientToday,
      blockStartsOn: block.startsOn,
      blockEndsOn: block.endsOn,
    });

    void recordAuditEvent({
      actorId: auth.coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.BLOCK_CHAIN_UPDATE,
      targetTable: "client_phases",
      targetId: blockId,
      clientId,
      metadata: {
        mode: "fill",
        nutrition: parsed.data.nutrition ?? "keep",
        slotsAdded: training?.slotsAdded ?? 0,
      },
      request,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          nutritionFilledFrom: nutrition?.from ?? null,
          // null means the training could not be continued — no program in the
          // block, or one placed before its pass length was recorded. The coach
          // is told to place a program rather than handed a guessed one.
          training,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    captureApiError(error, { action: "block-event-sync", clientId });
    return NextResponse.json(
      { success: false, error: "Could not update the calendar" },
      { status: 500 }
    );
  }
}
