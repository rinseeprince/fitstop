import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { uploadContentFile, createContentItem } from "@/services/content-service";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const ALLOWED_MIME_TYPES = [
  // Images
  "image/jpeg",
  "image/png", 
  "image/gif",
  "image/webp",
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
];

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

    // Parse form data
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const title = formData.get("title") as string;
    const description = formData.get("description") as string;
    const type = formData.get("type") as string;
    const folderId = formData.get("folderId") as string;
    const isLibrary = formData.get("isLibrary") === "true";

    // Validate required fields
    if (!file || !title || !type) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: "File size exceeds 50MB limit" },
        { status: 400 }
      );
    }

    // Validate file type
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: "File type not allowed" },
        { status: 400 }
      );
    }

    // Create content item first to get an ID
    const contentItem = await createContentItem({
      coachId: coach.id,
      title: title.trim(),
      description: description?.trim() || undefined,
      type: type as any,
      folderId: folderId || undefined,
      isLibrary,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
    });

    try {
      // Upload file to storage
      const storagePath = await uploadContentFile(file, coach.id, contentItem.id);

      // Update content item with storage path
      const response = await fetch(`${request.nextUrl.origin}/api/content/items/${contentItem.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Cookie": request.headers.get("Cookie") || "",
        },
        body: JSON.stringify({ storagePath }),
      });

      if (!response.ok) {
        throw new Error("Failed to update content item with storage path");
      }

      const updatedItem = await response.json();

      return NextResponse.json({
        success: true,
        data: updatedItem.data,
        message: "File uploaded successfully",
      });
    } catch (uploadError) {
      // If upload fails, clean up the content item
      await fetch(`${request.nextUrl.origin}/api/content/items/${contentItem.id}`, {
        method: "DELETE",
        headers: {
          "Cookie": request.headers.get("Cookie") || "",
        },
      });
      
      throw uploadError;
    }
  } catch (error) {
    console.error("Error uploading file:", error);
    
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "Failed to upload file" 
      },
      { status: 500 }
    );
  }
}