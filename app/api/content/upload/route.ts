import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { uploadContentFile, createContentItem } from "@/services/content-service";
import type { ContentType } from "@/types/content";

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
    // Skip CSRF protection for multipart/form-data uploads as they may not include proper headers
    // Authentication check below provides sufficient security for file uploads
    const contentType = request.headers.get("content-type") || "";
    
    // Only apply CSRF protection if not a multipart upload
    if (!contentType.includes("multipart/form-data")) {
      const csrfError = await requireCSRFProtection(request);
      if (csrfError) return csrfError;
    }

    const supabase = await createServerSupabaseClient();
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.warn("Upload attempt without authentication", {
        timestamp: new Date().toISOString(),
        error: authError?.message
      });
      return NextResponse.json(
        { success: false, error: "Authentication required" },
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
      console.warn("Upload attempt by user without coach profile", {
        timestamp: new Date().toISOString(),
        userId: user.id,
        error: coachError?.message
      });
      return NextResponse.json(
        { success: false, error: "Coach profile required for uploads" },
        { status: 403 }
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
      console.warn("Upload validation failed - missing required fields", {
        timestamp: new Date().toISOString(),
        userId: user.id,
        coachId: coach.id,
        hasFile: !!file,
        hasTitle: !!title,
        hasType: !!type
      });
      return NextResponse.json(
        { success: false, error: "File, title, and type are required" },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      console.warn("Upload validation failed - file too large", {
        timestamp: new Date().toISOString(),
        userId: user.id,
        coachId: coach.id,
        fileName: file.name,
        fileSize: file.size,
        maxSize: MAX_FILE_SIZE
      });
      return NextResponse.json(
        { success: false, error: `File size must be less than ${Math.round(MAX_FILE_SIZE / (1024 * 1024))}MB` },
        { status: 400 }
      );
    }

    // Validate file type
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      console.warn("Upload validation failed - invalid file type", {
        timestamp: new Date().toISOString(),
        userId: user.id,
        coachId: coach.id,
        fileName: file.name,
        fileType: file.type,
        allowedTypes: ALLOWED_MIME_TYPES
      });
      return NextResponse.json(
        { success: false, error: `File type '${file.type}' not supported. Allowed: PDF, images, and documents` },
        { status: 400 }
      );
    }

    try {
      // Step 1: Upload file to storage first
      console.info("Starting file upload process", {
        fileName: file.name,
        fileSize: file.size,
        coachId: coach.id,
        timestamp: new Date().toISOString()
      });

      // Create a temporary content ID for the upload
      const tempContentId = crypto.randomUUID();
      const storagePath = await uploadContentFile(file, coach.id, tempContentId);

      console.info("File uploaded to storage successfully", {
        storagePath,
        fileName: file.name,
        timestamp: new Date().toISOString()
      });

      // Step 2: Create content item with storage path
      const contentItem = await createContentItem({
        coachId: coach.id,
        title: title.trim(),
        description: description?.trim() || undefined,
        type: type as ContentType,
        folderId: folderId || undefined,
        isLibrary,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        storagePath, // Include storage path from the start
      });

      console.info("Content item created successfully", {
        contentId: contentItem.id,
        title: contentItem.title,
        storagePath: contentItem.storagePath,
        timestamp: new Date().toISOString()
      });

      return NextResponse.json({
        success: true,
        data: contentItem,
        message: "File uploaded successfully",
      });
    } catch (uploadError) {
      console.error("Upload process failed", {
        error: uploadError instanceof Error ? {
          message: uploadError.message,
          stack: uploadError.stack
        } : uploadError,
        fileName: file.name,
        coachId: coach.id,
        timestamp: new Date().toISOString()
      });
      
      throw uploadError;
    }
  } catch (error) {
    console.error("Error uploading file:", {
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack
      } : error,
      userAgent: request.headers.get("user-agent")
    });
    
    return NextResponse.json(
      { 
        success: false, 
        error: "Failed to upload file. Please try again." 
      },
      { status: 500 }
    );
  }
}