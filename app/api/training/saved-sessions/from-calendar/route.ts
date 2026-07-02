import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { saveSessionFromCalendar } from "@/services/coach-library-calendar-service";
import { z } from "zod";

const fromCalendarSchema = z.object({
  sourceSessionId: z.string().uuid(),
  // 100 = the library-wide session-name cap (create/overwrite/savedSession
  // schemas). The old 200 here let rows in that every later library save
  // would silently truncate.
  name: z.string().min(1).max(100),
});

/**
 * POST - Save a client training session to the coach library as a standalone session.
 */
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
    const validation = fromCalendarSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.issues },
        { status: 400 }
      );
    }

    const { sourceSessionId, name } = validation.data;

    const savedSessionId = await saveSessionFromCalendar(coachId, sourceSessionId, name);

    return NextResponse.json({ success: true, savedSessionId }, { status: 200 });
  } catch (error) {
    console.error("Error saving session from calendar:", error);
    return NextResponse.json({ error: "Failed to save session from calendar" }, { status: 500 });
  }
}
