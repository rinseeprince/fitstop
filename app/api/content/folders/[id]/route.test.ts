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
  updateContentFolder: vi.fn(),
  deleteContentFolder: vi.fn(),
  getCoachFolders: vi.fn(),
}));

import { DELETE, PATCH } from "./route";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { deleteContentFolder, getCoachFolders, updateContentFolder } from "@/services/content-folder-service";
import type { ContentFolder } from "@/types/content";

const COACH = "coach-814";
const FOLDER = "folder-825";

const own: ContentFolder = {
  id: FOLDER,
  coachId: COACH,
  name: "Mobility",
  sortOrder: 0,
  createdAt: "2026-06-03T12:15:00.000Z",
  updatedAt: "2026-06-03T12:15:00.000Z",
};
const renamed: ContentFolder = { ...own, name: "Mobility drills", updatedAt: "2026-09-25T08:03:00.000Z" };
const season: ContentFolder = { ...own, id: "folder-861", name: "Race season" };

function folderRequest(method: "PATCH" | "DELETE", id: string, body?: unknown) {
  const request = new NextRequest(`http://localhost:3000/api/content/folders/${id}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const context = { params: Promise.resolve({ id }) };
  return { request, context };
}

describe("/api/content/folders/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(COACH);
    // The coach's folders: the one a request names is theirs only if it is here.
    vi.mocked(getCoachFolders).mockResolvedValue([own]);
    vi.mocked(updateContentFolder).mockResolvedValue(renamed);
    vi.mocked(deleteContentFolder).mockResolvedValue(undefined);
  });

  it("PATCH renames the verified coach's folder, the seam handed the request", async () => {
    const { request, context } = folderRequest("PATCH", FOLDER, { name: "Mobility drills" });

    const res = await PATCH(request, context);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: renamed, message: "Folder updated successfully" });
    expect(getAuthenticatedCoachId).toHaveBeenCalledWith(request);
    expect(getCoachFolders).toHaveBeenCalledWith(COACH);
    expect(updateContentFolder).toHaveBeenCalledWith(FOLDER, { name: "Mobility drills", parentFolderId: undefined });
  });

  it("PATCH on another coach's folder is 404, and nothing is renamed", async () => {
    const { request, context } = folderRequest("PATCH", "folder-837", { name: "Mobility drills" });

    const res = await PATCH(request, context);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Folder not found" });
    expect(updateContentFolder).not.toHaveBeenCalled();
  });

  it("PATCH moves the folder into another of the coach's folders", async () => {
    vi.mocked(getCoachFolders).mockResolvedValue([own, season]);
    const { request, context } = folderRequest("PATCH", FOLDER, { parentFolderId: "folder-861" });

    const res = await PATCH(request, context);

    expect(res.status).toBe(200);
    expect(updateContentFolder).toHaveBeenCalledWith(FOLDER, { name: undefined, parentFolderId: "folder-861" });
  });

  it("PATCH into a folder that is not the coach's is 404, and nothing is moved", async () => {
    const { request, context } = folderRequest("PATCH", FOLDER, { parentFolderId: "folder-873" });

    const res = await PATCH(request, context);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Folder not found" });
    expect(updateContentFolder).not.toHaveBeenCalled();
  });

  it("PATCH with no coach is 401, and nothing is read or renamed", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null);
    const { request, context } = folderRequest("PATCH", FOLDER, { name: "Mobility drills" });

    const res = await PATCH(request, context);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Unauthorized" });
    expect(getCoachFolders).not.toHaveBeenCalled();
    expect(updateContentFolder).not.toHaveBeenCalled();
  });

  it("DELETE removes the verified coach's folder, the seam handed the request", async () => {
    const { request, context } = folderRequest("DELETE", FOLDER);

    const res = await DELETE(request, context);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: "Folder deleted successfully" });
    expect(getAuthenticatedCoachId).toHaveBeenCalledWith(request);
    expect(deleteContentFolder).toHaveBeenCalledWith(FOLDER);
  });

  it("DELETE on another coach's folder is 404, and nothing is removed", async () => {
    const { request, context } = folderRequest("DELETE", "folder-849");

    const res = await DELETE(request, context);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Folder not found" });
    expect(deleteContentFolder).not.toHaveBeenCalled();
  });

  it("DELETE with no coach is 401, and nothing is read or removed", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null);
    const { request, context } = folderRequest("DELETE", FOLDER);

    const res = await DELETE(request, context);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Unauthorized" });
    expect(getCoachFolders).not.toHaveBeenCalled();
    expect(deleteContentFolder).not.toHaveBeenCalled();
  });
});
