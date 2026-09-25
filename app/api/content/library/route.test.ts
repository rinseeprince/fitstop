import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn(),
}));

vi.mock("@/services/content-item-service", () => ({
  getCoachContentLibrary: vi.fn(),
}));

import { GET } from "./route";
import { apiRateLimit } from "@/lib/rate-limit";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { getCoachContentLibrary } from "@/services/content-item-service";

const COACH = "coach-512";

function libraryRequest() {
  return new NextRequest("http://localhost:3000/api/content/library", { method: "GET" });
}

describe("GET /api/content/library", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiRateLimit).mockResolvedValue(null);
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(COACH);
    vi.mocked(getCoachContentLibrary).mockResolvedValue({ folders: [], rootItems: [] });
  });

  it("reads the library of the coach the auth seam verified, handed the request", async () => {
    const request = libraryRequest();

    const res = await GET(request);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { folders: [], rootItems: [] } });
    expect(getAuthenticatedCoachId).toHaveBeenCalledWith(request);
    expect(getCoachContentLibrary).toHaveBeenCalledWith(COACH);
  });

  // Signed out, or signed in with no coach row (a client): the auth seam's
  // answer, as on every coach route.
  it("no coach is 401, and no library is read", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null);

    const res = await GET(libraryRequest());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Unauthorized" });
    expect(getCoachContentLibrary).not.toHaveBeenCalled();
  });
});
