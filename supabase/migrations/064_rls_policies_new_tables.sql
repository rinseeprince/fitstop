-- =============================================================================
-- Migration 064: RLS policies for new tables
-- Tables covered: client_goals, body_metrics, roadmaps, phases
--
-- Pattern: coaches can read their clients' data, clients can read their own.
-- Writes go through supabaseAdmin (service role bypass), so no
-- INSERT/UPDATE/DELETE policies are needed.
-- =============================================================================

-- =============================================================================
-- 1. client_goals
-- =============================================================================

CREATE POLICY "coaches_view_client_goals" ON client_goals
  FOR SELECT USING (
    client_id IN (
      SELECT id FROM clients
      WHERE coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "clients_view_own_goals" ON client_goals
  FOR SELECT USING (
    client_id IN (
      SELECT id FROM clients WHERE user_id = auth.uid()
    )
  );

-- =============================================================================
-- 2. body_metrics
-- =============================================================================

CREATE POLICY "coaches_view_client_body_metrics" ON body_metrics
  FOR SELECT USING (
    client_id IN (
      SELECT id FROM clients
      WHERE coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "clients_view_own_body_metrics" ON body_metrics
  FOR SELECT USING (
    client_id IN (
      SELECT id FROM clients WHERE user_id = auth.uid()
    )
  );

-- =============================================================================
-- 3. roadmaps
-- =============================================================================

CREATE POLICY "coaches_view_client_roadmaps" ON roadmaps
  FOR SELECT USING (
    client_id IN (
      SELECT id FROM clients
      WHERE coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "clients_view_own_roadmaps" ON roadmaps
  FOR SELECT USING (
    client_id IN (
      SELECT id FROM clients WHERE user_id = auth.uid()
    )
  );

-- =============================================================================
-- 4. phases
-- =============================================================================

CREATE POLICY "coaches_view_client_phases" ON phases
  FOR SELECT USING (
    client_id IN (
      SELECT id FROM clients
      WHERE coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "clients_view_own_phases" ON phases
  FOR SELECT USING (
    client_id IN (
      SELECT id FROM clients WHERE user_id = auth.uid()
    )
  );
