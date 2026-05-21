import { NextRequest, NextResponse } from "next/server";
import { requireClientAuthWithCheckInDay } from "@/lib/require-client-auth";
import { z } from "zod";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getTodayDateString, getTrainingWeekStart } from "@/lib/date-helpers";
import { getEventForSessionAndDate, getEventForDate, linkSessionLogToEvent, mapCompletionQualityToEventStatus } from "@/services/training-event-service";
import { captureApiError } from "@/lib/error-handler";

const sessionCompletionSchema = z.object({
  trainingSessionId: z.string().uuid(),
  completionQuality: z.enum(["full", "partial", "skipped"]).optional().default("full"),
  notes: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireClientAuthWithCheckInDay(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const validationResult = sessionCompletionSchema.safeParse(body);

    if (!validationResult.success) {
      console.error("Validation error:", validationResult.error.format());
      return NextResponse.json(
        {
          success: false,
          error: "Invalid input data",
        },
        { status: 400 }
      );
    }

    const data = validationResult.data;
    const weekStartDate = getTrainingWeekStart(getTodayDateString(), auth.checkInDay);
    const completedAt = getTodayDateString();

    // Build snapshot from the training session for history preservation
    const { data: sessionData } = await supabaseAdmin
      .from("training_sessions")
      .select("name, day_of_week, focus, estimated_duration_minutes, estimated_calories")
      .eq("id", data.trainingSessionId)
      .single();

    // Upsert the session completion record (prescribed_session_snapshot not yet in generated types)
    const upsertPayload = {
      client_id: auth.clientId,
      training_session_id: data.trainingSessionId,
      week_start_date: weekStartDate,
      completed_at: completedAt,
      completion_quality: data.completionQuality,
      notes: data.notes,
      updated_at: new Date().toISOString(),
      ...(sessionData ? { prescribed_session_snapshot: sessionData } : {}),
    };
    const { data: result, error } = await supabaseAdmin
      .from("session_logs")
      .upsert(upsertPayload, {
        onConflict: "client_id,training_session_id,week_start_date",
      })
      .select()
      .single();

    if (error) {
      console.error("Error upserting session completion:", error);
      throw new Error(`Failed to save session completion: ${error.message}`);
    }

    // Link completion to calendar event (non-blocking)
    if (result?.id) {
      getEventForSessionAndDate(auth.clientId, data.trainingSessionId, completedAt)
        .then((event) => {
          if (event) {
            return linkSessionLogToEvent(
              event.id,
              result.id,
              mapCompletionQualityToEventStatus(data.completionQuality)
            );
          }
          // Fallback: link to any event on this date (alternative session or re-completion)
          return getEventForDate(auth.clientId, completedAt).then((fallbackEvent) => {
            if (fallbackEvent) {
              return linkSessionLogToEvent(
                fallbackEvent.id,
                result.id,
                mapCompletionQualityToEventStatus(data.completionQuality)
              );
            }
          });
        })
        .catch((err) =>
          captureApiError(err, {
            action: "link-session-log-to-event",
            clientId: auth.clientId,
            trainingSessionId: data.trainingSessionId,
          })
        );
    }

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error saving session completion:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to save session completion",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireClientAuthWithCheckInDay(request);
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const trainingSessionId = searchParams.get("trainingSessionId");

    if (!trainingSessionId) {
      return NextResponse.json(
        { success: false, error: "Missing trainingSessionId parameter" },
        { status: 400 }
      );
    }

    const weekStartDate = getTrainingWeekStart(getTodayDateString(), auth.checkInDay);

    // Delete the session completion record
    const { error } = await supabaseAdmin
      .from("session_logs")
      .delete()
      .eq("client_id", auth.clientId)
      .eq("training_session_id", trainingSessionId)
      .eq("week_start_date", weekStartDate);

    if (error) {
      console.error("Error deleting session completion:", error);
      throw new Error(`Failed to delete session completion: ${error.message}`);
    }

    return NextResponse.json({
      success: true,
      message: "Session completion deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting session completion:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to delete session completion",
      },
      { status: 500 }
    );
  }
}