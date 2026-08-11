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
  BlockWindowError,
} from "@/services/client-blocks-service";
import { getClientTodayString } from "@/services/today-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";

// Journey blocks (client_phases — the coach-facing noun is "block"). "Today"
// is the CLIENT's calendar day per the locked timezone model: whose calendar
// the date is on decides the zone, and a block lives on the client's.
// This route must NEVER call updateGoals — blocks save independently of the
// goal (workstream invariant 7), and updateGoals supersedes-and-inserts on
// every call with no change detection.

/** 422 for the request-shaped service errors; null for everything else. */
function mapBlockError(error: unknown): NextResponse | null {
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

    const [clientToday, blocks] = await Promise.all([
      getClientTodayString(clientId),
      listBlocks(clientId),
    ]);

    return NextResponse.json(
      { success: true, data: { blocks: decorateBlocks(blocks, clientToday) } },
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
    const blocks = await replaceBlockChain(
      clientId,
      clientToday,
      validation.data
    );

    void recordAuditEvent({
      actorId: auth.coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.BLOCK_CHAIN_UPDATE,
      targetTable: "client_phases",
      clientId,
      metadata: {
        blockCount: blocks.length,
        startsOn: validation.data.startsOn,
      },
      request,
    });

    return NextResponse.json(
      { success: true, data: { blocks: decorateBlocks(blocks, clientToday) } },
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
