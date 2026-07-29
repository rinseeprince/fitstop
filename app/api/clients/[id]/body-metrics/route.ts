import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getBodyMetricsHistory } from "@/services/body-metrics-service";

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

    const { searchParams } = new URL(request.url);
    const limit = searchParams.get("limit")
      ? Math.min(Math.max(parseInt(searchParams.get("limit")!, 10) || 50, 1), 500)
      : undefined;

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    const from = searchParams.get("from") || undefined;
    const to = searchParams.get("to") || undefined;

    if (from && !dateRegex.test(from)) {
      return NextResponse.json(
        { success: false, error: "Invalid 'from' date. Use YYYY-MM-DD format." },
        { status: 400 }
      );
    }
    if (to && !dateRegex.test(to)) {
      return NextResponse.json(
        { success: false, error: "Invalid 'to' date. Use YYYY-MM-DD format." },
        { status: 400 }
      );
    }

    const metrics = await getBodyMetricsHistory(clientId, { limit, from, to });

    return NextResponse.json(
      { success: true, data: metrics },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching body metrics:", error);
    return NextResponse.json(
      { error: "Failed to fetch body metrics" },
      { status: 500 }
    );
  }
}
