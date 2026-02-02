-- Create check_in_tokens table
CREATE TABLE IF NOT EXISTS check_in_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used_at TIMESTAMP WITH TIME ZONE,
  check_in_id UUID REFERENCES check_ins(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on token for fast lookups
CREATE INDEX idx_check_in_tokens_token ON check_in_tokens(token);

-- Create index on client_id
CREATE INDEX idx_check_in_tokens_client_id ON check_in_tokens(client_id);

-- Create index on expires_at for cleanup queries
CREATE INDEX idx_check_in_tokens_expires_at ON check_in_tokens(expires_at);

-- Enable Row Level Security (RLS)
ALTER TABLE check_in_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policies:
-- Note: Service role (used by API routes) automatically bypasses RLS
-- These policies apply to authenticated coaches using the anon key

-- Allow authenticated users to read tokens
-- TODO: When coach-client relationship table is added, filter by: coach_id = auth.uid()
CREATE POLICY "Authenticated users can view tokens" ON check_in_tokens
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Allow authenticated users to create tokens (for generating check-in links)
-- TODO: When coach-client relationship table is added, ensure: coach owns the client
CREATE POLICY "Authenticated users can create tokens" ON check_in_tokens
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Block anonymous access
-- Token validation and marking as used are handled by API routes using service role

-- Function to clean up expired tokens (can be called via cron job)
CREATE OR REPLACE FUNCTION clean_expired_tokens()
RETURNS void AS $$
BEGIN
  DELETE FROM check_in_tokens
  WHERE expires_at < NOW() AND used_at IS NULL;
END;
$$ LANGUAGE plpgsql;
