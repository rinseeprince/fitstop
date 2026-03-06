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
