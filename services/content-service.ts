import { supabaseAdmin } from "./supabase-admin";
import type { 
  ContentFolder, 
  ContentItem, 
  ContentAssignment,
  CreateContentFolderInput,
  CreateContentItemInput,
  CreateContentAssignmentInput,
  UpdateContentFolderInput,
  UpdateContentItemInput,
  ContentFolderWithContents,
  ContentLibraryResponse,
  ClientResourcesResponse,
  VideoMetadata,
  LinkMetadata
} from "@/types/content";

const CONTENT_BUCKET = "content-library";

// Folder Operations
export const createContentFolder = async (
  input: CreateContentFolderInput
): Promise<ContentFolder> => {
  const { data, error } = await supabaseAdmin
    .from("content_folders")
    .insert({
      coach_id: input.coachId,
      name: input.name,
      parent_folder_id: input.parentFolderId,
      sort_order: input.sortOrder || 0,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create folder: ${error.message}`);
  }

  return mapFolderFromDatabase(data);
};

export const updateContentFolder = async (
  folderId: string,
  input: UpdateContentFolderInput
): Promise<ContentFolder> => {
  const { data, error } = await supabaseAdmin
    .from("content_folders")
    .update({
      name: input.name,
      parent_folder_id: input.parentFolderId,
      sort_order: input.sortOrder,
    })
    .eq("id", folderId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update folder: ${error.message}`);
  }

  return mapFolderFromDatabase(data);
};

export const deleteContentFolder = async (folderId: string): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("content_folders")
    .delete()
    .eq("id", folderId);

  if (error) {
    throw new Error(`Failed to delete folder: ${error.message}`);
  }
};

export const getCoachFolders = async (coachId: string): Promise<ContentFolder[]> => {
  const { data, error } = await supabaseAdmin
    .from("content_folders")
    .select("*")
    .eq("coach_id", coachId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch folders: ${error.message}`);
  }

  return data.map(mapFolderFromDatabase);
};

// Content Item Operations
export const createContentItem = async (
  input: CreateContentItemInput
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
    throw new Error(`Failed to create content item: ${error.message}`);
  }

  return mapContentItemFromDatabase(data);
};

export const updateContentItem = async (
  contentId: string,
  input: UpdateContentItemInput
): Promise<ContentItem> => {
  const { data, error } = await supabaseAdmin
    .from("content_items")
    .update({
      folder_id: input.folderId,
      title: input.title,
      description: input.description,
      thumbnail_url: input.thumbnailUrl,
      metadata: input.metadata,
      is_library: input.isLibrary,
      sort_order: input.sortOrder,
    })
    .eq("id", contentId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update content item: ${error.message}`);
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

  // Delete the file from storage if it exists
  if (item?.storage_path) {
    await deleteContentFile(item.storage_path);
  }

  // Delete the database record
  const { error } = await supabaseAdmin
    .from("content_items")
    .delete()
    .eq("id", contentId);

  if (error) {
    throw new Error(`Failed to delete content item: ${error.message}`);
  }
};

export const getCoachContent = async (coachId: string): Promise<ContentItem[]> => {
  const { data, error } = await supabaseAdmin
    .from("content_items")
    .select("*")
    .eq("coach_id", coachId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch content: ${error.message}`);
  }

  return data.map(mapContentItemFromDatabase);
};

export const getContentById = async (contentId: string): Promise<ContentItem> => {
  const { data, error } = await supabaseAdmin
    .from("content_items")
    .select("*")
    .eq("id", contentId)
    .single();

  if (error) {
    throw new Error(`Failed to fetch content: ${error.message}`);
  }

  return mapContentItemFromDatabase(data);
};

// Assignment Operations
export const assignContentToClient = async (
  input: CreateContentAssignmentInput
): Promise<ContentAssignment> => {
  const { data, error } = await supabaseAdmin
    .from("content_assignments")
    .insert({
      content_id: input.contentId,
      client_id: input.clientId,
      assigned_by: input.assignedBy,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to assign content: ${error.message}`);
  }

  return mapAssignmentFromDatabase(data);
};

export const unassignContentFromClient = async (
  contentId: string,
  clientId: string
): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("content_assignments")
    .delete()
    .eq("content_id", contentId)
    .eq("client_id", clientId);

  if (error) {
    throw new Error(`Failed to unassign content: ${error.message}`);
  }
};

export const getContentAssignments = async (
  contentId: string
): Promise<ContentAssignment[]> => {
  const { data, error } = await supabaseAdmin
    .from("content_assignments")
    .select("*")
    .eq("content_id", contentId);

  if (error) {
    throw new Error(`Failed to fetch assignments: ${error.message}`);
  }

  return data.map(mapAssignmentFromDatabase);
};

export const getClientAssignedContent = async (
  clientId: string
): Promise<ContentItem[]> => {
  const { data, error } = await supabaseAdmin
    .from("content_items")
    .select(`
      *,
      content_assignments!inner(client_id)
    `)
    .eq("content_assignments.client_id", clientId)
    .order("content_assignments.assigned_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch assigned content: ${error.message}`);
  }

  return data.map(mapContentItemFromDatabase);
};

// Combined Operations
export const getCoachContentLibrary = async (
  coachId: string
): Promise<ContentLibraryResponse> => {
  const [folders, items] = await Promise.all([
    getCoachFolders(coachId),
    getCoachContent(coachId),
  ]);

  // Group folders with their content
  const foldersWithContents: ContentFolderWithContents[] = folders.map((folder) => ({
    ...folder,
    items: items.filter((item) => item.folderId === folder.id),
    subfolders: folders.filter((f) => f.parentFolderId === folder.id),
  }));

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
  coachId: string
): Promise<ClientResourcesResponse> => {
  const [assignedContent, libraryContent] = await Promise.all([
    getClientAssignedContent(clientId),
    getCoachContentLibrary(coachId),
  ]);

  // Filter library content to only show library items
  const filteredLibraryContent = {
    ...libraryContent,
    folders: libraryContent.folders.map((folder) => ({
      ...folder,
      items: folder.items?.filter((item) => item.isLibrary) || [],
    })),
    rootItems: libraryContent.rootItems.filter((item) => item.isLibrary),
  };

  return {
    assignedContent,
    libraryContent: filteredLibraryContent,
  };
};

// File Storage Operations
export const uploadContentFile = async (
  file: File,
  coachId: string,
  contentId: string
): Promise<string> => {
  const fileExt = file.name.split(".").pop();
  const fileName = `${coachId}/${contentId}/${Date.now()}-${file.name}`;

  const { data, error } = await supabaseAdmin.storage
    .from(CONTENT_BUCKET)
    .upload(fileName, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (error) {
    throw new Error(`Failed to upload file: ${error.message}`);
  }

  return data.path;
};

export const getContentFileSignedUrl = async (
  filePath: string,
  expiresIn: number = 3600
): Promise<string> => {
  const { data, error } = await supabaseAdmin.storage
    .from(CONTENT_BUCKET)
    .createSignedUrl(filePath, expiresIn);

  if (error) {
    throw new Error(`Failed to get signed URL: ${error.message}`);
  }

  return data.signedUrl;
};

export const deleteContentFile = async (filePath: string): Promise<void> => {
  const { error } = await supabaseAdmin.storage
    .from(CONTENT_BUCKET)
    .remove([filePath]);

  if (error) {
    throw new Error(`Failed to delete file: ${error.message}`);
  }
};

// URL Metadata Operations
export const fetchVideoMetadata = async (url: string): Promise<VideoMetadata | null> => {
  try {
    // YouTube URL pattern
    const youtubeMatch = url.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/
    );
    if (youtubeMatch) {
      const videoId = youtubeMatch[1];
      // Use oEmbed API for YouTube
      const response = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
      );
      if (response.ok) {
        const data = await response.json();
        return {
          provider: "youtube",
          videoId,
          title: data.title,
          description: data.author_name,
          thumbnailUrl: data.thumbnail_url,
          embedHtml: data.html,
        };
      }
    }

    // Vimeo URL pattern
    const vimeoMatch = url.match(/vimeo\.com\/([0-9]+)/);
    if (vimeoMatch) {
      const videoId = vimeoMatch[1];
      const response = await fetch(
        `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`
      );
      if (response.ok) {
        const data = await response.json();
        return {
          provider: "vimeo",
          videoId,
          title: data.title,
          description: data.author_name,
          thumbnailUrl: data.thumbnail_url,
          duration: data.duration,
          embedHtml: data.html,
        };
      }
    }

    return {
      provider: "other",
      title: "Video Link",
    };
  } catch (error) {
    console.error("Failed to fetch video metadata:", error);
    return null;
  }
};

// Allowed domains for metadata fetching to prevent SSRF attacks
const ALLOWED_METADATA_DOMAINS = [
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'vimeo.com',
  'www.vimeo.com',
  // Add other trusted domains as needed
];

const isAllowedDomain = (url: string): boolean => {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    
    // Check against allowed domains
    return ALLOWED_METADATA_DOMAINS.some(domain => 
      hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch (error) {
    return false;
  }
};

const sanitizeHtml = (html: string): string => {
  // Basic HTML sanitization - remove script tags and dangerous content
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '') // Remove event handlers
    .replace(/javascript:/gi, '')
    .trim();
};

export const fetchLinkMetadata = async (url: string): Promise<LinkMetadata | null> => {
  try {
    // Validate URL format
    if (!url || typeof url !== 'string') {
      throw new Error('Invalid URL provided');
    }

    // Check if domain is allowed
    if (!isAllowedDomain(url)) {
      throw new Error('Domain not allowed for metadata fetching');
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'CoachHub-MetadataBot/1.0',
      },
      // Add timeout to prevent hanging requests
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });
    
    if (!response.ok) return null;

    const html = await response.text();
    
    // Sanitize HTML content before processing
    const sanitizedHtml = sanitizeHtml(html);
    
    // Extract Open Graph tags from sanitized HTML
    const getMetaContent = (property: string): string | undefined => {
      const match = sanitizedHtml.match(
        new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']+)["']`, 'i')
      );
      return match?.[1]?.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    };

    const getMetaTag = (name: string): string | undefined => {
      const match = sanitizedHtml.match(
        new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i')
      );
      return match?.[1]?.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    };

    const getTitleTag = (): string | undefined => {
      const match = sanitizedHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
      return match?.[1]?.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    };

    return {
      title: getMetaContent("og:title") || getTitleTag() || "Link",
      description: getMetaContent("og:description") || getMetaTag("description"),
      imageUrl: getMetaContent("og:image"),
      siteName: getMetaContent("og:site_name"),
      url,
    };
  } catch (error) {
    console.error("Failed to fetch link metadata:", error);
    return {
      title: "Link",
      url,
    };
  }
};

// Helper mapping functions
const mapFolderFromDatabase = (row: any): ContentFolder => ({
  id: row.id,
  coachId: row.coach_id,
  name: row.name,
  parentFolderId: row.parent_folder_id,
  sortOrder: row.sort_order,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapContentItemFromDatabase = (row: any): ContentItem => ({
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

const mapAssignmentFromDatabase = (row: any): ContentAssignment => ({
  id: row.id,
  contentId: row.content_id,
  clientId: row.client_id,
  assignedBy: row.assigned_by,
  assignedAt: row.assigned_at,
});