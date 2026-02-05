-- Content Library System
-- Allows coaches to upload and organize resources for their clients
-- Supports videos, links, PDFs, images, and documents

-- Create content_folders table for organizing content
CREATE TABLE IF NOT EXISTS public.content_folders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  coach_id UUID NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  parent_folder_id UUID REFERENCES public.content_folders(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  -- Ensure folder names are unique within the same parent for a coach
  UNIQUE(coach_id, parent_folder_id, name)
);

-- Create index for efficient folder queries
CREATE INDEX idx_content_folders_coach_id ON public.content_folders(coach_id);
CREATE INDEX idx_content_folders_parent_folder_id ON public.content_folders(parent_folder_id);

-- Create content type enum
CREATE TYPE content_type AS ENUM ('video_link', 'hyperlink', 'pdf', 'image', 'document');

-- Create content_items table for storing all content
CREATE TABLE IF NOT EXISTS public.content_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  coach_id UUID NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  folder_id UUID REFERENCES public.content_folders(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  type content_type NOT NULL,
  
  -- URL for links and video URLs
  url TEXT,
  
  -- Storage fields for uploaded files
  storage_path TEXT,
  file_name TEXT,
  file_size BIGINT,
  mime_type TEXT,
  
  -- Metadata for thumbnails and previews
  thumbnail_url TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Visibility settings
  is_library BOOLEAN DEFAULT TRUE, -- visible to all clients when true
  
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  -- Ensure either URL or storage_path is provided based on type
  CONSTRAINT content_url_or_storage CHECK (
    (type IN ('video_link', 'hyperlink') AND url IS NOT NULL) OR
    (type IN ('pdf', 'image', 'document') AND storage_path IS NOT NULL)
  )
);

-- Create indexes for efficient content queries
CREATE INDEX idx_content_items_coach_id ON public.content_items(coach_id);
CREATE INDEX idx_content_items_folder_id ON public.content_items(folder_id);
CREATE INDEX idx_content_items_type ON public.content_items(type);
CREATE INDEX idx_content_items_is_library ON public.content_items(is_library);

-- Create content_assignments table for assigning content to specific clients
CREATE TABLE IF NOT EXISTS public.content_assignments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  content_id UUID NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  assigned_by UUID NOT NULL REFERENCES public.coaches(id),
  assigned_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  -- Prevent duplicate assignments
  UNIQUE(content_id, client_id)
);

-- Create indexes for efficient assignment queries
CREATE INDEX idx_content_assignments_content_id ON public.content_assignments(content_id);
CREATE INDEX idx_content_assignments_client_id ON public.content_assignments(client_id);

-- Enable Row Level Security
ALTER TABLE public.content_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_assignments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for content_folders
-- Coaches can manage their own folders
CREATE POLICY "Coaches can view their own folders"
  ON public.content_folders
  FOR SELECT
  TO authenticated
  USING (
    coach_id IN (
      SELECT id FROM public.coaches WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Coaches can create their own folders"
  ON public.content_folders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    coach_id IN (
      SELECT id FROM public.coaches WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Coaches can update their own folders"
  ON public.content_folders
  FOR UPDATE
  TO authenticated
  USING (
    coach_id IN (
      SELECT id FROM public.coaches WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    coach_id IN (
      SELECT id FROM public.coaches WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Coaches can delete their own folders"
  ON public.content_folders
  FOR DELETE
  TO authenticated
  USING (
    coach_id IN (
      SELECT id FROM public.coaches WHERE user_id = auth.uid()
    )
  );

-- Clients can view folders from their coach
CREATE POLICY "Clients can view their coach's folders"
  ON public.content_folders
  FOR SELECT
  TO authenticated
  USING (
    coach_id IN (
      SELECT coach_id FROM public.clients WHERE user_id = auth.uid()
    )
  );

-- RLS Policies for content_items
-- Coaches can manage their own content
CREATE POLICY "Coaches can view their own content"
  ON public.content_items
  FOR SELECT
  TO authenticated
  USING (
    coach_id IN (
      SELECT id FROM public.coaches WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Coaches can create their own content"
  ON public.content_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    coach_id IN (
      SELECT id FROM public.coaches WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Coaches can update their own content"
  ON public.content_items
  FOR UPDATE
  TO authenticated
  USING (
    coach_id IN (
      SELECT id FROM public.coaches WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    coach_id IN (
      SELECT id FROM public.coaches WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Coaches can delete their own content"
  ON public.content_items
  FOR DELETE
  TO authenticated
  USING (
    coach_id IN (
      SELECT id FROM public.coaches WHERE user_id = auth.uid()
    )
  );

-- Clients can view library content from their coach
CREATE POLICY "Clients can view library content from their coach"
  ON public.content_items
  FOR SELECT
  TO authenticated
  USING (
    is_library = TRUE 
    AND coach_id IN (
      SELECT coach_id FROM public.clients WHERE user_id = auth.uid()
    )
  );

-- Clients can view content specifically assigned to them
CREATE POLICY "Clients can view assigned content"
  ON public.content_items
  FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT content_id 
      FROM public.content_assignments 
      WHERE client_id IN (
        SELECT id FROM public.clients WHERE user_id = auth.uid()
      )
    )
  );

-- RLS Policies for content_assignments
-- Coaches can manage assignments for their clients
CREATE POLICY "Coaches can view assignments for their clients"
  ON public.content_assignments
  FOR SELECT
  TO authenticated
  USING (
    assigned_by IN (
      SELECT id FROM public.coaches WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Coaches can create assignments for their clients"
  ON public.content_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    assigned_by IN (
      SELECT id FROM public.coaches WHERE user_id = auth.uid()
    )
    AND client_id IN (
      SELECT id FROM public.clients 
      WHERE coach_id IN (
        SELECT id FROM public.coaches WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Coaches can delete assignments for their clients"
  ON public.content_assignments
  FOR DELETE
  TO authenticated
  USING (
    assigned_by IN (
      SELECT id FROM public.coaches WHERE user_id = auth.uid()
    )
  );

-- Clients can view their own assignments
CREATE POLICY "Clients can view their own assignments"
  ON public.content_assignments
  FOR SELECT
  TO authenticated
  USING (
    client_id IN (
      SELECT id FROM public.clients WHERE user_id = auth.uid()
    )
  );

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_content_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_content_folders_updated_at
  BEFORE UPDATE ON public.content_folders
  FOR EACH ROW
  EXECUTE FUNCTION update_content_updated_at();

CREATE TRIGGER update_content_items_updated_at
  BEFORE UPDATE ON public.content_items
  FOR EACH ROW
  EXECUTE FUNCTION update_content_updated_at();

-- Create storage bucket for content library
INSERT INTO storage.buckets (id, name, public)
VALUES ('content-library', 'content-library', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for content-library bucket
-- Coaches can upload files to their own folder
CREATE POLICY "Coaches can upload content"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'content-library' 
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.coaches WHERE user_id = auth.uid()
    )
  );

-- Coaches can view their own files
CREATE POLICY "Coaches can view their own content"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'content-library' 
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.coaches WHERE user_id = auth.uid()
    )
  );

-- Coaches can delete their own files
CREATE POLICY "Coaches can delete their own content"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'content-library' 
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.coaches WHERE user_id = auth.uid()
    )
  );

-- Clients can view files from their coach
CREATE POLICY "Clients can view their coach's content"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'content-library' 
    AND (storage.foldername(name))[1] IN (
      SELECT coach_id::text FROM public.clients WHERE user_id = auth.uid()
    )
  );

-- Add helpful comments
COMMENT ON TABLE public.content_folders IS 'Organizes content into folders for coaches, supports one level of nesting';
COMMENT ON TABLE public.content_items IS 'Stores all content types (videos, links, PDFs, images, documents) for coach libraries';
COMMENT ON TABLE public.content_assignments IS 'Tracks which content items are specifically assigned to individual clients';
COMMENT ON COLUMN public.content_items.is_library IS 'When true, content is visible to all of the coach''s clients';
COMMENT ON COLUMN public.content_items.metadata IS 'Stores oEmbed data, Open Graph tags, and other metadata for content';