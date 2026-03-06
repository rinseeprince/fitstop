import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { clientApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { z } from "zod";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getTodayDateString } from "@/lib/date-helpers";

// Get the week start date (Monday) for a given date
const getWeekStartDate = (date: Date = new Date()): string => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust if Sunday
  d.setDate(diff);
  return d.toISOString().split('T')[0];
};

const sessionCompletionSchema = z.object({
  trainingSessionId: z.string().uuid(),
  completionQuality: z.enum(["full", "partial", "skipped"]).optional().default("full"),
  notes: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const rateLimitResult = await clientApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const clientId = await getAuthenticatedClientId();

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validationResult = sessionCompletionSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid input data",
          validationErrors: validationResult.error.format(),
        },
        { status: 400 }
      );
    }

    const data = validationResult.data;
    const weekStartDate = getWeekStartDate();
    const completedAt = getTodayDateString();

    // Upsert the session completion record
    const { data: result, error } = await supabaseAdmin
      .from("client_session_completions")
      .upsert(
        {
          client_id: clientId,
          training_session_id: data.trainingSessionId,
          week_start_date: weekStartDate,
          completed_at: completedAt,
          completion_quality: data.completionQuality,
          notes: data.notes,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "client_id,training_session_id,week_start_date",
        }
      )
      .select()
      .single();

    if (error) {
      console.error("Error upserting session completion:", error);
      throw new Error(`Failed to save session completion: ${error.message}`);
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
  const rateLimitResult = await clientApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const clientId = await getAuthenticatedClientId();

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const trainingSessionId = searchParams.get("trainingSessionId");

    if (!trainingSessionId) {
      return NextResponse.json(
        { success: false, error: "Missing trainingSessionId parameter" },
        { status: 400 }
      );
    }

    const weekStartDate = getWeekStartDate();

    // Delete the session completion record
    const { error } = await supabaseAdmin
      .from("client_session_completions")
      .delete()
      .eq("client_id", clientId)
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