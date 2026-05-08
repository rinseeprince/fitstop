import type {
  ContentFolder,
  ContentItem,
  ContentAssignment,
} from "@/types/content";
import type {
  ContentFolderRow,
  ContentItemRow,
  ContentAssignmentRow,
} from "@/lib/database-helpers";

/**
 * Pure row-to-domain mappers for the content library tables. Shared across
 * content-folder-service, content-item-service, and content-assignment-service
 * so no split service has to import from another to get the shape right
 * (which would create a circular dependency the moment getClientResources /
 * getClientAssignedContent cross the line).
 */

export const mapFolderFromDatabase = (row: ContentFolderRow): ContentFolder => ({
  id: row.id,
  coachId: row.coach_id,
  name: row.name,
  parentFolderId: row.parent_folder_id ?? undefined,
  sortOrder: row.sort_order ?? 0,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const mapContentItemFromDatabase = (row: ContentItemRow): ContentItem => ({
  id: row.id,
  coachId: row.coach_id,
  folderId: row.folder_id ?? undefined,
  title: row.title,
  description: row.description ?? undefined,
  type: row.type,
  url: row.url ?? undefined,
  storagePath: row.storage_path ?? undefined,
  fileName: row.file_name ?? undefined,
  fileSize: row.file_size ?? undefined,
  mimeType: row.mime_type ?? undefined,
  thumbnailUrl: row.thumbnail_url ?? undefined,
  metadata: (row.metadata ?? {}) as Record<string, any>,
  isLibrary: row.is_library ?? false,
  sortOrder: row.sort_order ?? 0,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const mapAssignmentFromDatabase = (row: ContentAssignmentRow): ContentAssignment => ({
  id: row.id,
  contentId: row.content_id,
  clientId: row.client_id,
  assignedBy: row.assigned_by,
  assignedAt: row.assigned_at,
});
