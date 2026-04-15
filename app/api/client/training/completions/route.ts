import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientWithCheckInDay } from "@/lib/auth-helpers";
import {
  getWeeklyCompletions,
  markSessionComplete,
  removeSessionCompletion,
} from "@/services/client-portal-training";
import { clientApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getTodayDateString, getTrainingWeekStart } from "@/lib/date-helpers";
import { z } from "zod";
import { getEventForSessionAndDate, getEventForDate, linkSessionLogToEvent, mapCompletionQualityToEventStatus } from "@/services/training-event-service";
import { captureApiError } from "@/lib/error-handler";

// Validation schema for marking session complete (weekStartDate removed, computed server-side)
const markCompleteSchema = z.object({
  trainingSessionId: z.string().uuid(),
  quality: z.enum(["full", "partial", "skipped"]).optional().default("full"),
  notes: z.string().optional(),
});

// GET /api/client/training/completions - Get weekly completions
export async function GET(request: NextRequest) {
  const rateLimitResult = await clientApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const auth = await getAuthenticatedClientWithCheckInDay();

    if (!auth) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const weekStartDate = getTrainingWeekStart(getTodayDateString(), auth.checkInDay);
    const completions = await getWeeklyCompletions(auth.clientId, weekStartDate);

    return NextResponse.json({
      success: true,
      data: completions,
      weekStartDate,
    });
  } catch (error) {
    console.error("Error fetching completions:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch completions",
      },
      { status: 500 }
    );
  }
}

// POST /api/client/training/completions - Mark session complete
export async function POST(request: NextRequest) {
  const rateLimitResult = await clientApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const auth = await getAuthenticatedClientWithCheckInDay();

    if (!auth) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validationResult = markCompleteSchema.safeParse(body);

    if (!validationResult.success) {
      console.error("Validation error:", validationResult.error.errors);
      return NextResponse.json(
        { success: false, error: "Invalid input" },
        { status: 400 }
      );
    }

    const { trainingSessionId, quality, notes } = validationResult.data;
    const weekStartDate = getTrainingWeekStart(getTodayDateString(), auth.checkInDay);

    const completion = await markSessionComplete(
      auth.clientId,
      trainingSessionId,
      weekStartDate,
      quality,
      notes
    );

    // Link completion to calendar event (non-blocking)
    if (completion?.id) {
      const todayDate = getTodayDateString();

      getEventForSessionAndDate(auth.clientId, trainingSessionId, todayDate)
        .then((event) => {
          if (event) {
            return linkSessionLogToEvent(
              event.id,
              completion.id,
              mapCompletionQualityToEventStatus(quality)
            );
          }
          // Fallback: link to any event on this date (alternative session or re-completion)
          return getEventForDate(auth.clientId, todayDate).then((fallbackEvent) => {
            if (fallbackEvent) {
              return linkSessionLogToEvent(
                fallbackEvent.id,
                completion.id,
                mapCompletionQualityToEventStatus(quality)
              );
            }
          });
        })
        .catch((err) =>
          captureApiError(err, {
            action: "link-session-log-to-event",
            clientId: auth.clientId,
            trainingSessionId,
          })
        );
    }

    if (!completion) {
      return NextResponse.json(
        { success: false, error: "Failed to mark session complete" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: completion,
    }, { status: 201 });
  } catch (error) {
    console.error("Error marking session complete:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to mark complete",
      },
      { status: 500 }
    );
  }
}

// DELETE /api/client/training/completions - Remove session completion
export async function DELETE(request: NextRequest) {
  const rateLimitResult = await clientApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const auth = await getAuthenticatedClientWithCheckInDay();

    if (!auth) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const trainingSessionId = searchParams.get("trainingSessionId");
    const weekStartDate = getTrainingWeekStart(getTodayDateString(), auth.checkInDay);

    if (!trainingSessionId) {
      return NextResponse.json(
        { success: false, error: "trainingSessionId is required" },
        { status: 400 }
      );
    }

    const success = await removeSessionCompletion(auth.clientId, trainingSessionId, weekStartDate);

    if (!success) {
      return NextResponse.json(
        { success: false, error: "Failed to remove completion" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing completion:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to remove completion",
      },
      { status: 500 }
    );
  }
}
