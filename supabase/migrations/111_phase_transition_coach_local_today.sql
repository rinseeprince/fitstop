-- =============================================================================
-- Migration 111: transition_phase_atomic stamps phase dates in the COACH's
-- local day, not server UTC.
--
-- Migration 100's body stamps the completed phase's end_date = CURRENT_DATE
-- and the activated next phase's start_date = COALESCE(start_date,
-- CURRENT_DATE) on the server clock. An ahead-of-UTC coach completing a phase
-- just after local midnight gets it dated yesterday - mismatching the review
-- window the transition route already resolves in coach-local time
-- (getCoachTodayString) for the preview. Fix: a trailing p_today DATE DEFAULT
-- NULL parameter (the mig-110 pattern); the service passes the same
-- coach-local today the route threads into the review, and CURRENT_DATE
-- remains only as a defensive fallback.
--
-- STRUCTURE (3 parts, per migration 110):
--   1) DROP the live overload by EXPLICIT signature. Adding a parameter via a
--      bare CREATE OR REPLACE would mint a second PUBLIC-executable overload,
--      silently re-opening the hole migration 106 closed. Exactly one live
--      overload exists: 067 created it and 100 CREATE OR REPLACE'd the same
--      signature in place. IF EXISTS keeps a re-run after a partially applied
--      first push safe.
--   2) CREATE the new definition: migration 100's body byte-for-byte except
--      the p_today plumbing and the two stamp sites, with
--      SET search_path = public pinned in the header (106 applied it via
--      ALTER FUNCTION, which died with the DROP above). Comments inside the
--      $$ body are ASCII-only (see 110's note on the CLI statement splitter).
--   3) Re-apply 106's grant lockdown to the new signature - a fresh CREATE
--      defaults EXECUTE to PUBLIC. Only service_role (supabaseAdmin) may
--      execute.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Drop the live overload (and the target signature, for re-run safety).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS transition_phase_atomic(UUID, TEXT, JSONB, TEXT, BOOLEAN, BOOLEAN, BOOLEAN);
DROP FUNCTION IF EXISTS transition_phase_atomic(UUID, TEXT, JSONB, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, DATE);

-- ---------------------------------------------------------------------------
-- 2) Recreate with p_today - migration 100's body + the coach-local anchor.
-- ---------------------------------------------------------------------------
CREATE FUNCTION transition_phase_atomic(
  p_phase_id UUID,
  p_coach_reflection TEXT,
  p_phase_summary JSONB,
  p_next_action TEXT,         -- 'activate_next' | 'archive_roadmap'
  p_archive_training BOOLEAN,
  p_archive_nutrition BOOLEAN,
  p_archive_habits BOOLEAN,
  p_today DATE DEFAULT NULL   -- coach-local today; NULL falls back to server UTC
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_roadmap_id UUID;
  v_next_phase_id UUID;
  v_today DATE := COALESCE(p_today, CURRENT_DATE);
BEGIN
  -- 1. Complete the phase - end_date is the ACTUAL completion date
  --    (coach-local when the caller supplies p_today).
  UPDATE phases
  SET status = 'completed',
      end_date = v_today,
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
      UPDATE phases SET status = 'active', start_date = COALESCE(start_date, v_today), updated_at = NOW()
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

-- ---------------------------------------------------------------------------
-- 3) Re-apply migration 106's grant lockdown to the new signature.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION transition_phase_atomic(UUID, TEXT, JSONB, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION transition_phase_atomic(UUID, TEXT, JSONB, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, DATE) TO service_role;
