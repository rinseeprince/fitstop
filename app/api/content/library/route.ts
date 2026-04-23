import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getCoachContentLibrary } from "@/services/content-item-service";
import { apiRateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const supabase = await createServerSupabaseClient();
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get coach profile
    const { data: coach, error: coachError } = await supabase
      .from("coaches")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (coachError || !coach) {
      return NextResponse.json(
        { success: false, error: "Coach profile not found" },
        { status: 404 }
      );
    }

    // Fetch content library
    const library = await getCoachContentLibrary(coach.id);

    return NextResponse.json({
      success: true,
      data: library,
    });
  } catch (error) {
    console.error("Error fetching content library:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch content library" },
      { status: 500 }
    );
  }
}