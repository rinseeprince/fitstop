import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { supabaseAdmin } from "@/services/supabase-admin";
import { unassignContentFromClient } from "@/services/content-assignment-service";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ contentId: string; clientId: string }> }
) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  const { contentId, clientId } = await params;
  try {
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

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

    // Remove assignment
    await unassignContentFromClient(contentId, clientId);

    return NextResponse.json({
      success: true,
      message: "Content unassigned successfully",
    });
  } catch (error) {
    console.error("Error removing assignment:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: "Failed to unassign content" 
      },
      { status: 500 }
    );
  }
}