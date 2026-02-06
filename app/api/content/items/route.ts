import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { createContentItem, getCoachContent } from "@/services/content-service";

export async function GET(request: NextRequest) {
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

    // Fetch content items
    const items = await getCoachContent(coach.id);

    return NextResponse.json({
      success: true,
      data: items,
    });
  } catch (error) {
    console.error("Error fetching content items:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch content items" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
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

    // Parse request body
    const body = await request.json();
    const { title, description, type, url, folderId, isLibrary = true, metadata } = body;

    // Validate required fields
    if (!title || !type) {
      return NextResponse.json(
        { success: false, error: "Title and type are required" },
        { status: 400 }
      );
    }

    // For URL types, URL is required
    if ((type === "video_link" || type === "hyperlink") && !url) {
      return NextResponse.json(
        { success: false, error: "URL is required for link content" },
        { status: 400 }
      );
    }

    // Create content item
    const item = await createContentItem({
      coachId: coach.id,
      title: title.trim(),
      description: description?.trim(),
      type,
      url: url?.trim(),
      folderId: folderId || undefined,
      isLibrary,
      metadata: metadata || {},
    });

    return NextResponse.json({
      success: true,
      data: item,
      message: "Content created successfully",
    });
  } catch (error) {
    console.error("Error creating content item:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "Failed to create content item" 
      },
      { status: 500 }
    );
  }
}