-- Add calorie skewing (custom per-day baseline distribution) to clients
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS custom_day_distribution BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS day_calorie_overrides JSONB DEFAULT null;

COMMENT ON COLUMN clients.custom_day_distribution IS 'When true, use per-day baseline overrides instead of flat baseline_calories';
COMMENT ON COLUMN clients.day_calorie_overrides IS 'Per-day baseline calorie/macro overrides: { "monday": { "calories": 1800, "protein_g": 170, "carbs_g": 200, "fat_g": 60 }, ... }';
