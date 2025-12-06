-- Add custom_calories column to clients table
-- This allows coaches to manually set calories alongside custom macros
ALTER TABLE clients
ADD COLUMN IF NOT EXISTS custom_calories NUMERIC(5, 0);

-- Add comment explaining the field
COMMENT ON COLUMN clients.custom_calories IS 'Custom calorie target when custom_macros_enabled is true. Should align with custom macro totals but allows manual override.';
