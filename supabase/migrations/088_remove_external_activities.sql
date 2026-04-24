-- =============================================================================
-- Migration 088: Remove external-activity features (A + B).
--
-- Reverses the schema added by migrations 016, 017, 030, and the
-- external_burn_calories column added by 077. Code references removed across
-- commits 1-6 of the external-activities refactor; this migration closes the
-- loop by dropping the now-orphaned DB objects.
--
-- Feature A: training-plan "external activities" (BJJ, cycling, etc.) —
--   sessions with session_type = 'external_activity' and activity_metadata.
--   AI-burn plumbing was never consumed; external_burn_calories on
--   nutrition_events was hardcoded 0 at every writer. Pre-gen activity
--   suggestions infrastructure (activity_suggestions table +
--   increment_activity_popularity RPC) is also dropped.
--
-- Feature B: daily "external activities" logged from Daily Pulse —
--   daily_external_activities table, write-only duplicate of data already
--   persisted inside daily_logs.trainingData.unplannedActivities JSONB.
--
-- CASCADE handles dependent policies, triggers, foreign keys, and indexes.
--
-- Pre-launch, zero production rows in any affected table — hard delete is safe.
-- =============================================================================

-- --- Feature A: pre-generation activity suggestions infrastructure ---

DROP FUNCTION IF EXISTS public.increment_activity_popularity(text);
DROP TABLE IF EXISTS public.activity_suggestions CASCADE;

-- --- Feature A: training_sessions columns (added by migration 016) ---

DROP INDEX IF EXISTS public.idx_training_sessions_type;
ALTER TABLE public.training_sessions
  DROP CONSTRAINT IF EXISTS training_sessions_session_type_check,
  DROP COLUMN IF EXISTS session_type,
  DROP COLUMN IF EXISTS activity_metadata;

-- --- Feature A: check-in external activities table (added by migration 017) ---

DROP TABLE IF EXISTS public.check_in_external_activities CASCADE;

-- --- Feature A: nutrition_events.external_burn_calories (added by migration 077) ---

ALTER TABLE public.nutrition_events
  DROP COLUMN IF EXISTS external_burn_calories;

-- --- Feature B: daily external activities table (added by migration 030) ---

DROP TABLE IF EXISTS public.daily_external_activities CASCADE;
