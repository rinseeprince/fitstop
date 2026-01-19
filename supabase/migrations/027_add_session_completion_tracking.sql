-- Session Completion Tracking
-- Track training session/exercise completions in real-time (separate from check-ins)
-- This allows clients to mark sessions done throughout the week

-- =============================================================================
-- CLIENT SESSION COMPLETIONS: Track when a client completes a training session
-- =============================================================================

CREATE TABLE IF NOT EXISTS client_session_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  training_session_id UUID NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completion_quality TEXT DEFAULT 'full' CHECK (completion_quality IN ('full', 'partial', 'skipped')),
  notes TEXT,
  week_start_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(client_id, training_session_id, week_start_date)
);

-- =============================================================================
-- CLIENT EXERCISE COMPLETIONS: Track individual exercise completions
-- =============================================================================

CREATE TABLE IF NOT EXISTS client_exercise_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_completion_id UUID NOT NULL REFERENCES client_session_completions(id) ON DELETE CASCADE,
  training_exercise_id UUID NOT NULL REFERENCES training_exercises(id) ON DELETE CASCADE,
  completed BOOLEAN DEFAULT FALSE,
  actual_sets INTEGER,
  actual_reps TEXT,
  actual_weight NUMERIC(6,2),
  weight_unit TEXT DEFAULT 'lbs' CHECK (weight_unit IN ('lbs', 'kg')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(session_completion_id, training_exercise_id)
);

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX idx_client_session_completions_client
  ON client_session_completions(client_id, week_start_date DESC);
CREATE INDEX idx_client_session_completions_session
  ON client_session_completions(training_session_id);
CREATE INDEX idx_client_exercise_completions_session
  ON client_exercise_completions(session_completion_id);

-- =============================================================================
-- ENABLE RLS
-- =============================================================================

ALTER TABLE client_session_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_exercise_completions ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- CLIENT SESSION COMPLETIONS RLS POLICIES
-- =============================================================================

-- Clients can view their own session completions
CREATE POLICY "clients_view_own_session_completions"
  ON client_session_completions FOR SELECT
  USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

-- Clients can create their own session completions
CREATE POLICY "clients_insert_session_completions"
  ON client_session_completions FOR INSERT
  WITH CHECK (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

-- Clients can update their own session completions
CREATE POLICY "clients_update_session_completions"
  ON client_session_completions FOR UPDATE
  USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

-- Clients can delete their own session completions
CREATE POLICY "clients_delete_session_completions"
  ON client_session_completions FOR DELETE
  USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

-- Coaches can view their clients' session completions
CREATE POLICY "coaches_view_client_session_completions"
  ON client_session_completions FOR SELECT
  USING (
    client_id IN (
      SELECT id FROM clients WHERE coach_id IN (
        SELECT id FROM coaches WHERE user_id = auth.uid()
      )
    )
  );

-- =============================================================================
-- CLIENT EXERCISE COMPLETIONS RLS POLICIES
-- =============================================================================

-- Clients can manage their own exercise completions
CREATE POLICY "clients_select_exercise_completions"
  ON client_exercise_completions FOR SELECT
  USING (
    session_completion_id IN (
      SELECT id FROM client_session_completions
      WHERE client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "clients_insert_exercise_completions"
  ON client_exercise_completions FOR INSERT
  WITH CHECK (
    session_completion_id IN (
      SELECT id FROM client_session_completions
      WHERE client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "clients_update_exercise_completions"
  ON client_exercise_completions FOR UPDATE
  USING (
    session_completion_id IN (
      SELECT id FROM client_session_completions
      WHERE client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "clients_delete_exercise_completions"
  ON client_exercise_completions FOR DELETE
  USING (
    session_completion_id IN (
      SELECT id FROM client_session_completions
      WHERE client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
    )
  );

-- Coaches can view their clients' exercise completions
CREATE POLICY "coaches_view_client_exercise_completions"
  ON client_exercise_completions FOR SELECT
  USING (
    session_completion_id IN (
      SELECT id FROM client_session_completions
      WHERE client_id IN (
        SELECT id FROM clients WHERE coach_id IN (
          SELECT id FROM coaches WHERE user_id = auth.uid()
        )
      )
    )
  );

-- =============================================================================
-- UPDATED_AT TRIGGERS
-- =============================================================================

CREATE TRIGGER client_session_completions_updated_at
  BEFORE UPDATE ON client_session_completions
  FOR EACH ROW
  EXECUTE FUNCTION update_training_plan_updated_at();

CREATE TRIGGER client_exercise_completions_updated_at
  BEFORE UPDATE ON client_exercise_completions
  FOR EACH ROW
  EXECUTE FUNCTION update_training_plan_updated_at();
