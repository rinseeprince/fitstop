import type {
  ContentFolder,
  ContentItem,
  ContentAssignment,
} from "@/types/content";

/**
 * Pure row-to-domain mappers for the content library tables. Shared across
 * content-folder-service, content-item-service, and content-assignment-service
 * so no split service has to import from another to get the shape right
 * (which would create a circular dependency the moment getClientResources /
 * getClientAssignedContent cross the line).
 */

// Using any for the Supabase row shape: the content_* tables currently live
// outside the generated Database types. Once types/database.ts is regenerated
// these can tighten to the real row types.

export const mapFolderFromDatabase = (row: any): ContentFolder => ({
  id: row.id,
  coachId: row.coach_id,
  name: row.name,
  parentFolderId: row.parent_folder_id,
  sortOrder: row.sort_order,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const mapContentItemFromDatabase = (row: any): ContentItem => ({
  id: row.id,
  coachId: row.coach_id,
  folderId: row.folder_id,
  title: row.title,
  description: row.description,
  type: row.type,
  url: row.url,
  storagePath: row.storage_path,
  fileName: row.file_name,
  fileSize: row.file_size,
  mimeType: row.mime_type,
  thumbnailUrl: row.thumbnail_url,
  metadata: row.metadata || {},
  isLibrary: row.is_library,
  sortOrder: row.sort_order,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const mapAssignmentFromDatabase = (row: any): ContentAssignment => ({
  id: row.id,
  contentId: row.content_id,
  clientId: row.client_id,
  assignedBy: row.assigned_by,
  assignedAt: row.assigned_at,
});
