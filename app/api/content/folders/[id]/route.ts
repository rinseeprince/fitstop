import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { updateContentFolder, deleteContentFolder, getCoachFolders } from "@/services/content-folder-service";
import { apiRateLimit } from "@/lib/rate-limit";
import { updateFolderSchema } from "@/lib/validations/content";

export async function PATCH(
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
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Verify folder ownership
    const folders = await getCoachFolders(coachId);
    const existingFolder = folders.find(f => f.id === id);
    
    if (!existingFolder) {
      return NextResponse.json(
        { success: false, error: "Folder not found" },
        { status: 404 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const parsed = updateFolderSchema.safeParse(body);
    if (!parsed.success) {
      console.error("Update folder validation error:", parsed.error.flatten());
      return NextResponse.json(
        { error: "Invalid input" },
        { status: 400 }
      );
    }
    const { name, parentFolderId } = parsed.data;

    // Verify the new parent folder (if any) belongs to this coach — a
    // body-supplied parentFolderId must not move the folder into another
    // coach's folder.
    if (parentFolderId && !folders.some((f) => f.id === parentFolderId)) {
      return NextResponse.json(
        { success: false, error: "Folder not found" },
        { status: 404 }
      );
    }

    // Check for duplicate names if name is being changed
    if (name && name.trim().toLowerCase() !== existingFolder.name.toLowerCase()) {
      const duplicateExists = folders.some(
        folder => 
          folder.id !== id &&
          folder.name.toLowerCase() === name.trim().toLowerCase() &&
          folder.parentFolderId === (parentFolderId !== undefined ? parentFolderId : existingFolder.parentFolderId)
      );

      if (duplicateExists) {
        return NextResponse.json(
          { success: false, error: "A folder with this name already exists at this level" },
          { status: 400 }
        );
      }
    }

    // Prevent circular parent relationships
    if (parentFolderId === id) {
      return NextResponse.json(
        { success: false, error: "A folder cannot be its own parent" },
        { status: 400 }
      );
    }

    // Update folder
    const updatedFolder = await updateContentFolder(id, {
      name: name?.trim(),
      parentFolderId: parentFolderId === "" ? undefined : parentFolderId ?? undefined,
    });

    return NextResponse.json({
      success: true,
      data: updatedFolder,
      message: "Folder updated successfully",
    });
  } catch (error) {
    console.error("Error updating folder:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: "Failed to update folder" 
      },
      { status: 500 }
    );
  }
}

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
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Verify folder ownership
    const folders = await getCoachFolders(coachId);
    const existingFolder = folders.find(f => f.id === id);
    
    if (!existingFolder) {
      return NextResponse.json(
        { success: false, error: "Folder not found" },
        { status: 404 }
      );
    }

    // Check if folder has subfolders or content
    const _hasSubfolders = folders.some(f => f.parentFolderId === id);
    
    // Get content count in folder (this would require additional service method)
    // For now, we'll allow deletion and let the database cascade handle it
    // In production, you might want to check for content and warn the user

    // Delete folder (database CASCADE will move content to NULL folder)
    await deleteContentFolder(id);

    return NextResponse.json({
      success: true,
      message: "Folder deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting folder:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: "Failed to delete folder" 
      },
      { status: 500 }
    );
  }
}