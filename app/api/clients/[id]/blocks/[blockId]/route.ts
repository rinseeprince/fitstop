import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { decorateBlocks } from "@/lib/blocks/block-derivations";
import { archiveBlockSchema } from "@/lib/validations/client-blocks";
import {
  BlockWindowError,
  deleteBlock,
  ElapsedBlockImmutableError,
  setBlockArchived,
  UnknownBlockIdError,
} from "@/services/client-blocks-service";
import { getClientTodayString } from "@/services/today-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";

// Delete one journey block. A future block's row is removed and what follows
// shifts back by its full duration; the block the client is currently inside
// TRUNCATES at yesterday (the next block starts today); elapsed blocks 422.
// The response carries the realized date changes — computed by the same pure
// helper (lib/blocks/block-chain.ts) the confirm dialog uses for its preview,
// so the sentence the coach approved and the shift that ran cannot differ.

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
    const result = await deleteBlock(clientId, clientToday, blockId);

    void recordAuditEvent({
      actorId: auth.coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.BLOCK_DELETE,
      targetTable: "client_phases",
      targetId: blockId,
      clientId,
      metadata: { mode: result.mode, shiftedCount: result.changes.length },
      request,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          mode: result.mode,
          changes: result.changes,
          blocks: decorateBlocks(result.blocks, clientToday),
          clientToday,
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
    const blocks = await setBlockArchived(
      clientId,
      clientToday,
      blockId,
      validation.data.archived
    );

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
        data: { blocks: decorateBlocks(blocks, clientToday), clientToday },
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
