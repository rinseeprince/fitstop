-- =============================================================================
-- Migration 096: exercises updated_at trigger + delta-sync index
--
-- WHY: the native client syncs the exercise catalog incrementally via
-- GET /api/client/exercises/catalog?since= keyed on updated_at (Session 3.9).
-- Two gaps blocked that contract:
--
--   (1) `exercises` had an updated_at column (DEFAULT NOW(), migration 083) but
--       NO trigger to bump it on UPDATE. So an edited row's updated_at stayed
--       frozen at insert time, and a delta filtering on `updated_at > since`
--       would silently MISS every UPDATE — clients would never see catalog
--       edits. The trigger below reuses update_updated_at_column() (migration
--       004) — the same BEFORE UPDATE function every other timestamped table
--       wires up.
--
--   (2) there was no index to serve `updated_at > since ORDER BY updated_at ASC`.
--       The delta read would degrade to a seq scan as the catalog grows. Per the
--       index-with-the-query convention (094/095), the read ships its index in
--       the same migration.
--
-- update_updated_at_column() is defined in migration 004
-- (CREATE OR REPLACE FUNCTION ... NEW.updated_at = NOW()).
-- =============================================================================

DROP TRIGGER IF EXISTS update_exercises_updated_at ON exercises;
CREATE TRIGGER update_exercises_updated_at
  BEFORE UPDATE ON exercises
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_exercises_updated_at ON exercises(updated_at);
