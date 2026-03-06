import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { fetchVideoMetadata, fetchLinkMetadata } from "@/services/content-service";
import { apiRateLimit } from "@/lib/rate-limit";
import { validateExternalUrl } from "@/lib/url-safety";

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

    // Get coach profile to ensure user is a coach
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

    const { url } = await request.json();

    if (!url) {
      return NextResponse.json(
        { success: false, error: "URL is required" },
        { status: 400 }
      );
    }

    // Validate URL format and block internal/private URLs (SSRF protection)
    const urlError = validateExternalUrl(url);
    if (urlError) {
      return NextResponse.json(
        { success: false, error: urlError },
        { status: 400 }
      );
    }

    let metadata = null;

    // Check if it's a video URL using proper domain matching
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    const isVideoUrl = ["youtube.com", "www.youtube.com", "youtu.be", "vimeo.com", "www.vimeo.com"]
      .some(domain => hostname === domain);

    if (isVideoUrl) {
      metadata = await fetchVideoMetadata(url);
    } else {
      // Try to fetch general link metadata
      metadata = await fetchLinkMetadata(url);
    }

    if (!metadata) {
      return NextResponse.json(
        { success: false, error: "Could not fetch metadata for this URL" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data: metadata,
    });
  } catch (error) {
    console.error("Error fetching URL metadata:", error);
    
    // Return partial success for URLs where we couldn't fetch metadata
    return NextResponse.json({
      success: true,
      data: {
        title: "Link",
        description: "External link",
      },
    });
  }
}