import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { getCoachContentLibrary } from "@/services/content-service";

export async function GET(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    
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