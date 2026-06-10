import type { VideoMetadata, LinkMetadata } from "@/types/content";

// --- URL Metadata Operations ---

export const fetchVideoMetadata = async (
  url: string,
): Promise<VideoMetadata | null> => {
  try {
    // YouTube URL pattern
    const youtubeMatch = url.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/,
    );
    if (youtubeMatch) {
      const videoId = youtubeMatch[1];
      // Use oEmbed API for YouTube
      const response = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      );
      if (response.ok) {
        const data = await response.json();
        return {
          provider: "youtube",
          videoId,
          title: data.title,
          description: data.author_name,
          thumbnailUrl: data.thumbnail_url,
          embedHtml: data.html,
        };
      }
    }

    // Vimeo URL pattern
    const vimeoMatch = url.match(/vimeo\.com\/([0-9]+)/);
    if (vimeoMatch) {
      const videoId = vimeoMatch[1];
      const response = await fetch(
        `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`,
      );
      if (response.ok) {
        const data = await response.json();
        return {
          provider: "vimeo",
          videoId,
          title: data.title,
          description: data.author_name,
          thumbnailUrl: data.thumbnail_url,
          duration: data.duration,
          embedHtml: data.html,
        };
      }
    }

    return {
      provider: "other",
      title: "Video Link",
    };
  } catch (error) {
    console.error("Failed to fetch video metadata:", error);
    return null;
  }
};

// Allowed domains for metadata fetching to prevent SSRF attacks
const ALLOWED_METADATA_DOMAINS = [
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "vimeo.com",
  "www.vimeo.com",
  // Add other trusted domains as needed
];

const isAllowedDomain = (url: string): boolean => {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // Check against allowed domains
    return ALLOWED_METADATA_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith("." + domain),
    );
  } catch (_error) {
    return false;
  }
};

const sanitizeHtml = (html: string): string => {
  // Basic HTML sanitization - remove script tags and dangerous content
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/on\w+="[^"]*"/gi, "") // Remove event handlers
    .replace(/javascript:/gi, "")
    .trim();
};

export const fetchLinkMetadata = async (
  url: string,
): Promise<LinkMetadata | null> => {
  try {
    // Validate URL format
    if (!url || typeof url !== "string") {
      throw new Error("Invalid URL provided");
    }

    // Check if domain is allowed
    if (!isAllowedDomain(url)) {
      throw new Error("Domain not allowed for metadata fetching");
    }

    const response = await fetch(url, {
      headers: {
        "User-Agent": "CoachHub-MetadataBot/1.0",
      },
      // SSRF hardening: do NOT follow redirects. The host was checked against the
      // allowlist, but a redirect could send us to an internal IP. A 3xx response
      // is not `.ok`, so we fall through to the safe fallback below.
      redirect: "manual",
      // Add timeout to prevent hanging requests
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) return null;

    const html = await response.text();

    // Sanitize HTML content before processing
    const sanitizedHtml = sanitizeHtml(html);

    // Extract Open Graph tags from sanitized HTML
    const getMetaContent = (property: string): string | undefined => {
      const match = sanitizedHtml.match(
        new RegExp(
          `<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']+)["']`,
          "i",
        ),
      );
      return match?.[1]
        ?.replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
    };

    const getMetaTag = (name: string): string | undefined => {
      const match = sanitizedHtml.match(
        new RegExp(
          `<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']+)["']`,
          "i",
        ),
      );
      return match?.[1]
        ?.replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
    };

    const getTitleTag = (): string | undefined => {
      const match = sanitizedHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
      return match?.[1]
        ?.replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
    };

    return {
      title: getMetaContent("og:title") || getTitleTag() || "Link",
      description: getMetaContent("og:description") || getMetaTag("description"),
      imageUrl: getMetaContent("og:image"),
      siteName: getMetaContent("og:site_name"),
      url,
    };
  } catch (error) {
    console.error("Failed to fetch link metadata:", error);
    return {
      title: "Link",
      url,
    };
  }
};
