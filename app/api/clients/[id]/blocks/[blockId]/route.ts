import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { decorateBlocks } from "@/lib/blocks/block-derivations";
import { archiveBlockSchema } from "@/lib/validations/client-blocks";
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
import { getClientTodayString } from "@/services/today-service";
import { resolveEventDeletionFloor } from "@/services/event-deletion-floor";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";

// Delete one journey block: the row goes and nothing else moves (migration 164).
// Elapsed blocks 422.
//
// `?clearPlans=true` additionally fires THREE THINGS THE COACH CAN ALREADY DO,
// together: delete the nutrition plan, delete the training plan, delete the
// block. It is the coach's answer to the confirm dialog, never a default —
// without it nothing but the row goes, which is the rule that a block edit
// writes nothing on its own.
//
// It reuses the two clears the calendars' own deletes call, each given this
// block's window, rather than inventing a block-scoped deletion: a rule for
// which plans "belong to" a block is how a pointer architecture arrives by the
// back door, and blocks carry DATES, never an id anything else points at.
//
// Clearing the block's own days and leaving the plans standing was an earlier
// behaviour and did not survive contact: the plans regenerate the days on the
// next cascade, so the delete undid itself.
//
// Both deletes are SCOPED TO THIS BLOCK's window. A later block keeps its own
// program and its own targets — the coach asked about one block's date range,
// and nothing outside it is theirs to remove here.

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; blockId: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: clientId, blockId } = await params;

    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    const clientToday = await getClientTodayString(clientId);
    const clearPlans =
      new URL(request.url).searchParams.get("clearPlans") === "true";

    // Nutrition FIRST. Its clear archives the block's versions and removes
    // their days, so the training clear's own cascade then finds no active
    // version governing those days and rebuilds nothing. The other order works
    // too but writes days it is about to remove.
    let cleared:
      | { nutritionVersionsCleared: number; trainingPlansCleared: number }
      | null = null;
    if (clearPlans) {
      // SCOPED TO THIS BLOCK. Both tracks answer "does this plan belong to the
      // block?" from dates alone — a program is truncated to the block it is
      // placed in, and a version's end is resolved to the block its start
      // falls in — so the windows line up with the block's by construction and
      // no pointer is needed. A plan that merely CROSSES the block belongs to
      // an earlier one and survives; the coach removes it from its own calendar.
      const block = (await listBlocks(clientId)).find((b) => b.id === blockId);
      if (!block) throw new UnknownBlockIdError("Block not found");

      const { versionsCleared } = await clearNutritionPlansForClient(clientId, clientToday, {
        from: block.startsOn,
        to: block.endsOn,
      });
      const { plansCleared } = await clearTrainingPlansForClient(clientId, clientToday, {
        from: block.startsOn,
        to: block.endsOn,
      });
      cleared = {
        nutritionVersionsCleared: versionsCleared,
        trainingPlansCleared: plansCleared,
      };
    }

    // The chain payload carries the plan-start floor beside the client's today
    // (see the GET); it does not depend on the delete, so the two run together.
    const [result, planStartFloor] = await Promise.all([
      deleteBlock(clientId, clientToday, blockId),
      resolveEventDeletionFloor(clientId, clientToday),
    ]);

    void recordAuditEvent({
      actorId: auth.coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.BLOCK_DELETE,
      targetTable: "client_phases",
      targetId: blockId,
      clientId,
      metadata: { blockCount: result.blocks.length, clearedPlans: clearPlans },
      request,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          blocks: decorateBlocks(result.blocks, clientToday),
          cleared,
          clientToday,
          planStartFloor,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof UnknownBlockIdError) {
      return NextResponse.json(
        { success: false, error: "Block not found" },
        { status: 404 }
      );
    }
    if (error instanceof ElapsedBlockImmutableError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 422 }
      );
    }
    console.error("Error deleting block:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete block" },
      { status: 500 }
    );
  }
}

// Archive (true) or restore (false) an ELAPSED block — a coach view
// preference (Session 3.7): the block leaves the main Journey list for the
// Archive view. No derivation consults archived_at; the chain PUT never
// writes it; the GET keeps returning every block so the chain contracts
// always see the full chain.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; blockId: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: clientId, blockId } = await params;

    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    const body: unknown = await request.json();
    const validation = archiveBlockSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid input",
          details: validation.error.errors,
        },
        { status: 400 }
      );
    }

    const clientToday = await getClientTodayString(clientId);
    const [blocks, planStartFloor] = await Promise.all([
      setBlockArchived(clientId, clientToday, blockId, validation.data.archived),
      resolveEventDeletionFloor(clientId, clientToday),
    ]);

    void recordAuditEvent({
      actorId: auth.coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.BLOCK_ARCHIVE,
      targetTable: "client_phases",
      targetId: blockId,
      clientId,
      metadata: { archived: validation.data.archived },
      request,
    });

    return NextResponse.json(
      {
        success: true,
        data: { blocks: decorateBlocks(blocks, clientToday), clientToday, planStartFloor },
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof UnknownBlockIdError) {
      return NextResponse.json(
        { success: false, error: "Block not found" },
        { status: 404 }
      );
    }
    if (error instanceof BlockWindowError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 422 }
      );
    }
    console.error("Error archiving block:", error);
    return NextResponse.json(
      { success: false, error: "Failed to archive block" },
      { status: 500 }
    );
  }
}
