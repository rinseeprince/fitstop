-- =============================================================================
-- Migration 055: Rename session/exercise completion tables + Training history
-- protection + Soft deletes for training_sessions and training_exercises
-- =============================================================================

-- =============================================================================
-- PART A: Rename tables
-- =============================================================================

ALTER TABLE client_session_completions RENAME TO session_logs;
ALTER TABLE client_exercise_completions RENAME TO exercise_logs;
ALTER TABLE exercise_logs RENAME COLUMN session_completion_id TO session_log_id;

-- =============================================================================
-- PART A.1: Rename indexes (Postgres does not auto-rename)
-- =============================================================================

ALTER INDEX idx_client_session_completions_client RENAME TO idx_session_logs_client;
ALTER INDEX idx_client_session_completions_session RENAME TO idx_session_logs_session;
ALTER INDEX idx_client_exercise_completions_session RENAME TO idx_exercise_logs_session_log;

-- =============================================================================
-- PART A.2: Rename unique constraint indexes
-- Names confirmed via supabase inspect db index-usage
-- =============================================================================

ALTER INDEX client_session_completions_client_id_training_session_id_we_key
  RENAME TO session_logs_client_session_week_key;
ALTER INDEX client_exercise_completions_session_completion_id_training__key
  RENAME TO exercise_logs_session_log_exercise_key;

-- =============================================================================
-- PART A.3: Rename FK constraints
-- Postgres auto-names inline FKs as <table>_<column>_fkey
-- =============================================================================

ALTER TABLE session_logs RENAME CONSTRAINT client_session_completions_client_id_fkey
  TO session_logs_client_id_fkey;
ALTER TABLE session_logs RENAME CONSTRAINT client_session_completions_training_session_id_fkey
  TO session_logs_training_session_id_fkey;
ALTER TABLE exercise_logs RENAME CONSTRAINT client_exercise_completions_session_completion_id_fkey
  TO exercise_logs_session_log_id_fkey;
ALTER TABLE exercise_logs RENAME CONSTRAINT client_exercise_completions_training_exercise_id_fkey
  TO exercise_logs_training_exercise_id_fkey;

-- =============================================================================
-- PART A.4: Rename triggers
-- =============================================================================

ALTER TRIGGER client_session_completions_updated_at ON session_logs
  RENAME TO session_logs_updated_at;
ALTER TRIGGER client_exercise_completions_updated_at ON exercise_logs
  RENAME TO exercise_logs_updated_at;

-- =============================================================================
-- PART A.5: Drop and recreate RLS policies with new names
-- session_logs policies (5 total)
-- =============================================================================

DROP POLICY IF EXISTS "clients_view_own_session_completions" ON session_logs;
DROP POLICY IF EXISTS "clients_insert_session_completions" ON session_logs;
DROP POLICY IF EXISTS "clients_update_session_completions" ON session_logs;
DROP POLICY IF EXISTS "clients_delete_session_completions" ON session_logs;
DROP POLICY IF EXISTS "coaches_view_client_session_completions" ON session_logs;

CREATE POLICY "clients_view_own_session_logs"
  ON session_logs FOR SELECT
  USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "clients_insert_session_logs"
  ON session_logs FOR INSERT
  WITH CHECK (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "clients_update_session_logs"
  ON session_logs FOR UPDATE
  USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "clients_delete_session_logs"
  ON session_logs FOR DELETE
  USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "coaches_view_client_session_logs"
  ON session_logs FOR SELECT
  USING (
    client_id IN (
      SELECT id FROM clients WHERE coach_id IN (
        SELECT id FROM coaches WHERE user_id = auth.uid()
      )
    )
  );

-- =============================================================================
-- exercise_logs policies (5 total)
-- Reference session_logs (renamed) and session_log_id (renamed column)
-- =============================================================================

DROP POLICY IF EXISTS "clients_select_exercise_completions" ON exercise_logs;
DROP POLICY IF EXISTS "clients_insert_exercise_completions" ON exercise_logs;
DROP POLICY IF EXISTS "clients_update_exercise_completions" ON exercise_logs;
DROP POLICY IF EXISTS "clients_delete_exercise_completions" ON exercise_logs;
DROP POLICY IF EXISTS "coaches_view_client_exercise_completions" ON exercise_logs;

CREATE POLICY "clients_select_exercise_logs"
  ON exercise_logs FOR SELECT
  USING (
    session_log_id IN (
      SELECT id FROM session_logs
      WHERE client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "clients_insert_exercise_logs"
  ON exercise_logs FOR INSERT
  WITH CHECK (
    session_log_id IN (
      SELECT id FROM session_logs
      WHERE client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "clients_update_exercise_logs"
  ON exercise_logs FOR UPDATE
  USING (
    session_log_id IN (
      SELECT id FROM session_logs
      WHERE client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "clients_delete_exercise_logs"
  ON exercise_logs FOR DELETE
  USING (
    session_log_id IN (
      SELECT id FROM session_logs
      WHERE client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "coaches_view_client_exercise_logs"
  ON exercise_logs FOR SELECT
  USING (
    session_log_id IN (
      SELECT id FROM session_logs
      WHERE client_id IN (
        SELECT id FROM clients WHERE coach_id IN (
          SELECT id FROM coaches WHERE user_id = auth.uid()
        )
      )
    )
  );

-- =============================================================================
-- PART B: Training history protection - FK changes
-- Change CASCADE to SET NULL so completion history survives session/exercise
-- deletion. Make the FK columns nullable first.
-- =============================================================================

ALTER TABLE session_logs ALTER COLUMN training_session_id DROP NOT NULL;
ALTER TABLE session_logs DROP CONSTRAINT session_logs_training_session_id_fkey;
ALTER TABLE session_logs ADD CONSTRAINT session_logs_training_session_id_fkey
  FOREIGN KEY (training_session_id) REFERENCES training_sessions(id) ON DELETE SET NULL;

ALTER TABLE exercise_logs ALTER COLUMN training_exercise_id DROP NOT NULL;
ALTER TABLE exercise_logs DROP CONSTRAINT exercise_logs_training_exercise_id_fkey;
ALTER TABLE exercise_logs ADD CONSTRAINT exercise_logs_training_exercise_id_fkey
  FOREIGN KEY (training_exercise_id) REFERENCES training_exercises(id) ON DELETE SET NULL;

-- =============================================================================
-- PART C: Snapshot columns on session_logs and exercise_logs
-- Preserve prescribed details so history is readable even after FK is NULLed
-- =============================================================================

ALTER TABLE session_logs ADD COLUMN prescribed_session_snapshot JSONB;
ALTER TABLE exercise_logs ADD COLUMN prescribed_exercise_snapshot JSONB;

-- =============================================================================
-- PART D: Backfill snapshots from existing FK references
-- =============================================================================

UPDATE session_logs sl
SET prescribed_session_snapshot = jsonb_build_object(
  'name', ts.name,
  'day_of_week', ts.day_of_week,
  'focus', ts.focus,
  'session_type', ts.session_type,
  'estimated_duration_minutes', ts.estimated_duration_minutes
)
FROM training_sessions ts
WHERE sl.training_session_id = ts.id
  AND sl.prescribed_session_snapshot IS NULL;

UPDATE exercise_logs el
SET prescribed_exercise_snapshot = jsonb_build_object(
  'name', te.name,
  'sets', te.sets,
  'reps_min', te.reps_min,
  'reps_max', te.reps_max,
  'reps_target', te.reps_target,
  'rpe_target', te.rpe_target,
  'tempo', te.tempo,
  'rest_seconds', te.rest_seconds,
  'notes', te.notes,
  'superset_group', te.superset_group
)
FROM training_exercises te
WHERE el.training_exercise_id = te.id
  AND el.prescribed_exercise_snapshot IS NULL;

-- =============================================================================
-- PART E: Soft-delete columns on training_sessions and training_exercises
-- Migrations 053 and 054 were never persisted as files (Studio drift); on dev
-- training_sessions.is_active was added directly in Studio. IF NOT EXISTS makes
-- this replayable on any DB regardless of which path got it there.
-- =============================================================================

ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE training_exercises ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX idx_training_sessions_active
  ON training_sessions(plan_id, order_index) WHERE is_active = true;
CREATE INDEX idx_training_exercises_active
  ON training_exercises(session_id, order_index) WHERE is_active = true;
