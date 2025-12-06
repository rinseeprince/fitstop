-- Add starting weight and body fat fields to clients table
-- These fields store the client's original/intake values for goal progress tracking

ALTER TABLE clients
ADD COLUMN IF NOT EXISTS starting_weight DECIMAL(6,2),
ADD COLUMN IF NOT EXISTS starting_body_fat_percentage DECIMAL(4,1);

-- Add comment to explain the purpose
COMMENT ON COLUMN clients.starting_weight IS 'Original weight at client intake, used for goal progress tracking';
COMMENT ON COLUMN clients.starting_body_fat_percentage IS 'Original body fat percentage at client intake, used for goal progress tracking';
