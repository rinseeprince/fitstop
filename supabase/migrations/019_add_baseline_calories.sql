-- Add baseline_calories field to clients table
-- This stores the rest day calories (TDEE - required deficit)
-- Training day calories = baseline_calories + training session calories for that day

ALTER TABLE clients ADD COLUMN IF NOT EXISTS baseline_calories INTEGER;

-- Add comment for documentation
COMMENT ON COLUMN clients.baseline_calories IS 'Rest day calories calculated as TDEE minus required daily deficit to achieve goal weight by goal deadline';
