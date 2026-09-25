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

vi.mock("@/services/content-folder-service", () => ({
  createContentFolder: vi.fn(),
  getCoachFolders: vi.fn(),
}));

import { GET, POST } from "./route";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { createContentFolder, getCoachFolders } from "@/services/content-folder-service";
import type { ContentFolder } from "@/types/content";

const COACH = "coach-713";

function folder(id: string, name: string): ContentFolder {
  return {
    id,
    coachId: COACH,
    name,
    sortOrder: 0,
    createdAt: "2026-07-29T09:44:00.000Z",
    updatedAt: "2026-07-29T09:44:00.000Z",
  };
}

const existing = folder("folder-724", "Recovery");
const made = folder("folder-736", "Race prep");

function foldersRequest(method: "GET" | "POST", body?: unknown) {
  return new NextRequest("http://localhost:3000/api/content/folders", {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("/api/content/folders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(COACH);
    vi.mocked(getCoachFolders).mockResolvedValue([existing]);
    vi.mocked(createContentFolder).mockResolvedValue(made);
  });

  it("GET reads the folders of the coach the auth seam verified, handed the request", async () => {
    const request = foldersRequest("GET");

    const res = await GET(request);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: [existing] });
    expect(getAuthenticatedCoachId).toHaveBeenCalledWith(request);
    expect(getCoachFolders).toHaveBeenCalledWith(COACH);
  });

  it("GET with no coach is 401, and nothing is read", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null);

    const res = await GET(foldersRequest("GET"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Unauthorized" });
    expect(getCoachFolders).not.toHaveBeenCalled();
  });

  it("POST creates the folder for the verified coach", async () => {
    const request = foldersRequest("POST", { name: "Race prep" });

    const res = await POST(request);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: made, message: "Folder created successfully" });
    expect(getAuthenticatedCoachId).toHaveBeenCalledWith(request);
    expect(getCoachFolders).toHaveBeenCalledWith(COACH);
    expect(createContentFolder).toHaveBeenCalledWith({ coachId: COACH, name: "Race prep", parentFolderId: undefined });
  });

  it("POST with a name the coach already has at that level is 400, and nothing is created", async () => {
    const res = await POST(foldersRequest("POST", { name: "recovery" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "A folder with this name already exists at this level" });
    expect(createContentFolder).not.toHaveBeenCalled();
  });

  it("POST with no coach is 401, and nothing is created", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null);

    const res = await POST(foldersRequest("POST", { name: "Race prep" }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Unauthorized" });
    expect(createContentFolder).not.toHaveBeenCalled();
  });
});
