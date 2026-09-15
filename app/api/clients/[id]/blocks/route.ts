import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { replaceBlockChainSchema } from "@/lib/validations/client-blocks";
import { decorateBlocks } from "@/lib/blocks/block-derivations";
import {
  listBlocks,
  replaceBlockChain,
  ElapsedBlockImmutableError,
  BlockPayloadError,
  BlockTrimsPendingError,
  BlockWindowError,
} from "@/services/client-blocks-service";
import { getClientTodayString } from "@/services/today-service";
import { resolveEventDeletionFloor } from "@/services/event-deletion-floor";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";

// Journey blocks (client_phases — the coach-facing noun is "block"). "Today"
// is the CLIENT's calendar day per the locked timezone model: whose calendar
// the date is on decides the zone, and a block lives on the client's.
// This route must NEVER call updateGoals — blocks save independently of the
// goal (workstream invariant 7), and updateGoals supersedes-and-inserts on
// every call with no change detection.

/** 422 for the request-shaped service errors, 409 for the question; null
 *  for everything else. */
function mapBlockError(error: unknown): NextResponse | null {
  // The save would trim plans already on the calendar: the trims ride the
  // refusal, the blocks screen asks with them, and the coach's yes re-sends
  // the same save with `confirmTrims`.
  if (error instanceof BlockTrimsPendingError) {
    return NextResponse.json(
      { success: false, error: error.message, data: { trims: error.trims } },
      { status: 409 }
    );
  }
  if (
    error instanceof ElapsedBlockImmutableError ||
    error instanceof BlockWindowError ||
    error instanceof BlockPayloadError
  ) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 422 }
    );
  }
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId } = await params;

    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    const clientToday = await getClientTodayString(clientId);
    const [blocks, planStartFloor] = await Promise.all([
      listBlocks(clientId),
      resolveEventDeletionFloor(clientId, clientToday),
    ]);

    // clientToday rides the payload so the browser previews the delete shift
    // (computeDeleteShift) with the SAME today the DELETE will execute with —
    // a device-tz today diverges from the client's around midnight, which is
    // exactly the preview-vs-execution drift the shared pure helper forbids.
    //
    // planStartFloor rides beside it for the same reason: the earliest day a
    // PROGRAM may start on this calendar (the deletion floor — today, or
    // tomorrow once the client has logged a workout today) depends on the
    // client's training log, so only the server can answer it. The apply
    // dialog floors its date picker on it; the nutrition drawer floors on the
    // client's today (targets ask no floor) and reads this payload for its
    // blocks alone; a block itself is not constrained by it. Every handler
    // that echoes this payload carries it, because the seed helper writes a
    // mutation's response straight into the chain cache.
    return NextResponse.json(
      {
        success: true,
        data: { blocks: decorateBlocks(blocks, clientToday), clientToday, planStartFloor },
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error fetching blocks:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch blocks" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: clientId } = await params;

    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    const body: unknown = await request.json();
    const validation = replaceBlockChainSchema.safeParse(body);
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
    // The floor does not depend on the write — a trim removes scheduled
    // sessions and detaches logged ones, and the floor reads only whether a
    // logged one sits on today — so the two run together.
    const [{ blocks, trimmed }, planStartFloor] = await Promise.all([
      replaceBlockChain(clientId, clientToday, validation.data),
      resolveEventDeletionFloor(clientId, clientToday),
    ]);

    void recordAuditEvent({
      actorId: auth.coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.BLOCK_CHAIN_UPDATE,
      targetTable: "client_phases",
      clientId,
      metadata: { blockCount: blocks.length, trimmedPlans: trimmed },
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
    const mapped = mapBlockError(error);
    if (mapped) return mapped;
    console.error("Error saving blocks:", error);
    return NextResponse.json(
      { success: false, error: "Failed to save blocks" },
      { status: 500 }
    );
  }
}
