-- Client Portal RLS Policies
-- Allow clients to read their own data (training plans, check-ins, nutrition)
-- Clients are identified by auth.uid() = user_id in the clients table

-- =============================================================================
-- TRAINING PLANS: Clients can view their own plans
-- =============================================================================

CREATE POLICY "clients_view_own_training_plans"
  ON training_plans FOR SELECT
  USING (
    client_id IN (
      SELECT id FROM clients WHERE user_id = auth.uid()
    )
  );

-- =============================================================================
-- TRAINING SESSIONS: Clients can view sessions from their plans
-- =============================================================================

CREATE POLICY "clients_view_own_training_sessions"
  ON training_sessions FOR SELECT
  USING (
    plan_id IN (
      SELECT id FROM training_plans
      WHERE client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
    )
  );

-- =============================================================================
-- TRAINING EXERCISES: Clients can view exercises from their sessions
-- =============================================================================

CREATE POLICY "clients_view_own_training_exercises"
  ON training_exercises FOR SELECT
  USING (
    session_id IN (
      SELECT id FROM training_sessions
      WHERE plan_id IN (
        SELECT id FROM training_plans
        WHERE client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
      )
    )
  );

-- =============================================================================
-- TRAINING PLAN HISTORY: Clients can view their plan history
-- =============================================================================

CREATE POLICY "clients_view_own_training_plan_history"
  ON training_plan_history FOR SELECT
  USING (
    client_id IN (
      SELECT id FROM clients WHERE user_id = auth.uid()
    )
  );

-- =============================================================================
-- CHECK-INS: Clients can view and insert their own check-ins
-- =============================================================================

CREATE POLICY "clients_view_own_check_ins"
  ON check_ins FOR SELECT
  USING (
    client_id IN (
      SELECT id FROM clients WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "clients_insert_own_check_ins"
  ON check_ins FOR INSERT
  WITH CHECK (
    client_id IN (
      SELECT id FROM clients WHERE user_id = auth.uid()
    )
  );

-- =============================================================================
-- NUTRITION PLAN HISTORY: Clients can view their own nutrition history
-- =============================================================================

CREATE POLICY "clients_view_own_nutrition_history"
  ON nutrition_plan_history FOR SELECT
  USING (
    client_id IN (
      SELECT id FROM clients WHERE user_id = auth.uid()
    )
  );

-- =============================================================================
-- CHECK-IN SESSION COMPLETIONS: Clients can view and insert
-- =============================================================================

CREATE POLICY "clients_view_own_session_completions"
  ON check_in_session_completions FOR SELECT
  USING (
    check_in_id IN (
      SELECT id FROM check_ins
      WHERE client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "clients_insert_session_completions"
  ON check_in_session_completions FOR INSERT
  WITH CHECK (
    check_in_id IN (
      SELECT id FROM check_ins
      WHERE client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
    )
  );

-- =============================================================================
-- CHECK-IN EXERCISE HIGHLIGHTS: Clients can view and insert
-- =============================================================================

CREATE POLICY "clients_view_own_exercise_highlights"
  ON check_in_exercise_highlights FOR SELECT
  USING (
    check_in_id IN (
      SELECT id FROM check_ins
      WHERE client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "clients_insert_exercise_highlights"
  ON check_in_exercise_highlights FOR INSERT
  WITH CHECK (
    check_in_id IN (
      SELECT id FROM check_ins
      WHERE client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
    )
  );

-- =============================================================================
-- CHECK-IN EXTERNAL ACTIVITIES: Clients can view and insert
-- =============================================================================

CREATE POLICY "clients_view_own_external_activities"
  ON check_in_external_activities FOR SELECT
  USING (
    check_in_id IN (
      SELECT id FROM check_ins
      WHERE client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "clients_insert_external_activities"
  ON check_in_external_activities FOR INSERT
  WITH CHECK (
    check_in_id IN (
      SELECT id FROM check_ins
      WHERE client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
    )
  );
