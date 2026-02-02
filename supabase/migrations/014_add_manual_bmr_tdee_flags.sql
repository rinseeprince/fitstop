-- Add manual override flags for BMR and TDEE
-- This allows coaches to manually set these values without auto-recalculation
ALTER TABLE clients
ADD COLUMN IF NOT EXISTS bmr_manual_override BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS tdee_manual_override BOOLEAN DEFAULT FALSE;

-- Add comments explaining the fields
COMMENT ON COLUMN clients.bmr_manual_override IS 'When true, BMR will not be auto-recalculated when weight/height/age changes';
COMMENT ON COLUMN clients.tdee_manual_override IS 'When true, TDEE will not be auto-recalculated when BMR changes';
