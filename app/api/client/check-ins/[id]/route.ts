import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { supabaseAdmin } from "@/services/supabase-admin";
import {
  deriveSessionCompletionsForCheckIn,
  getCheckInAnswers,
  getCheckInExerciseHighlights,
  mapExerciseHighlight,
} from "@/services/check-in-service";
import { mapCheckInRow } from "@/lib/mappers";
import { getMeasurementsForCheckIns } from "@/services/measurements-service";
import type { CheckInExerciseHighlight } from "@/types/check-in";

// GET /api/client/check-ins/[id] - Get specific check-in details for authenticated client
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;

    // IDOR: filter on client_id to ensure the client can only read their own check-in
    const { data: checkIn, error } = await supabaseAdmin
      .from("check_ins")
      .select("*")
      .eq("id", id)
      .eq("client_id", auth.clientId)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json(
          { success: false, error: "Check-in not found" },
          { status: 404 }
        );
      }
      throw error;
    }

    // Fetch related data. Session completions are DERIVED from the spine
    // (training_events + session_logs) for the check-in's stored period — there
    // is no backing table. The IDOR guard above (eq client_id) already scoped
    // this row to the authenticated client.
    const [sessionCompletions, highlightRows, customAnswers, stamped] = await Promise.all([
      deriveSessionCompletionsForCheckIn(mapCheckInRow(checkIn)),
      getCheckInExerciseHighlights(id),
      // The client's own answers to the coach's custom questions, read back
      // with their prompts. On the single-check-in read only: the history LIST
      // renders a date, a status and a preview, and embedding a dictionary in
      // a row list is what CONVENTIONS section 8 "Sparse fieldsets" forbids.
      getCheckInAnswers(id),
      // What this check-in reported: the measurement-log rows carrying its
      // stamp. `null` where it carried no reading — the RN wire's shape.
      getMeasurementsForCheckIns([id]),
    ]);
    const readings = stamped.get(id) ?? {};

    // getCheckInExerciseHighlights returns RAW snake_case rows (it is a
    // `select("*")` with no mapper), so this route must map them exactly as
    // getCheckInWithDetails does — the client page reads the camelCase domain
    // shape. The annotation is deliberate: it is the only thing anchoring this
    // field to a real type, because app/client/check-in/[id]/page.tsx types the
    // fetch response as `any` and tsc therefore checks the page against its own
    // declaration rather than against what this route actually sends.
    const exerciseHighlights: CheckInExerciseHighlight[] =
      highlightRows.map(mapExerciseHighlight);

    return NextResponse.json({
      success: true,
      data: {
        id: checkIn.id,
        clientId: checkIn.client_id,
        status: checkIn.status,
        mood: checkIn.mood,
        energy: checkIn.energy,
        sleep: checkIn.sleep,
        stress: checkIn.stress,
        soreness: checkIn.soreness,
        notes: checkIn.notes,
        // Canonical kg/cm, from the measurement log. Every key is emitted, null
        // when absent: the RN client reads this shape.
        weight: readings.weight ?? null,
        bodyFatPercentage: readings.bodyFat ?? null,
        waist: readings.waist ?? null,
        hips: readings.hips ?? null,
        chest: readings.chest ?? null,
        arms: readings.arms ?? null,
        thighs: readings.thighs ?? null,
        photoFront: checkIn.photo_front,
        photoSide: checkIn.photo_side,
        photoBack: checkIn.photo_back,
        workoutsCompleted: checkIn.workouts_completed,
        adherencePercentage: checkIn.adherence_percentage,
        prs: checkIn.prs,
        challenges: checkIn.challenges,
        nutritionDaysOnTarget: checkIn.nutrition_days_on_target,
        nutritionNotes: checkIn.nutrition_notes,
        // AI fields (ai_summary/insights/recommendations/response_draft) are
        // coach-only analysis — deliberately NOT returned to the client (M6).
        coachResponse: checkIn.coach_response,
        coachReviewedAt: checkIn.coach_reviewed_at,
        responseSentAt: checkIn.response_sent_at,
        createdAt: checkIn.created_at,
        updatedAt: checkIn.updated_at,
        // Enhanced training data
        sessionCompletions,
        exerciseHighlights,
        customAnswers,
      },
    });
  } catch (error) {
    console.error("Error fetching check-in:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch check-in",
      },
      { status: 500 }
    );
  }
}