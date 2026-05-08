import { supabaseAdmin } from "./supabase-admin";
import { mapContentItemFromDatabase } from "@/lib/content-mappers";
import { getCoachFolders } from "./content-folder-service";
import { getClientAssignedContent } from "./content-assignment-service";
import { deleteContentFile } from "./content-storage-service";
import type {
  ContentItem,
  CreateContentItemInput,
  UpdateContentItemInput,
  ContentFolderWithContents,
  ContentLibraryResponse,
  ClientResourcesResponse,
} from "@/types/content";

// --- Content Item CRUD ---

export const createContentItem = async (
  input: CreateContentItemInput,
): Promise<ContentItem> => {
  const { data, error } = await supabaseAdmin
    .from("content_items")
    .insert({
      coach_id: input.coachId,
      folder_id: input.folderId,
      title: input.title,
      description: input.description,
      type: input.type,
      url: input.url,
      storage_path: input.storagePath,
      file_name: input.fileName,
      file_size: input.fileSize,
      mime_type: input.mimeType,
      thumbnail_url: input.thumbnailUrl,
      metadata: input.metadata || {},
      is_library: input.isLibrary !== false, // Default to true
      sort_order: input.sortOrder || 0,
    })
    .select()
    .single();

  if (error) {
    throw new Error("Failed to create content item");
  }

  return mapContentItemFromDatabase(data);
};

export const updateContentItem = async (
  contentId: string,
  input: UpdateContentItemInput,
): Promise<ContentItem> => {
  const raw: Record<string, unknown> = {
    folder_id: input.folderId,
    title: input.title,
    description: input.description,
    storage_path: input.storagePath,
    thumbnail_url: input.thumbnailUrl,
    metadata: input.metadata,
    is_library: input.isLibrary,
    sort_order: input.sortOrder,
  };

  // Remove undefined values to avoid updating with null
  const updateData = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== undefined)
  );

  const { data, error } = await supabaseAdmin
    .from("content_items")
    .update(updateData)
    .eq("id", contentId)
    .select()
    .single();

  if (error) {
    throw new Error("Failed to update content item");
  }

  return mapContentItemFromDatabase(data);
};

export const deleteContentItem = async (contentId: string): Promise<void> => {
  // First get the item to check if it has a file to delete
  const { data: item } = await supabaseAdmin
    .from("content_items")
    .select("storage_path")
    .eq("id", contentId)
    .single();

  // Delete the file from storage if it exists (delegated to storage service
  // so the split boundary stays clean — this service doesn't know about the
  // Supabase Storage bucket name).
  if (item?.storage_path) {
    await deleteContentFile(item.storage_path);
  }

  // Delete the database record
  const { error } = await supabaseAdmin
    .from("content_items")
    .delete()
    .eq("id", contentId);

  if (error) {
    throw new Error("Failed to delete content item");
  }
};

export const getCoachContent = async (
  coachId: string,
): Promise<ContentItem[]> => {
  const { data, error } = await supabaseAdmin
    .from("content_items")
    .select("*")
    .eq("coach_id", coachId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("Failed to fetch content");
  }

  return data.map(mapContentItemFromDatabase);
};

export const getContentById = async (
  contentId: string,
): Promise<ContentItem> => {
  const { data, error } = await supabaseAdmin
    .from("content_items")
    .select("*")
    .eq("id", contentId)
    .single();

  if (error) {
    throw new Error("Failed to fetch content");
  }

  return mapContentItemFromDatabase(data);
};

// --- Aggregations ---
// Item-centric reads that also pull folder structure and assignments. Kept
// in this service because folders and assignments are both read-only
// enrichments of the item view — if we put these in folder-service or
// assignment-service we'd need circular imports.

export const getCoachContentLibrary = async (
  coachId: string,
): Promise<ContentLibraryResponse> => {
  const [folders, items] = await Promise.all([
    getCoachFolders(coachId),
    getCoachContent(coachId),
  ]);

  // Group folders with their content
  const foldersWithContents: ContentFolderWithContents[] = folders.map(
    (folder) => ({
      ...folder,
      items: items.filter((item) => item.folderId === folder.id),
      subfolders: folders.filter((f) => f.parentFolderId === folder.id),
    }),
  );

  // Get root folders (no parent) and root items (no folder)
  const rootFolders = foldersWithContents.filter((f) => !f.parentFolderId);
  const rootItems = items.filter((item) => !item.folderId);

  return {
    folders: rootFolders,
    rootItems,
  };
};

export const getClientResources = async (
  clientId: string,
  coachId: string,
): Promise<ClientResourcesResponse> => {
  const [assignedContent, libraryContent] = await Promise.all([
    getClientAssignedContent(clientId),
    getCoachContentLibrary(coachId),
  ]);

  // Helper function to recursively extract all library items from folders
  const extractLibraryItems = (
    folders: ContentFolderWithContents[],
  ): ContentItem[] => {
    let allItems: ContentItem[] = [];

    for (const folder of folders) {
      // Get items from this folder that are marked as library
      const folderLibraryItems = (folder.items || [])
        .filter((item) => item.isLibrary)
        .map((item) => ({
          ...item,
          folderName: folder.name, // Add folder name for context
        }));

      allItems = [...allItems, ...folderLibraryItems];

      // Recursively get items from subfolders
      if (folder.subfolders && folder.subfolders.length > 0) {
        const subfolderItems = extractLibraryItems(folder.subfolders);
        allItems = [...allItems, ...subfolderItems];
      }
    }

    return allItems;
  };

  // Get all library items from folders (flattened)
  const itemsFromFolders = extractLibraryItems(libraryContent.folders);

  // Get root library items (not in any folder)
  const rootLibraryItems = libraryContent.rootItems.filter(
    (item) => item.isLibrary,
  );

  // Combine all library items
  const allLibraryItems = [...rootLibraryItems, ...itemsFromFolders];

  // Return flattened structure for client view
  const filteredLibraryContent = {
    folders: [], // Clients don't see folder structure
    rootItems: allLibraryItems, // All library items in flat list
  };

  return {
    assignedContent,
    libraryContent: filteredLibraryContent,
  };
};
