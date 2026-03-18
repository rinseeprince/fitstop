-- Restore work_activity_level to clients table.
-- This was incorrectly dropped in migration 045 alongside nutrition plan
-- config fields. It's a client profile attribute (captured during intake),
-- not a nutrition plan setting.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS work_activity_level TEXT DEFAULT 'sedentary'
    CHECK (work_activity_level IN ('sedentary', 'lightly_active', 'moderately_active', 'very_active', 'extremely_active'));

COMMENT ON COLUMN clients.work_activity_level IS 'Work activity level for TDEE calculation (sedentary=1.2x to extremely_active=1.9x)';
