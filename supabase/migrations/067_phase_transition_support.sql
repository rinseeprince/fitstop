-- =============================================================================
-- Migration 067: Phase transition support
-- Adds columns for phase completion data and an atomic transition RPC.
-- Pattern follows upsert_daily_log_atomic from migration 057.
-- =============================================================================

-- New columns on phases for transition data
ALTER TABLE phases ADD COLUMN coach_reflection TEXT;
ALTER TABLE phases ADD COLUMN phase_summary JSONB;
ALTER TABLE phases ADD COLUMN completion_seen BOOLEAN NOT NULL DEFAULT false;

-- Composite index for session_logs date range queries (used by getPhaseReviewData)
-- nutrition_logs and daily_habit_logs already have (client_id, date) indexes
-- session_logs uses completed_at (not date) for when the session was done
CREATE INDEX IF NOT EXISTS idx_session_logs_client_completed ON session_logs(client_id, completed_at DESC);

-- =============================================================================
-- Atomic phase transition RPC
-- Completes a phase, optionally archives linked plans, and activates the next
-- phase or archives the roadmap - all in a single transaction.
-- Uses SECURITY DEFINER: system-level atomic write (RLS exception 3)
-- =============================================================================

CREATE OR REPLACE FUNCTION transition_phase_atomic(
  p_phase_id UUID,
  p_coach_reflection TEXT,
  p_phase_summary JSONB,
  p_next_action TEXT,         -- 'activate_next' | 'archive_roadmap'
  p_archive_training BOOLEAN,
  p_archive_nutrition BOOLEAN,
  p_archive_habits BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_roadmap_id UUID;
  v_next_phase_id UUID;
BEGIN
  -- 1. Complete the phase
  UPDATE phases
  SET status = 'completed',
      end_date = COALESCE(end_date, CURRENT_DATE),
      coach_reflection = p_coach_reflection,
      phase_summary = p_phase_summary,
      updated_at = NOW()
  WHERE id = p_phase_id
  RETURNING roadmap_id INTO v_roadmap_id;

  IF v_roadmap_id IS NULL THEN
    RAISE EXCEPTION 'Phase not found: %', p_phase_id;
  END IF;

  -- 2. Archive plans if requested
  IF p_archive_training THEN
    UPDATE training_plans SET status = 'archived', updated_at = NOW()
      WHERE phase_id = p_phase_id AND status = 'active';
  END IF;
  IF p_archive_nutrition THEN
    UPDATE nutrition_plans SET status = 'archived', updated_at = NOW()
      WHERE phase_id = p_phase_id AND status = 'active';
  END IF;
  IF p_archive_habits THEN
    UPDATE daily_habits SET is_active = false, updated_at = NOW()
      WHERE phase_id = p_phase_id AND is_active = true;
  END IF;

  -- 3. Handle next action
  IF p_next_action = 'activate_next' THEN
    SELECT id INTO v_next_phase_id FROM phases
      WHERE roadmap_id = v_roadmap_id AND status = 'planned'
      ORDER BY order_index ASC LIMIT 1;
    IF v_next_phase_id IS NOT NULL THEN
      UPDATE phases SET status = 'active', start_date = COALESCE(start_date, CURRENT_DATE), updated_at = NOW()
        WHERE id = v_next_phase_id;
    END IF;
  ELSIF p_next_action = 'archive_roadmap' THEN
    UPDATE phases SET status = 'skipped', updated_at = NOW()
      WHERE roadmap_id = v_roadmap_id AND status = 'planned';
    UPDATE roadmaps SET status = 'archived', updated_at = NOW()
      WHERE id = v_roadmap_id;
  END IF;

  -- 4. Write nextPhaseId into the summary JSONB (the RPC knows it, the caller does not)
  IF v_next_phase_id IS NOT NULL THEN
    UPDATE phases SET phase_summary = jsonb_set(phase_summary, '{nextPhaseId}', to_jsonb(v_next_phase_id::TEXT))
      WHERE id = p_phase_id;
  END IF;

  RETURN COALESCE(v_next_phase_id, p_phase_id);
END;
$$;
