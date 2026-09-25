// @vitest-environment node
// A real multipart body: Node's own FormData and File, which the route reads.
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

vi.mock("@/services/content-storage-service", () => ({
  uploadContentFile: vi.fn(),
}));

vi.mock("@/services/content-item-service", () => ({
  createContentItem: vi.fn(),
}));

vi.mock("@/services/content-folder-service", () => ({
  getCoachFolders: vi.fn(),
}));

import { POST } from "./route";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { uploadContentFile } from "@/services/content-storage-service";
import { createContentItem } from "@/services/content-item-service";
import { getCoachFolders } from "@/services/content-folder-service";
import type { ContentFolder, ContentItem } from "@/types/content";

const COACH = "coach-1017";
const FOLDER = "folder-1052";
const FOREIGN_FOLDER = "folder-1063";

const coachFolder: ContentFolder = {
  id: FOLDER,
  coachId: COACH,
  name: "Race week",
  sortOrder: 0,
  createdAt: "2026-09-18T06:40:00.000Z",
  updatedAt: "2026-09-18T06:40:00.000Z",
};
const STORED = `${COACH}/tmp-1024/1790302024-taper-week.pdf`;

const created: ContentItem = {
  id: "content-1031",
  coachId: COACH,
  title: "Taper week",
  type: "pdf",
  storagePath: STORED,
  fileName: "taper-week.pdf",
  fileSize: 24,
  mimeType: "application/pdf",
  metadata: {},
  isLibrary: true,
  sortOrder: 0,
  createdAt: "2026-09-25T08:12:00.000Z",
  updatedAt: "2026-09-25T08:12:00.000Z",
};

function uploadRequest(folderId?: string) {
  const form = new FormData();
  form.append("file", new File(["%PDF-1.7 taper week 1045"], "taper-week.pdf", { type: "application/pdf" }));
  form.append("title", "Taper week");
  form.append("type", "pdf");
  form.append("isLibrary", "true");
  if (folderId) form.append("folderId", folderId);
  return new NextRequest("http://localhost:3000/api/content/upload", { method: "POST", body: form });
}

describe("POST /api/content/upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(COACH);
    vi.mocked(uploadContentFile).mockResolvedValue(STORED);
    vi.mocked(createContentItem).mockResolvedValue(created);
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("stores the file under the coach the auth seam verified, handed the request, and makes their item", async () => {
    const request = uploadRequest();

    const res = await POST(request);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: created, message: "File uploaded successfully" });
    expect(getAuthenticatedCoachId).toHaveBeenCalledWith(request);
    expect(uploadContentFile).toHaveBeenCalledWith(expect.any(File), COACH, expect.any(String));
    expect(createContentItem).toHaveBeenCalledWith({
      coachId: COACH,
      title: "Taper week",
      description: undefined,
      type: "pdf",
      folderId: undefined,
      isLibrary: true,
      fileName: "taper-week.pdf",
      fileSize: 24,
      mimeType: "application/pdf",
      storagePath: STORED,
    });
  });

  it("files the upload in one of the coach's own folders", async () => {
    vi.mocked(getCoachFolders).mockResolvedValue([coachFolder]);

    const res = await POST(uploadRequest(FOLDER));

    expect(res.status).toBe(200);
    expect(getCoachFolders).toHaveBeenCalledWith(COACH);
    expect(createContentItem).toHaveBeenCalledWith(expect.objectContaining({ coachId: COACH, folderId: FOLDER }));
  });

  it("an upload into a folder that is not the coach's is 404, before the file is stored", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(getCoachFolders).mockResolvedValue([coachFolder]);

    const res = await POST(uploadRequest(FOREIGN_FOLDER));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Folder not found" });
    expect(uploadContentFile).not.toHaveBeenCalled();
    expect(createContentItem).not.toHaveBeenCalled();
    expect(warned).toHaveBeenCalled();
    warned.mockRestore();
  });

  // Signed out, or signed in with no coach row (a client): the auth seam's
  // answer, in this route's own words.
  it("no coach is 401, before the form is read: nothing is stored", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null);
    const request = uploadRequest();
    const formRead = vi.spyOn(request, "formData");

    const res = await POST(request);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Authentication required" });
    expect(formRead).not.toHaveBeenCalled();
    expect(uploadContentFile).not.toHaveBeenCalled();
    expect(createContentItem).not.toHaveBeenCalled();
  });
});
