-- Create client_invitations table to track invitation status
CREATE TABLE public.client_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'accepted', 'expired')) DEFAULT 'pending',
  invited_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id)
);

-- Enable RLS
ALTER TABLE public.client_invitations ENABLE ROW LEVEL SECURITY;

-- Coaches can view invitations for their own clients
CREATE POLICY "Coaches can view client invitations"
  ON public.client_invitations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.clients c
      JOIN public.coaches co ON c.coach_id = co.id
      WHERE c.id = client_invitations.client_id
      AND co.user_id = auth.uid()
    )
  );

-- Coaches can insert invitations for their own clients
CREATE POLICY "Coaches can create client invitations"
  ON public.client_invitations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.clients c
      JOIN public.coaches co ON c.coach_id = co.id
      WHERE c.id = client_invitations.client_id
      AND co.user_id = auth.uid()
    )
  );

-- Coaches can update invitations for their own clients
CREATE POLICY "Coaches can update client invitations"
  ON public.client_invitations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.clients c
      JOIN public.coaches co ON c.coach_id = co.id
      WHERE c.id = client_invitations.client_id
      AND co.user_id = auth.uid()
    )
  );

-- Create indexes
CREATE INDEX idx_client_invitations_client_id ON public.client_invitations(client_id);
CREATE INDEX idx_client_invitations_status ON public.client_invitations(status);

-- Trigger to update updated_at
CREATE TRIGGER client_invitations_updated_at
  BEFORE UPDATE ON public.client_invitations
  FOR EACH ROW
  EXECUTE FUNCTION update_profiles_updated_at();
