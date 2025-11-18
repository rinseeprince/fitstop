import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get check-in with client info in a single query using relational syntax
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

    if (error) {
      console.error("Error fetching check-in:", error);
      return NextResponse.json(
        { error: "Check-in not found" },
        { status: 404 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Check-in not found" },
        { status: 404 }
      );
    }

    // Type assertion for the relational query result
    const checkInData = data as any;

    // Transform data to match expected format
    const checkIn = {
      id: checkInData.id,
      clientId: checkInData.client_id,
      status: checkInData.status,
      mood: checkInData.mood,
      energy: checkInData.energy,
      sleep: checkInData.sleep,
      stress: checkInData.stress,
      notes: checkInData.notes,
      weight: checkInData.weight,
      weightUnit: checkInData.weight_unit,
      bodyFatPercentage: checkInData.body_fat_percentage,
      waist: checkInData.waist,
      hips: checkInData.hips,
      chest: checkInData.chest,
      arms: checkInData.arms,
      thighs: checkInData.thighs,
      measurementUnit: checkInData.measurement_unit,
      photoFront: checkInData.photo_front,
      photoSide: checkInData.photo_side,
      photoBack: checkInData.photo_back,
      workoutsCompleted: checkInData.workouts_completed,
      adherencePercentage: checkInData.adherence_percentage,
      prs: checkInData.prs,
      challenges: checkInData.challenges,
      aiSummary: checkInData.ai_summary,
      aiInsights: checkInData.ai_insights,
      aiRecommendations: checkInData.ai_recommendations,
      aiResponseDraft: checkInData.ai_response_draft,
      aiProcessedAt: checkInData.ai_processed_at,
      coachResponse: checkInData.coach_response,
      coachReviewedAt: checkInData.coach_reviewed_at,
      responseSentAt: checkInData.response_sent_at,
      createdAt: checkInData.created_at,
      updatedAt: checkInData.updated_at,
    };

    return NextResponse.json({
      checkIn,
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
