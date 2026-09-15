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

// Delete one journey block, and its plans with it: the running plan on each
// track ends yesterday, a queued one is removed, then the row goes. No other
// block moves (migration 164). Elapsed blocks 422.
//
// It reuses the two clears the calendars' own deletes call, each given this
// block's window, rather than inventing a block-scoped deletion: a rule for
// which plans "belong to" a block is how a pointer architecture arrives by the
// back door, and blocks carry DATES, never an id anything else points at.
//
// Both deletes are SCOPED TO THIS BLOCK's window: a block contains its plans,
// so the plans starting in its days are its own, and a later block keeps its
// own program and its own targets.

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

    // Nutrition, then training, then the block. The two clears are
    // independent — each ends its own plans and writes nothing the other
    // reads — but both run BEFORE the row goes: losing the label while the
    // prescription survives is the one outcome the UI cannot undo. An elapsed
    // block ends no plan: its row refuses below, and so its plans are left be.
    const block = (await listBlocks(clientId)).find((b) => b.id === blockId);
    if (!block) throw new UnknownBlockIdError("Block not found");
    if (block.endsOn < clientToday) {
      throw new ElapsedBlockImmutableError("Past blocks are read-only.");
    }

    const { versionsCleared } = await clearNutritionPlansForClient(clientId, clientToday, {
      from: block.startsOn,
      to: block.endsOn,
    });
    const { plansCleared } = await clearTrainingPlansForClient(clientId, clientToday, {
      from: block.startsOn,
      to: block.endsOn,
    });
    const cleared = {
      nutritionVersionsCleared: versionsCleared,
      trainingPlansCleared: plansCleared,
    };

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
      metadata: { blockCount: result.blocks.length, ...cleared },
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
