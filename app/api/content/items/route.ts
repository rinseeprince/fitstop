import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { createContentItem, getCoachContent } from "@/services/content-item-service";
import { getCoachFolders } from "@/services/content-folder-service";
import { apiRateLimit } from "@/lib/rate-limit";
import { createContentItemSchema } from "@/lib/validations/content";

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

    // Fetch content items
    const items = await getCoachContent(coachId);

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

    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
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

    // Verify the target folder (if any) belongs to this coach — a body-supplied
    // folderId must not attach the item to another coach's folder.
    if (folderId) {
      const folders = await getCoachFolders(coachId);
      if (!folders.some((f) => f.id === folderId)) {
        return NextResponse.json(
          { success: false, error: "Folder not found" },
          { status: 404 }
        );
      }
    }

    // Create content item
    const item = await createContentItem({
      coachId,
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