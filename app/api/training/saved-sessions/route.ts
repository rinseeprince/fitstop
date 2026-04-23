import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import {
  getStandaloneSessions,
  createStandaloneSession,
} from "@/services/coach-saved-session-service";

// GET - List standalone sessions for the authenticated coach
export async function GET(request: NextRequest) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();
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
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "Session name is required" }, { status: 400 });
    }
    if (!Array.isArray(body.exercises) || body.exercises.length === 0) {
      return NextResponse.json({ error: "At least one exercise is required" }, { status: 400 });
    }

    const sessionId = await createStandaloneSession(coachId, {
      name: body.name.trim(),
      focus: body.focus,
      exercises: body.exercises,
    });

    return NextResponse.json({ success: true, sessionId }, { status: 201 });
  } catch (error) {
    console.error("Error creating standalone session:", error);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}
