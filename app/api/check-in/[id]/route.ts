import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase-admin";
import { mapCheckInRow } from "@/lib/mappers";
import type { CheckInRow } from "@/lib/database-helpers";
import {
  getCheckInSessionCompletions,
  getCheckInExerciseHighlights,
  getCheckInExternalActivities
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

    // Fetch related data
    const [sessionCompletions, exerciseHighlights, externalActivities] = await Promise.all([
      getCheckInSessionCompletions(id),
      getCheckInExerciseHighlights(id),
      getCheckInExternalActivities(id)
    ]);

    return NextResponse.json({
      checkIn: {
        ...checkIn,
        sessionCompletions,
        exerciseHighlights,
        externalActivities,
      },
      client: checkInData.clients || null,
    });
  } catch (error) {
    console.error("Error fetching check-in:", error);
    return NextResponse.json(
      { error: "Failed to fetch check-in" },
      { status: 500 }
    );
  }
}
