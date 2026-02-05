import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { updateContentFolder, deleteContentFolder, getCoachFolders } from "@/services/content-service";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
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

    // Verify folder ownership
    const folders = await getCoachFolders(coach.id);
    const existingFolder = folders.find(f => f.id === params.id);
    
    if (!existingFolder) {
      return NextResponse.json(
        { success: false, error: "Folder not found" },
        { status: 404 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { name, parentFolderId } = body;

    // Validate name if provided
    if (name !== undefined && (!name || !name.trim())) {
      return NextResponse.json(
        { success: false, error: "Folder name cannot be empty" },
        { status: 400 }
      );
    }

    // Check for duplicate names if name is being changed
    if (name && name.trim().toLowerCase() !== existingFolder.name.toLowerCase()) {
      const duplicateExists = folders.some(
        folder => 
          folder.id !== params.id &&
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
    if (parentFolderId === params.id) {
      return NextResponse.json(
        { success: false, error: "A folder cannot be its own parent" },
        { status: 400 }
      );
    }

    // Update folder
    const updatedFolder = await updateContentFolder(params.id, {
      name: name?.trim(),
      parentFolderId: parentFolderId === "" ? undefined : parentFolderId,
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
        error: error instanceof Error ? error.message : "Failed to update folder" 
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
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

    // Verify folder ownership
    const folders = await getCoachFolders(coach.id);
    const existingFolder = folders.find(f => f.id === params.id);
    
    if (!existingFolder) {
      return NextResponse.json(
        { success: false, error: "Folder not found" },
        { status: 404 }
      );
    }

    // Check if folder has subfolders or content
    const hasSubfolders = folders.some(f => f.parentFolderId === params.id);
    
    // Get content count in folder (this would require additional service method)
    // For now, we'll allow deletion and let the database cascade handle it
    // In production, you might want to check for content and warn the user

    // Delete folder (database CASCADE will move content to NULL folder)
    await deleteContentFolder(params.id);

    return NextResponse.json({
      success: true,
      message: "Folder deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting folder:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "Failed to delete folder" 
      },
      { status: 500 }
    );
  }
}