import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getContentById, deleteContentItem } from "@/services/content-item-service";
import { apiRateLimit } from "@/lib/rate-limit";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const { id } = await params;
  try {
    // CSRF Protection
    const csrfError = await requireCSRFProtection(request);
    if (csrfError) return csrfError;
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

    // Verify ownership first
    const existingItem = await getContentById(id);
    if (existingItem.coachId !== coach.id) {
      return NextResponse.json(
        { success: false, error: "Content not found" },
        { status: 404 }
      );
    }

    // Delete content item
    await deleteContentItem(id);

    return NextResponse.json({
      success: true,
      message: "Content deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting content item:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: "Failed to delete content item" 
      },
      { status: 500 }
    );
  }
}