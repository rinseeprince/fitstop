-- =============================================================================
-- Migration 058: FK cascade fixes + missing indexes
-- =============================================================================

-- Fix missing CASCADE on nutrition_weekly_summaries
ALTER TABLE nutrition_weekly_summaries
  DROP CONSTRAINT IF EXISTS nutrition_weekly_summaries_client_id_fkey;
ALTER TABLE nutrition_weekly_summaries
  ADD CONSTRAINT nutrition_weekly_summaries_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

-- Fix missing CASCADE on check_in_reminders
ALTER TABLE check_in_reminders
  DROP CONSTRAINT IF EXISTS check_in_reminders_client_id_fkey;
ALTER TABLE check_in_reminders
  ADD CONSTRAINT check_in_reminders_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

-- Fix check_in_exercise_highlights.exercise_id CASCADE -> SET NULL
-- Exercise highlights should survive exercise deletion (they have exercise_name as backup)
ALTER TABLE check_in_exercise_highlights
  DROP CONSTRAINT IF EXISTS check_in_exercise_highlights_exercise_id_fkey;
ALTER TABLE check_in_exercise_highlights
  ADD CONSTRAINT check_in_exercise_highlights_exercise_id_fkey
    FOREIGN KEY (exercise_id) REFERENCES training_exercises(id) ON DELETE SET NULL;

-- Add composite index on daily_logs spine (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_daily_logs_client_date
  ON daily_logs(client_id, date DESC);
