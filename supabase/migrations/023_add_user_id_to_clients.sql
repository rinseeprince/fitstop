-- Add user_id column to clients table for authenticated client accounts
ALTER TABLE public.clients
  ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Create index for the new column
CREATE INDEX idx_clients_user_id ON public.clients(user_id);

-- Allow clients to view their own profile
CREATE POLICY "Clients can view own profile"
  ON public.clients FOR SELECT
  USING (auth.uid() = user_id);

-- Allow clients to update their own profile (limited fields)
CREATE POLICY "Clients can update own profile"
  ON public.clients FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
