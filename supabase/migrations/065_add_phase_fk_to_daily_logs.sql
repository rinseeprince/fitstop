-- =============================================================================
-- Migration 065: Add FK constraints for phase_id on daily_logs and daily_habit_logs
-- These columns were added in migration 056 as bare UUIDs with no FK.
-- =============================================================================

-- Safety: NULL out any orphaned values before adding FK constraints.
-- These columns are unpopulated today but this guards against manual data.
UPDATE daily_logs SET phase_id = NULL WHERE phase_id IS NOT NULL;
UPDATE daily_habit_logs SET phase_id = NULL WHERE phase_id IS NOT NULL;

ALTER TABLE daily_logs
  ADD CONSTRAINT daily_logs_phase_id_fkey
  FOREIGN KEY (phase_id) REFERENCES phases(id) ON DELETE SET NULL;

ALTER TABLE daily_habit_logs
  ADD CONSTRAINT daily_habit_logs_phase_id_fkey
  FOREIGN KEY (phase_id) REFERENCES phases(id) ON DELETE SET NULL;
