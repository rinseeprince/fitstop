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
  createContentItem: vi.fn(),
  getCoachContent: vi.fn(),
}));

vi.mock("@/services/content-folder-service", () => ({
  getCoachFolders: vi.fn(),
}));

import { GET, POST } from "./route";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { createContentItem, getCoachContent } from "@/services/content-item-service";
import { getCoachFolders } from "@/services/content-folder-service";
import type { ContentFolder, ContentItem } from "@/types/content";

const COACH = "coach-531";
const FOLDER = "5d1e8c62-7f0a-4b19-9c32-000000000547";
const FOREIGN_FOLDER = "5d1e8c62-7f0a-4b19-9c32-000000000558";

const folder: ContentFolder = {
  id: FOLDER,
  coachId: COACH,
  name: "Warm-ups",
  sortOrder: 0,
  createdAt: "2026-08-14T10:02:00.000Z",
  updatedAt: "2026-08-14T10:02:00.000Z",
};

const created: ContentItem = {
  id: "content-563",
  coachId: COACH,
  folderId: FOLDER,
  title: "Hip opener",
  type: "video_link",
  url: "https://youtu.be/hip-opener-574",
  metadata: {},
  isLibrary: true,
  sortOrder: 0,
  createdAt: "2026-09-25T07:48:00.000Z",
  updatedAt: "2026-09-25T07:48:00.000Z",
};

function itemsRequest(method: "GET" | "POST", body?: unknown) {
  return new NextRequest("http://localhost:3000/api/content/items", {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const link = { title: "Hip opener", type: "video_link", url: "https://youtu.be/hip-opener-574", folderId: FOLDER };

describe("/api/content/items", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(COACH);
    vi.mocked(getCoachContent).mockResolvedValue([created]);
    vi.mocked(getCoachFolders).mockResolvedValue([folder]);
    vi.mocked(createContentItem).mockResolvedValue(created);
  });

  it("GET reads the items of the coach the auth seam verified, handed the request", async () => {
    const request = itemsRequest("GET");

    const res = await GET(request);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: [created] });
    expect(getAuthenticatedCoachId).toHaveBeenCalledWith(request);
    expect(getCoachContent).toHaveBeenCalledWith(COACH);
  });

  it("GET with no coach is 401, and nothing is read", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null);

    const res = await GET(itemsRequest("GET"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Unauthorized" });
    expect(getCoachContent).not.toHaveBeenCalled();
  });

  it("POST creates the item for the verified coach, in a folder of theirs", async () => {
    const request = itemsRequest("POST", link);

    const res = await POST(request);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: created, message: "Content created successfully" });
    expect(getAuthenticatedCoachId).toHaveBeenCalledWith(request);
    expect(getCoachFolders).toHaveBeenCalledWith(COACH);
    expect(createContentItem).toHaveBeenCalledWith({
      coachId: COACH,
      title: "Hip opener",
      description: undefined,
      type: "video_link",
      url: "https://youtu.be/hip-opener-574",
      folderId: FOLDER,
      isLibrary: true,
      metadata: {},
    });
  });

  it("POST into another coach's folder is 404, and nothing is created", async () => {
    const res = await POST(itemsRequest("POST", { ...link, folderId: FOREIGN_FOLDER }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Folder not found" });
    expect(createContentItem).not.toHaveBeenCalled();
  });

  it("POST with no coach is 401, and nothing is created", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null);

    const res = await POST(itemsRequest("POST", link));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Unauthorized" });
    expect(createContentItem).not.toHaveBeenCalled();
  });
});
