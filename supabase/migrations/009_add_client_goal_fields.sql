-- Add goal and metric fields to clients table
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS goal_weight NUMERIC(5, 1),
  ADD COLUMN IF NOT EXISTS weight_unit TEXT DEFAULT 'lbs' CHECK (weight_unit IN ('lbs', 'kg')),
  ADD COLUMN IF NOT EXISTS current_weight NUMERIC(5, 1),
  ADD COLUMN IF NOT EXISTS current_body_fat_percentage NUMERIC(4, 2),
  ADD COLUMN IF NOT EXISTS goal_body_fat_percentage NUMERIC(4, 2),
  ADD COLUMN IF NOT EXISTS height NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS height_unit TEXT DEFAULT 'in' CHECK (height_unit IN ('in', 'cm')),
  ADD COLUMN IF NOT EXISTS gender TEXT CHECK (gender IN ('male', 'female', 'other')),
  ADD COLUMN IF NOT EXISTS bmr NUMERIC(6, 1),
  ADD COLUMN IF NOT EXISTS tdee NUMERIC(6, 1);

-- Add comments to describe the fields
COMMENT ON COLUMN clients.goal_weight IS 'Target weight goal for the client (static until manually updated by coach)';
COMMENT ON COLUMN clients.weight_unit IS 'Preferred unit of measurement for weight (lbs or kg)';
COMMENT ON COLUMN clients.current_weight IS 'Current weight of the client (automatically updated from latest check-in)';
COMMENT ON COLUMN clients.current_body_fat_percentage IS 'Current body fat percentage (automatically updated from latest check-in)';
COMMENT ON COLUMN clients.goal_body_fat_percentage IS 'Target body fat percentage goal (static until manually updated by coach)';
COMMENT ON COLUMN clients.height IS 'Height of the client (static field)';
COMMENT ON COLUMN clients.height_unit IS 'Unit of measurement for height (in or cm)';
COMMENT ON COLUMN clients.gender IS 'Gender of the client for BMR calculations';
COMMENT ON COLUMN clients.bmr IS 'Basal Metabolic Rate calculated by AI';
COMMENT ON COLUMN clients.tdee IS 'Total Daily Energy Expenditure (BMR × activity factor)';
