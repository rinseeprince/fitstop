import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase-admin";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCoachAuth, getCoachClientIds } from "@/lib/require-coach-auth";
import { getMeasurementsForCheckIns } from "@/services/measurements-service";

export async function GET(request: NextRequest) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    // Verify coach authentication
    const auth = await requireCoachAuth();
    if (!auth.authorized) return auth.response;

    // Scope to this coach's clients only
    const clientIds = await getCoachClientIds(auth.coachId);
    if (clientIds.length === 0) {
      return NextResponse.json({ checkIns: [], total: 0 });
    }

    // Get recent check-ins with client info
    const { data: checkIns, error } = await supabaseAdmin
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
      .in("client_id", clientIds)
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) {
      throw error;
    }

    // What each check-in reported: the measurement-log rows carrying its
    // stamp, one read for the ten rows.
    const readings = await getMeasurementsForCheckIns(
      (checkIns || []).map((checkIn: { id: string }) => checkIn.id)
    );

    // Transform the data to include client info at top level
    const formattedCheckIns = (checkIns || []).map((checkIn: any) => ({
      id: checkIn.id,
      clientId: checkIn.client_id,
      clientName: checkIn.clients?.name || "Unknown Client",
      clientEmail: checkIn.clients?.email,
      clientAvatar: checkIn.clients?.avatar_url,
      status: checkIn.status,
      // Canonical kilograms, from the log. Kept in the payload so the
      // response shape stays stable.
      weight: readings.get(checkIn.id)?.weight ?? null,
      workoutsCompleted: checkIn.workouts_completed,
      adherencePercentage: checkIn.adherence_percentage,
      mood: checkIn.mood,
      energy: checkIn.energy,
      createdAt: checkIn.created_at,
      aiProcessedAt: checkIn.ai_processed_at,
      coachReviewedAt: checkIn.coach_reviewed_at,
    }));

    return NextResponse.json({
      checkIns: formattedCheckIns,
      total: formattedCheckIns.length,
    });
  } catch (error) {
    console.error("Error fetching recent check-ins:", error);
    return NextResponse.json(
      { error: "Failed to fetch recent check-ins" },
      { status: 500 }
    );
  }
}
