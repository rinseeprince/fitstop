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

-- Create RLS policies
CREATE POLICY "Enable all operations for authenticated users" ON check_in_tokens
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Function to clean up expired tokens (can be called via cron job)
CREATE OR REPLACE FUNCTION clean_expired_tokens()
RETURNS void AS $$
BEGIN
  DELETE FROM check_in_tokens
  WHERE expires_at < NOW() AND used_at IS NULL;
END;
$$ LANGUAGE plpgsql;
