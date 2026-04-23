import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { createContentItem, getCoachContent } from "@/services/content-item-service";
import { apiRateLimit } from "@/lib/rate-limit";
import { createContentItemSchema } from "@/lib/validations/content";

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
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

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

    // Parse and validate request body
    const rawBody = await request.json();
    const parseResult = createContentItemSchema.safeParse(rawBody);
    if (!parseResult.success) {
      console.error("Validation error:", parseResult.error.format());
      return NextResponse.json(
        { success: false, error: "Invalid input" },
        { status: 400 }
      );
    }

    const { title, description, type, url, folderId, isLibrary, metadata } = parseResult.data;

    // Create content item
    const item = await createContentItem({
      coachId: coach.id,
      title,
      description,
      type,
      url,
      folderId,
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
        error: "Failed to create content item" 
      },
      { status: 500 }
    );
  }
}