import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import {
  getStandaloneSessions,
  createStandaloneSession,
} from "@/services/coach-saved-session-service";
import { createStandaloneSessionSchema } from "@/lib/validations/training";

// GET - List standalone sessions for the authenticated coach
export async function GET(request: NextRequest) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sessions = await getStandaloneSessions(coachId);
    return NextResponse.json({ success: true, sessions }, { status: 200 });
  } catch (error) {
    console.error("Error fetching standalone sessions:", error);
    return NextResponse.json({ error: "Failed to fetch sessions" }, { status: 500 });
  }
}

// POST - Create a standalone session from scratch
export async function POST(request: NextRequest) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    const parsed = createStandaloneSessionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    const sessionId = await createStandaloneSession(coachId, {
      name: parsed.data.name,
      focus: parsed.data.focus,
      estimatedDurationMinutes: parsed.data.estimatedDurationMinutes,
      calorieSurplusPercentage: parsed.data.calorieSurplusPercentage,
      notes: parsed.data.notes,
      exercises: parsed.data.exercises,
    });

    return NextResponse.json({ success: true, sessionId }, { status: 201 });
  } catch (error) {
    console.error("Error creating standalone session:", error);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}
