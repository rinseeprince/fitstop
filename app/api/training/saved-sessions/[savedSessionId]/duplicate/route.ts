import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { duplicateStandaloneSession } from "@/services/coach-saved-session-service";

// POST - Duplicate a STANDALONE session (exercises copied verbatim, name
// deduped with " (copy)"). Plan-attached sessions 404. No body.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ savedSessionId: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { savedSessionId } = await params;
    const sessionId = await duplicateStandaloneSession(savedSessionId, coachId);
    return NextResponse.json({ success: true, sessionId }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "Session not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    console.error("Error duplicating saved session:", error);
    return NextResponse.json(
      { error: "Failed to duplicate session" },
      { status: 500 }
    );
  }
}
