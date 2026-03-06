import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { createContentFolder, getCoachFolders } from "@/services/content-service";
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

    // Fetch folders
    const folders = await getCoachFolders(coach.id);

    return NextResponse.json({
      success: true,
      data: folders,
    });
  } catch (error) {
    console.error("Error fetching folders:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch folders" },
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

    // Parse request body
    const body = await request.json();
    const { name, parentFolderId } = body;

    // Validate required fields
    if (!name || !name.trim()) {
      return NextResponse.json(
        { success: false, error: "Folder name is required" },
        { status: 400 }
      );
    }

    // Check for duplicate folder names at the same level
    const existingFolders = await getCoachFolders(coach.id);
    const duplicateExists = existingFolders.some(
      folder => 
        folder.name.toLowerCase() === name.trim().toLowerCase() &&
        folder.parentFolderId === (parentFolderId || null)
    );

    if (duplicateExists) {
      return NextResponse.json(
        { success: false, error: "A folder with this name already exists at this level" },
        { status: 400 }
      );
    }

    // Create folder
    const folder = await createContentFolder({
      coachId: coach.id,
      name: name.trim(),
      parentFolderId: parentFolderId || undefined,
    });

    return NextResponse.json({
      success: true,
      data: folder,
      message: "Folder created successfully",
    });
  } catch (error) {
    console.error("Error creating folder:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: "Failed to create folder" 
      },
      { status: 500 }
    );
  }
}