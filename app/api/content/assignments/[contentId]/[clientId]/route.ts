import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { unassignContentFromClient } from "@/services/content-service";

export async function DELETE(
  request: NextRequest,
  { params }: { params: { contentId: string; clientId: string } }
) {
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

    // Verify the content belongs to this coach
    const { data: content, error: contentError } = await supabase
      .from("content_items")
      .select("coach_id")
      .eq("id", params.contentId)
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
      .eq("id", params.clientId)
      .single();

    if (clientError || !client || client.coach_id !== coach.id) {
      return NextResponse.json(
        { success: false, error: "Client not found" },
        { status: 404 }
      );
    }

    // Remove assignment
    await unassignContentFromClient(params.contentId, params.clientId);

    return NextResponse.json({
      success: true,
      message: "Content unassigned successfully",
    });
  } catch (error) {
    console.error("Error removing assignment:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "Failed to unassign content" 
      },
      { status: 500 }
    );
  }
}