import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase-client";

export async function GET(request: NextRequest) {
  try {
    // Get recent check-ins with client info
    const { data: checkIns, error } = await supabaseAdmin
      .from("check_ins")
      .select(
        `
        *,
        clients:client_id (
          id,
          name,
          email,
          avatar_url
        )
      `
      )
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) {
      throw error;
    }

    // Transform the data to include client info at top level
    const formattedCheckIns = (checkIns || []).map((checkIn) => ({
      id: checkIn.id,
      clientId: checkIn.client_id,
      clientName: checkIn.clients?.name || "Unknown Client",
      clientEmail: checkIn.clients?.email,
      clientAvatar: checkIn.clients?.avatar_url,
      status: checkIn.status,
      weight: checkIn.weight,
      weightUnit: checkIn.weight_unit,
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
