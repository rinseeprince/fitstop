-- 090_normalize_set_logs.sql
--
-- Normalizes per-set workout actuals into a dedicated child table and replaces
-- the lossy scalar aggregates on exercise_logs (actual_sets, actual_reps csv,
-- actual_weight = top set only). Adds full per-set fidelity including RPE.
--
-- Also adds:
--   * exercise_logs.exercise_id  — optional FK to global exercises catalog,
--     populated when the client picks an exercise from the typeahead picker
--     (separate from training_exercise_id, which is the prescription FK).
--   * exercise_logs.performed_name — name of what the client actually did.
--     Differs from prescribed_exercise_snapshot.name when swapped or freehand.
--
-- See plan: ~/.claude/plans/session-1-5-tracker-recursive-clarke.md

-- =============================================================================
-- 1. set_logs: per-set child table.
-- =============================================================================

CREATE TABLE IF NOT EXISTS set_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_log_id UUID NOT NULL REFERENCES exercise_logs(id) ON DELETE CASCADE,
  set_number INT NOT NULL CHECK (set_number >= 1),
  reps INT CHECK (reps IS NULL OR (reps >= 1 AND reps <= 100)),
  weight NUMERIC(7,2) CHECK (weight IS NULL OR (weight >= 0 AND weight <= 2000)),
  rpe NUMERIC(3,1) CHECK (rpe IS NULL OR (rpe >= 1 AND rpe <= 10)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (exercise_log_id, set_number)
);

CREATE INDEX IF NOT EXISTS idx_set_logs_exercise_log
  ON set_logs(exercise_log_id);

COMMENT ON TABLE set_logs IS
  'Per-set actuals for a logged exercise. Standard 3-tier hierarchy: session_log -> exercise_log -> set_log.';

-- =============================================================================
-- 2. RLS — mirror the exercise_logs policies via the FK chain through
-- exercise_logs -> session_logs -> clients. Pattern matches migration 055.
-- =============================================================================

ALTER TABLE set_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clients_select_set_logs"
  ON set_logs FOR SELECT
  USING (
    exercise_log_id IN (
      SELECT id FROM exercise_logs
      WHERE session_log_id IN (
        SELECT id FROM session_logs
        WHERE client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
      )
    )
  );

CREATE POLICY "clients_insert_set_logs"
  ON set_logs FOR INSERT
  WITH CHECK (
    exercise_log_id IN (
      SELECT id FROM exercise_logs
      WHERE session_log_id IN (
        SELECT id FROM session_logs
        WHERE client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
      )
    )
  );

CREATE POLICY "clients_update_set_logs"
  ON set_logs FOR UPDATE
  USING (
    exercise_log_id IN (
      SELECT id FROM exercise_logs
      WHERE session_log_id IN (
        SELECT id FROM session_logs
        WHERE client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
      )
    )
  );

CREATE POLICY "clients_delete_set_logs"
  ON set_logs FOR DELETE
  USING (
    exercise_log_id IN (
      SELECT id FROM exercise_logs
      WHERE session_log_id IN (
        SELECT id FROM session_logs
        WHERE client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
      )
    )
  );

CREATE POLICY "coaches_view_client_set_logs"
  ON set_logs FOR SELECT
  USING (
    exercise_log_id IN (
      SELECT id FROM exercise_logs
      WHERE session_log_id IN (
        SELECT id FROM session_logs
        WHERE client_id IN (
          SELECT id FROM clients WHERE coach_id IN (
            SELECT id FROM coaches WHERE user_id = auth.uid()
          )
        )
      )
    )
  );

-- =============================================================================
-- 3. exercise_logs.exercise_id — global catalog FK.
-- Populated when the client picked an exercise from the typeahead picker.
-- NULL for prescribed exercises (use training_exercise_id -> training_exercises.exercise_id)
-- and for freehand unplanned entries that didn't match a catalog item.
-- =============================================================================

ALTER TABLE exercise_logs
  ADD COLUMN exercise_id UUID
    REFERENCES exercises(id) ON DELETE SET NULL;

COMMENT ON COLUMN exercise_logs.exercise_id IS
  'Optional FK to global exercises catalog. Populated when the client selected an exercise from the typeahead picker (Add unplanned, Swap). NULL for prescribed-without-swap and for freehand entries.';

-- =============================================================================
-- 4. exercise_logs.performed_name — what the client actually did.
-- Distinct from prescribed_exercise_snapshot.name (the prescription as captured
-- at log time). When the client swaps a prescribed exercise OR adds a freehand
-- unplanned one, performed_name holds the displayed/logged name. Coach drilldown
-- compares the two to surface "Prescribed X, Did Y".
-- =============================================================================

ALTER TABLE exercise_logs
  ADD COLUMN performed_name TEXT;

COMMENT ON COLUMN exercise_logs.performed_name IS
  'Name of the exercise the client actually performed. Differs from prescribed_exercise_snapshot.name when the client swapped a prescribed exercise or added a freehand unplanned one. NULL on legacy rows; new writes always populate.';

-- =============================================================================
-- 5. Drop the now-redundant scalar aggregates. set_logs is the source of truth.
-- =============================================================================

ALTER TABLE exercise_logs
  DROP COLUMN IF EXISTS actual_sets,
  DROP COLUMN IF EXISTS actual_reps,
  DROP COLUMN IF EXISTS actual_weight;
