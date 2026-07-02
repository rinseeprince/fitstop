import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { overwriteStandaloneSession } from "@/services/coach-standalone-session-service";
import { overwriteStandaloneSessionSchema } from "@/lib/validations/training";

// POST - Full replace of a STANDALONE session (fields + exercises, same body
// shape as create). Plan-attached sessions 404 — program-embedded sessions
// are edited through the Program builder's overwrite, never here.
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
    const body = await request.json();

    const parsed = overwriteStandaloneSessionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    await overwriteStandaloneSession(savedSessionId, coachId, parsed.data);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "Session not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    console.error("Error overwriting saved session:", error);
    return NextResponse.json(
      { error: "Failed to update session" },
      { status: 500 }
    );
  }
}
