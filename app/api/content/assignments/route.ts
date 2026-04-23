import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { assignContentToClient } from "@/services/content-assignment-service";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { createAssignmentSchema } from "@/lib/validations/content";

export async function POST(request: NextRequest) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

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

    // Parse and validate request body
    const body = await request.json();
    const parsed = createAssignmentSchema.safeParse(body);
    if (!parsed.success) {
      console.error("Create assignment validation error:", parsed.error.flatten());
      return NextResponse.json(
        { error: "Invalid input" },
        { status: 400 }
      );
    }
    const { contentId, clientId } = parsed.data;

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
        error: "Failed to assign content" 
      },
      { status: 500 }
    );
  }
}