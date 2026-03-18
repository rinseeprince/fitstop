import { z } from "zod";

export const createContentItemSchema = z.object({
  title: z.string().min(1).max(200).trim(),
  description: z.string().max(2000).trim().optional(),
  type: z.enum(["image", "pdf", "document", "video_link", "hyperlink"]),
  url: z.string().url().max(2048).optional(),
  folderId: z.string().uuid().optional(),
  isLibrary: z.boolean().default(true),
  metadata: z.record(z.unknown()).optional(),
}).refine(
  (data) => {
    if (data.type === "video_link" || data.type === "hyperlink") {
      return !!data.url;
    }
    return true;
  },
  { message: "URL is required for link content", path: ["url"] }
);

export const createAssignmentSchema = z.object({
  contentId: z.string().uuid("Invalid content ID"),
  clientId: z.string().uuid("Invalid client ID"),
});

export const createFolderSchema = z.object({
  name: z.string().min(1).max(500).trim(),
  parentFolderId: z.string().uuid().optional(),
});

export const updateFolderSchema = z.object({
  name: z.string().min(1).max(500).trim().optional(),
  parentFolderId: z.string().nullable().optional(),
});

export const fetchMetadataSchema = z.object({
  url: z.string().url("Invalid URL").max(2048),
});

export const updateContentItemSchema = z.object({
  title: z.string().min(1).max(200).trim().optional(),
  description: z.string().max(2000).trim().optional(),
  folderId: z.string().uuid().nullable().optional(),
  isLibrary: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  metadata: z.record(z.unknown()).optional(),
});
