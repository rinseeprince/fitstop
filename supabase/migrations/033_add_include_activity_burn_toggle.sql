-- Add per-client toggle for whether activity burn is factored into daily calorie targets.
-- Default TRUE preserves existing behavior (burn included).
ALTER TABLE clients ADD COLUMN IF NOT EXISTS include_activity_burn BOOLEAN NOT NULL DEFAULT TRUE;
