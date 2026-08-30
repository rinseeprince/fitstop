import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase-admin";
import { mapCheckInRow } from "@/lib/mappers";
import type { CheckInRow } from "@/lib/database-helpers";
import {
  deriveSessionCompletionsForCheckIn,
  getCheckInExerciseHighlights,
  getCheckInPeriodAdherence,
  mapExerciseHighlight,
} from "@/services/check-in-service";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsCheckIn } from "@/lib/require-coach-auth";

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

    // Use mapper function to transform database row to application type
    const checkIn = mapCheckInRow(checkInData);

    // Fetch related data. Session completions are DERIVED from the spine
    // (training_events + session_logs) for the check-in's stored period — there
    // is no backing table. Pass the mapped check-in (carries clientId, period,
    // createdAt) so the derivation resolves the correct historical window.
    // `periodAdherence` carries the nutrition + habit figures for the check-in's
    // OWN period, computed server-side by the shared Overview kernel. It is here
    // rather than in the renderer because the denominators are the point: the
    // page cannot see which days were eligible for a habit, or which had a
    // target, without the rows this reads. `null` for a legacy row whose period
    // cannot be resolved — the renderers show their empty states rather than
    // fall back to a second, client-side definition.
    const [sessionCompletions, highlightRows, periodAdherence] = await Promise.all([
      deriveSessionCompletionsForCheckIn(checkIn),
      getCheckInExerciseHighlights(id),
      getCheckInPeriodAdherence(checkIn),
    ]);

    return NextResponse.json({
      checkIn: {
        ...checkIn,
        sessionCompletions,
        // Map to the camelCase domain type so the payload matches the declared
        // CheckInWithDetails shape (and getCheckInWithDetails), not raw DB rows.
        exerciseHighlights: highlightRows.map(mapExerciseHighlight),
      },
      client: checkInData.clients || null,
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
