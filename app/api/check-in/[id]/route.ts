import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase-admin";
import type { CheckInRow } from "@/lib/database-helpers";
import {
  getCheckInAnswers,
  getCheckInExerciseHighlights,
  getCheckInPeriodAdherence,
  getTrainingEventDetailsForCheckIn,
  mapExerciseHighlight,
} from "@/services/check-in-service";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsCheckIn } from "@/lib/require-coach-auth";
import { mapCheckInRow, withoutSentSnapshot } from "@/lib/mappers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id } = await params;

    // Verify coach owns this check-in's client (before fetching detailed data)
    const auth = await requireCoachOwnsCheckIn(id);
    if (!auth.authorized) return auth.response;

    // Now fetch full check-in with client info for the response
    const { data, error } = await supabaseAdmin
      .from("check_ins")
      .select(
        `
        *,
        clients!client_id (
          id,
          name,
          email,
          avatar_url
        )
      `
      )
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: "Check-in not found" },
        { status: 404 }
      );
    }

    // Type the relational query result properly
    type CheckInWithClient = CheckInRow & {
      clients: {
        id: string;
        name: string;
        email: string;
        avatar_url: string | null;
      } | null;
    };

    const checkInData = data as CheckInWithClient;

    // The domain object: what the check-in reported and its week, from the
    // copy it saved when it was sent.
    const checkIn = mapCheckInRow(checkInData);

    // Fetch related data.
    //
    // `trainingEventDetails` is the period's own workouts, read from the calendar
    // (`training_events` with their logs) for the check-in's stored period —
    // the client's own logging of a week the Send closed, so it stands as it
    // was. Pass the mapped check-in (carries clientId, period, createdAt) so
    // the derivation resolves the correct historical window. It sits beside
    // the check-in rather than on it, like `periodAdherence`: both describe
    // the PERIOD the check-in reported on.
    //
    // `periodAdherence` carries the nutrition + habit figures for the check-in's
    // OWN period as they stood when it was sent — from its saved copy, through
    // the Overview kernel's rules. It is here rather than in the renderer
    // because the denominators are the point: the page cannot see which days
    // were eligible for a habit, or which had a target, without the rows the
    // copy froze. `null` for a legacy row whose period cannot be resolved — the
    // renderers show their empty states rather than fall back to a second,
    // client-side definition.
    const periodAdherence = getCheckInPeriodAdherence(checkIn);
    const [trainingEventDetails, highlightRows, customAnswers] = await Promise.all([
      getTrainingEventDetailsForCheckIn(checkIn),
      getCheckInExerciseHighlights(id),
      // Answers to the coach's custom questions, each under the wording the
      // client saw.
      getCheckInAnswers(checkIn),
    ]);

    return NextResponse.json({
      checkIn: {
        ...withoutSentSnapshot(checkIn),
        // Map to the camelCase domain type so the payload matches the declared
        // CheckInWithDetails shape (and getCheckInWithDetails), not raw DB rows.
        exerciseHighlights: highlightRows.map(mapExerciseHighlight),
        customAnswers,
      },
      client: checkInData.clients || null,
      trainingEventDetails,
      periodAdherence,
    });
  } catch (error) {
    console.error("Error fetching check-in:", error);
    return NextResponse.json(
      { error: "Failed to fetch check-in" },
      { status: 500 }
    );
  }
}
