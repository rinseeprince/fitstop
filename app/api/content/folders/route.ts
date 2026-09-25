import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { createContentFolder, getCoachFolders } from "@/services/content-folder-service";
import { apiRateLimit } from "@/lib/rate-limit";
import { createFolderSchema } from "@/lib/validations/content";

export async function GET(request: NextRequest) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Fetch folders
    const folders = await getCoachFolders(coachId);

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

    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const parsed = createFolderSchema.safeParse(body);
    if (!parsed.success) {
      console.error("Create folder validation error:", parsed.error.flatten());
      return NextResponse.json(
        { error: "Invalid input" },
        { status: 400 }
      );
    }
    const { name, parentFolderId } = parsed.data;

    const existingFolders = await getCoachFolders(coachId);

    // Verify the parent folder (if any) belongs to this coach — a body-supplied
    // parentFolderId must not nest the folder inside another coach's folder.
    if (parentFolderId && !existingFolders.some((f) => f.id === parentFolderId)) {
      return NextResponse.json(
        { success: false, error: "Folder not found" },
        { status: 404 }
      );
    }

    // Check for duplicate folder names at the same level
    const duplicateExists = existingFolders.some(
      folder => 
        folder.name.toLowerCase() === name.toLowerCase() &&
        folder.parentFolderId === (parentFolderId || undefined)
    );

    if (duplicateExists) {
      return NextResponse.json(
        { success: false, error: "A folder with this name already exists at this level" },
        { status: 400 }
      );
    }

    // Create folder
    const folder = await createContentFolder({
      coachId,
      name,
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