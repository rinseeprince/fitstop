import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getContentById } from "@/services/content-item-service";
import { getContentFileSignedUrl } from "@/services/content-storage-service";
import { apiRateLimit } from "@/lib/rate-limit";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ contentId: string }> }
) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const { contentId } = await params;
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

    // Get content item
    const content = await getContentById(contentId);

    // Check if user has access to this content
    let hasAccess = false;

    // Check if user is the coach who owns the content
    const { data: coach, error: coachError } = await supabase
      .from("coaches")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!coachError && coach && coach.id === content.coachId) {
      hasAccess = true;
    } else {
      // Check if user is a client with access to this content
      const { data: client, error: clientError } = await supabase
        .from("clients")
        .select("id, coach_id")
        .eq("user_id", user.id)
        .single();

      if (!clientError && client && client.coach_id === content.coachId) {
        // Check if content is in library or specifically assigned
        if (content.isLibrary) {
          hasAccess = true;
        } else {
          // Check if specifically assigned
          const { data: assignment, error: assignmentError } = await supabase
            .from("content_assignments")
            .select("id")
            .eq("content_id", contentId)
            .eq("client_id", client.id)
            .single();

          if (!assignmentError && assignment) {
            hasAccess = true;
          }
        }
      }
    }

    if (!hasAccess) {
      return NextResponse.json(
        { success: false, error: "Access denied" },
        { status: 403 }
      );
    }

    // For files, return signed URL
    if (content.storagePath) {
      const signedUrl = await getContentFileSignedUrl(content.storagePath, 3600); // 1 hour
      
      return NextResponse.json({
        success: true,
        data: {
          url: signedUrl,
          fileName: content.fileName,
          mimeType: content.mimeType,
        },
      });
    }

    // For links, return the URL directly
    if (content.url) {
      return NextResponse.json({
        success: true,
        data: {
          url: content.url,
        },
      });
    }

    return NextResponse.json(
      { success: false, error: "No file or URL available" },
      { status: 404 }
    );
  } catch (error) {
    console.error("Error getting content download URL:", error);
    return NextResponse.json(
      { success: false, error: "Failed to get download URL" },
      { status: 500 }
    );
  }
}