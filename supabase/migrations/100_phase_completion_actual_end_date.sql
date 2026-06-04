-- =============================================================================
-- Migration 100: Phase completion records the ACTUAL end date
--
-- transition_phase_atomic (migration 067) completed a phase with
--   end_date = COALESCE(end_date, CURRENT_DATE)
-- which PRESERVED a phase's planned end_date when it had one. Completing a phase
-- early/late therefore showed the *planned* end on the completed card, while the
-- next phase's start_date is set to CURRENT_DATE (the actual date) — an obvious
-- inconsistency for a coach reviewing history.
--
-- Fix: a completed phase's end_date is the date it actually finished
-- (CURRENT_DATE). Everything else is byte-for-byte identical to 067.
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
  -- 1. Complete the phase — end_date is the ACTUAL completion date.
  UPDATE phases
  SET status = 'completed',
      end_date = CURRENT_DATE,
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
