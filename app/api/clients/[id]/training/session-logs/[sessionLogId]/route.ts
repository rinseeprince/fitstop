import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { getClientById } from "@/services/client-service";
import { getSessionLogDetail } from "@/services/training-log-service";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sessionLogId: string }> },
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const coachId = await getAuthenticatedCoachId(request);
  if (!coachId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const { id: clientId, sessionLogId } = await params;

  const client = await getClientById(clientId);
  if (!client || client.coachId !== coachId) {
    return NextResponse.json(
      { success: false, error: "Forbidden" },
      { status: 403 },
    );
  }

  try {
    const result = await getSessionLogDetail(sessionLogId);
    if (result === null) {
      return NextResponse.json(
        { success: false, error: "Session log not found" },
        { status: 404 },
      );
    }
    // Strict URL match: combined with the path-IDOR above, this proves the
    // coach owns the session log without an extra DB lookup.
    if (result.sessionLog.clientId !== clientId) {
      return NextResponse.json(
        { success: false, error: "Session log not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (error) {
    console.error("Error loading session log:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load session log" },
      { status: 500 },
    );
  }
}
