import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { clientApiRateLimit } from "@/lib/rate-limit";
import { 
  getCheckInSessionCompletions, 
  getCheckInExerciseHighlights, 
  getCheckInExternalActivities 
} from "@/services/check-in-service";

async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Handle read-only error in Server Components
          }
        },
      },
    }
  );
}

// GET /api/client/check-ins/[id] - Get specific check-in details for authenticated client
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await clientApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id } = await params;
    const clientId = await getAuthenticatedClientId();

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const supabase = await createClient();
    
    const { data: checkIn, error } = await supabase
      .from("check_ins")
      .select("*")
      .eq("id", id)
      .eq("client_id", clientId) // Ensure client can only access their own check-ins
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

    // Fetch related data
    const [sessionCompletions, exerciseHighlights, externalActivities] = await Promise.all([
      getCheckInSessionCompletions(id),
      getCheckInExerciseHighlights(id),
      getCheckInExternalActivities(id)
    ]);

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
        notes: checkIn.notes,
        weight: checkIn.weight,
        weightUnit: checkIn.weight_unit,
        bodyFatPercentage: checkIn.body_fat_percentage,
        waist: checkIn.waist,
        hips: checkIn.hips,
        chest: checkIn.chest,
        arms: checkIn.arms,
        thighs: checkIn.thighs,
        measurementUnit: checkIn.measurement_unit,
        photoFront: checkIn.photo_front,
        photoSide: checkIn.photo_side,
        photoBack: checkIn.photo_back,
        workoutsCompleted: checkIn.workouts_completed,
        adherencePercentage: checkIn.adherence_percentage,
        prs: checkIn.prs,
        challenges: checkIn.challenges,
        nutritionDaysOnTarget: checkIn.nutrition_days_on_target,
        nutritionNotes: checkIn.nutrition_notes,
        aiSummary: checkIn.ai_summary,
        aiInsights: checkIn.ai_insights,
        aiRecommendations: checkIn.ai_recommendations,
        aiProcessedAt: checkIn.ai_processed_at,
        coachResponse: checkIn.coach_response,
        coachReviewedAt: checkIn.coach_reviewed_at,
        responseSentAt: checkIn.response_sent_at,
        createdAt: checkIn.created_at,
        updatedAt: checkIn.updated_at,
        // Enhanced training data
        sessionCompletions,
        exerciseHighlights,
        externalActivities,
      },
    });
  } catch (error) {
    console.error("Error fetching check-in:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch check-in",
      },
      { status: 500 }
    );
  }
}