import { NextRequest, NextResponse } from "next/server";
import { getClientCheckIns } from "@/services/check-in-service";
import { parsePaginationParams } from "@/lib/api-utils";
import { decodeCursor, encodeCursor, type CheckInCursor } from "@/lib/cursor";
import type {
  CheckInStatus,
  GetCheckInsResponse,
  GetClientCheckInsPageResponse,
} from "@/types/check-in";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { CHECK_IN_STATUSES } from "@/lib/constants";

const isCheckInStatus = (value: string): value is CheckInStatus =>
  (CHECK_IN_STATUSES as readonly string[]).includes(value);

/**
 * GET /api/clients/[id]/check-ins
 *
 * The coach's view of one client's check-in history. Same pagination contract as
 * the client's own list (`/api/client/check-ins`): keyset is the default and the
 * whole list pages on a stable, opaque `(created_at, id)` cursor.
 *   - First page: `?limit=N`                → `{ checkIns, nextCursor, hasMore, total }`
 *   - Next pages: `?limit=N&cursor=<opaque>`→ `{ checkIns, nextCursor, hasMore }`
 *   - Legacy offset (explicit opt-in only): `?offset=N` → `{ checkIns, total }`
 *
 * `total` is the exact history count and is taken on the FIRST page only — the
 * Check-ins tab's rail renders it, and a per-page COUNT would be paid for nothing.
 *
 * @throws {400} Invalid limit/offset, unknown status, or a malformed cursor
 * @throws {401/403} Not the coach, or not this coach's client
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId } = await params;

    // Verify coach owns this client
    const auth = await requireCoachOwnsClient(clientId);
    if (!auth.authorized) return auth.response;
    const { searchParams } = new URL(request.url);

    // Parse and validate pagination parameters
    const pagination = parsePaginationParams(searchParams);
    if (!pagination.valid) {
      return NextResponse.json(
        { success: false, error: pagination.error },
        { status: 400 }
      );
    }

    const { limit, offset } = pagination;
    const status = searchParams.get("status") || undefined;

    // Validate status if provided
    if (status !== undefined && !isCheckInStatus(status)) {
      return NextResponse.json(
        { success: false, error: "Invalid status parameter" },
        { status: 400 }
      );
    }

    // Legacy offset mode — only when explicitly requested.
    if (searchParams.get("offset") !== null) {
      const result = await getClientCheckIns(clientId, {
        limit,
        offset,
        status,
      });

      const response: GetCheckInsResponse = {
        checkIns: result.checkIns,
        total: result.total,
      };

      return NextResponse.json(response, { status: 200 });
    }

    // Keyset mode (default). cursor is absent on the first page, present after.
    //
    // Decoded and STRICTLY validated here, before its values reach the service's
    // PostgREST `.or()` predicate: decodeCursor rejects anything that is not
    // base64url JSON carrying a UUID `id` and an ISO timestamp drawn from a
    // charset with no `,` `(` `)` in it, so filter syntax cannot be smuggled in.
    const cursorParam = searchParams.get("cursor");
    let cursor: CheckInCursor | undefined;
    if (cursorParam !== null) {
      const decoded = decodeCursor(cursorParam);
      if (!decoded) {
        return NextResponse.json(
          { success: false, error: "Invalid cursor" },
          { status: 400 }
        );
      }
      cursor = decoded;
    }

    const result = await getClientCheckIns(clientId, {
      limit,
      keyset: true,
      cursor,
      status,
      // First page only: the rail's count, not a per-page COUNT.
      withTotal: cursor === undefined,
    });

    const response: GetClientCheckInsPageResponse = {
      checkIns: result.checkIns,
      nextCursor: result.nextCursor ? encodeCursor(result.nextCursor) : null,
      hasMore: result.nextCursor !== null,
      ...(cursor === undefined ? { total: result.total } : {}),
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching check-ins:", error);
    return NextResponse.json(
      { error: "Failed to fetch check-ins" },
      { status: 500 }
    );
  }
}
