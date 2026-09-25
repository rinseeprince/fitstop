import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: vi.fn(),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn(),
}));

vi.mock("@/services/content-metadata-service", () => ({
  fetchVideoMetadata: vi.fn(),
  fetchLinkMetadata: vi.fn(),
}));

import { POST } from "./route";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { fetchLinkMetadata, fetchVideoMetadata } from "@/services/content-metadata-service";
import type { VideoMetadata } from "@/types/content";

const VIDEO = "https://www.youtube.com/watch?v=tempo-913";
const metadata: VideoMetadata = {
  provider: "youtube",
  videoId: "tempo-913",
  title: "Tempo run cues",
  thumbnailUrl: "https://i.ytimg.com/vi/tempo-913/hqdefault.jpg",
};

function metadataRequest(url: string) {
  return new NextRequest("http://localhost:3000/api/content/metadata", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

describe("POST /api/content/metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue("coach-918");
    vi.mocked(fetchVideoMetadata).mockResolvedValue(metadata);
  });

  it("fetches a link's details for a coach the auth seam verified, handed the request", async () => {
    const request = metadataRequest(VIDEO);

    const res = await POST(request);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: metadata });
    expect(getAuthenticatedCoachId).toHaveBeenCalledWith(request);
    expect(fetchVideoMetadata).toHaveBeenCalledWith(VIDEO);
  });

  it("no coach is 401, and nothing is fetched", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null);

    const res = await POST(metadataRequest(VIDEO));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Unauthorized" });
    expect(fetchVideoMetadata).not.toHaveBeenCalled();
    expect(fetchLinkMetadata).not.toHaveBeenCalled();
  });
});
