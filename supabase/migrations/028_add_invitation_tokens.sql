-- Add token and email fields to client_invitations table for new token-based invitation flow
-- This replaces the Supabase magic link approach with secure tokens sent via email

-- Add new columns
ALTER TABLE public.client_invitations 
ADD COLUMN token TEXT,
ADD COLUMN email TEXT;

-- Create unique constraint on token (for security and fast lookup)
CREATE UNIQUE INDEX idx_client_invitations_token ON public.client_invitations(token) WHERE token IS NOT NULL;

-- Create index for email lookups
CREATE INDEX idx_client_invitations_email ON public.client_invitations(email);

-- Backfill email field from existing client records
UPDATE public.client_invitations 
SET email = (
  SELECT email FROM public.clients 
  WHERE id = client_invitations.client_id
)
WHERE email IS NULL;

-- Make email NOT NULL after backfill
ALTER TABLE public.client_invitations 
ALTER COLUMN email SET NOT NULL;

-- Add comment explaining the new approach
COMMENT ON COLUMN public.client_invitations.token IS 'Secure random token for invitation links, replaces Supabase magic links';
COMMENT ON COLUMN public.client_invitations.email IS 'Client email address for invitation, cached for performance';