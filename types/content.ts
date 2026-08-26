// TypeScript types for Content Library System

// Content type enum
export type ContentType = 'video_link' | 'hyperlink' | 'pdf' | 'image' | 'document';

// Content folder type
export interface ContentFolder {
  id: string;
  coachId: string;
  name: string;
  parentFolderId?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// Content item type
export interface ContentItem {
  id: string;
  coachId: string;
  folderId?: string;
  title: string;
  description?: string;
  type: ContentType;
  url?: string; // For video links and hyperlinks
  storagePath?: string; // For uploaded files
  fileName?: string;
  fileSize?: number; // In bytes
  mimeType?: string;
  thumbnailUrl?: string;
  metadata: Record<string, any>; // For oEmbed data, Open Graph tags, etc.
  isLibrary: boolean; // Visible to all clients when true
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  folderName?: string; // Added for client display context
}

// Content assignment type
export interface ContentAssignment {
  id: string;
  contentId: string;
  clientId: string;
  assignedBy: string; // Coach ID
  assignedAt: string;
}

// Content folder with items and subfolders
export interface ContentFolderWithContents extends ContentFolder {
  subfolders?: ContentFolder[];
  items?: ContentItem[];
}

// Database insert types
export interface CreateContentFolderInput {
  coachId: string;
  name: string;
  parentFolderId?: string;
  sortOrder?: number;
}

export interface CreateContentItemInput {
  coachId: string;
  folderId?: string;
  title: string;
  description?: string;
  type: ContentType;
  url?: string;
  storagePath?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  thumbnailUrl?: string;
  metadata?: Record<string, any>;
  isLibrary?: boolean;
  sortOrder?: number;
}

export interface CreateContentAssignmentInput {
  contentId: string;
  clientId: string;
  assignedBy: string;
}

// Update types
export interface UpdateContentFolderInput {
  name?: string;
  parentFolderId?: string;
  sortOrder?: number;
}

// URL metadata types (for oEmbed and Open Graph)
export interface VideoMetadata {
  provider: 'youtube' | 'vimeo' | 'other';
  videoId?: string;
  title?: string;
  description?: string;
  thumbnailUrl?: string;
  duration?: number;
  embedHtml?: string;
}

export interface LinkMetadata {
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  url: string;
}

// API response types
export interface ContentLibraryResponse {
  folders: ContentFolderWithContents[];
  rootItems: ContentItem[]; // Items not in any folder
}

export interface ClientResourcesResponse {
  assignedContent: ContentItem[];
  libraryContent: ContentLibraryResponse;
}

// Database table types for migration compatibility
export interface ContentFolderRow {
  id: string;
  coach_id: string;
  name: string;
  parent_folder_id?: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ContentItemRow {
  id: string;
  coach_id: string;
  folder_id?: string;
  title: string;
  description?: string;
  type: ContentType;
  url?: string;
  storage_path?: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
  thumbnail_url?: string;
  metadata: any;
  is_library: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ContentAssignmentRow {
  id: string;
  content_id: string;
  client_id: string;
  assigned_by: string;
  assigned_at: string;
}