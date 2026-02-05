import { NextRequest, NextResponse } from "next/server";
import { fetchVideoMetadata, fetchLinkMetadata } from "@/services/content-service";

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json(
        { success: false, error: "URL is required" },
        { status: 400 }
      );
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (error) {
      return NextResponse.json(
        { success: false, error: "Invalid URL format" },
        { status: 400 }
      );
    }

    let metadata = null;

    // Check if it's a video URL
    if (url.includes("youtube.com") || url.includes("youtu.be") || url.includes("vimeo.com")) {
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