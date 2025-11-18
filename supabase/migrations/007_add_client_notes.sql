-- Add notes column to clients table
ALTER TABLE clients
ADD COLUMN notes TEXT;

-- Add comment for documentation
COMMENT ON COLUMN clients.notes IS 'Optional notes or description about the client';
