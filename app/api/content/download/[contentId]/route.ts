import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId, getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { getContentById } from "@/services/content-item-service";
import { getContentFileSignedUrl } from "@/services/content-storage-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { apiRateLimit } from "@/lib/rate-limit";
import type { ContentItem } from "@/types/content";

/**
 * Whether an item is open to a client: they are an active client of its coach,
 * and it is in the coach's library or assigned to them. Both reads are the
 * service role's, scoped to the client the auth seam verified, so these
 * filters are the whole check. A read that fails opens nothing.
 */
async function openToClient(content: ContentItem, clientId: string): Promise<boolean> {
  const { data: client, error: clientError } = await supabaseAdmin
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("coach_id", content.coachId)
    .eq("active", true)
    .maybeSingle();
  if (clientError) {
    console.error("Error reading the client for a content download:", clientError.message);
    return false;
  }
  if (!client) return false;
  if (content.isLibrary) return true;

  const { data: assignment, error: assignmentError } = await supabaseAdmin
    .from("content_assignments")
    .select("id")
    .eq("content_id", content.id)
    .eq("client_id", clientId)
    .maybeSingle();
  if (assignmentError) {
    console.error("Error reading the assignment for a content download:", assignmentError.message);
    return false;
  }
  return assignment !== null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ contentId: string }> }
) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const { contentId } = await params;
  try {
    // Both roles call this route: an active client of the item's coach, from
    // their Resources page (the one screen that does), and the coach. The
    // client is resolved first, so a client's download checks the session
    // once; the coach only when the session has no active client, or when the
    // item is not open to the client.
    const clientId = await getAuthenticatedClientId(request);
    const coachId = clientId ? null : await getAuthenticatedCoachId(request);
    if (!clientId && !coachId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get content item
    const content = await getContentById(contentId);

    // The item's coach may open it, and so may a client it is open to; nobody
    // else. A client it is not open to may still be the coach who owns it.
    const hasAccess = clientId
      ? (await openToClient(content, clientId)) ||
        (await getAuthenticatedCoachId(request)) === content.coachId
      : coachId === content.coachId;

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
