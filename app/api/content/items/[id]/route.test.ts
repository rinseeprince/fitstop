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

vi.mock("@/services/content-item-service", () => ({
  getContentById: vi.fn(),
  deleteContentItem: vi.fn(),
}));

import { DELETE } from "./route";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { deleteContentItem, getContentById } from "@/services/content-item-service";
import type { ContentItem } from "@/types/content";

const COACH = "coach-612";

function itemOf(coachId: string, id: string): ContentItem {
  return {
    id,
    coachId,
    title: "Tempo run notes",
    type: "document",
    metadata: {},
    isLibrary: false,
    sortOrder: 0,
    createdAt: "2026-09-11T16:20:00.000Z",
    updatedAt: "2026-09-11T16:20:00.000Z",
  };
}

function remove(id: string) {
  const request = new NextRequest(`http://localhost:3000/api/content/items/${id}`, { method: "DELETE" });
  return { request, run: () => DELETE(request, { params: Promise.resolve({ id }) }) };
}

describe("DELETE /api/content/items/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(COACH);
    vi.mocked(deleteContentItem).mockResolvedValue(undefined);
  });

  it("deletes the verified coach's item, the seam handed the request", async () => {
    vi.mocked(getContentById).mockResolvedValue(itemOf(COACH, "content-627"));
    const { request, run } = remove("content-627");

    const res = await run();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: "Content deleted successfully" });
    expect(getAuthenticatedCoachId).toHaveBeenCalledWith(request);
    expect(deleteContentItem).toHaveBeenCalledWith("content-627");
  });

  it("another coach's item is 404, and nothing is deleted", async () => {
    vi.mocked(getContentById).mockResolvedValue(itemOf("coach-639", "content-641"));

    const res = await remove("content-641").run();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Content not found" });
    expect(deleteContentItem).not.toHaveBeenCalled();
  });

  it("no coach is 401: the item is never read or deleted", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null);

    const res = await remove("content-656").run();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Unauthorized" });
    expect(getContentById).not.toHaveBeenCalled();
    expect(deleteContentItem).not.toHaveBeenCalled();
  });
});
