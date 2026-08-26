import { NextRequest, NextResponse } from "next/server";
import { getClientCheckIns } from "@/services/check-in-service";
import { parsePaginationParams } from "@/lib/api-utils";
import type { CheckInStatus, GetCheckInsResponse } from "@/types/check-in";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";

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
    const validStatuses = ["pending", "ai_processed", "reviewed"];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { success: false, error: "Invalid status parameter" },
        { status: 400 }
      );
    }

    // Get check-ins
    const result = await getClientCheckIns(clientId, {
      limit,
      offset,
      status: status as CheckInStatus | undefined,
    });

    const response: GetCheckInsResponse = {
      checkIns: result.checkIns,
      total: result.total,
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
