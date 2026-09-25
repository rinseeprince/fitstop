import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { supabaseAdmin } from "@/services/supabase-admin";
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
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
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

    // Verify the content belongs to this coach. The read is scoped to them, so
    // another coach's item matches nothing.
    const { data: content, error: contentError } = await supabaseAdmin
      .from("content_items")
      .select("id")
      .eq("id", contentId)
      .eq("coach_id", coachId)
      .single();

    if (contentError || !content) {
      return NextResponse.json(
        { success: false, error: "Content not found" },
        { status: 404 }
      );
    }

    // Verify the client belongs to this coach, scoped the same way.
    const { data: client, error: clientError } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("id", clientId)
      .eq("coach_id", coachId)
      .single();

    if (clientError || !client) {
      return NextResponse.json(
        { success: false, error: "Client not found" },
        { status: 404 }
      );
    }

    // Create assignment
    const assignment = await assignContentToClient({
      contentId,
      clientId,
      assignedBy: coachId,
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