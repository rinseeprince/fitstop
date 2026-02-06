import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { assignContentToClient } from "@/services/content-service";

export async function POST(request: NextRequest) {
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

    // Parse request body
    const body = await request.json();
    const { contentId, clientId } = body;

    // Validate required fields
    if (!contentId || !clientId) {
      return NextResponse.json(
        { success: false, error: "Content ID and client ID are required" },
        { status: 400 }
      );
    }

    // Verify the content belongs to this coach
    const { data: content, error: contentError } = await supabase
      .from("content_items")
      .select("coach_id")
      .eq("id", contentId)
      .single();

    if (contentError || !content || content.coach_id !== coach.id) {
      return NextResponse.json(
        { success: false, error: "Content not found" },
        { status: 404 }
      );
    }

    // Verify the client belongs to this coach
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("coach_id")
      .eq("id", clientId)
      .single();

    if (clientError || !client || client.coach_id !== coach.id) {
      return NextResponse.json(
        { success: false, error: "Client not found" },
        { status: 404 }
      );
    }

    // Create assignment
    const assignment = await assignContentToClient({
      contentId,
      clientId,
      assignedBy: coach.id,
    });

    return NextResponse.json({
      success: true,
      data: assignment,
      message: "Content assigned successfully",
    });
  } catch (error) {
    // Handle duplicate assignment error
    if (error instanceof Error && error.message.includes("duplicate")) {
      return NextResponse.json(
        { success: false, error: "Content is already assigned to this client" },
        { status: 400 }
      );
    }

    console.error("Error creating assignment:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "Failed to assign content" 
      },
      { status: 500 }
    );
  }
}