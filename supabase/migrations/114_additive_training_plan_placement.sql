-- =============================================================================
-- Migration 114: additive training plan placement.
--
-- WHY: create_training_plan_atomic (mig 110) treats training_plans as a wiping
-- singleton. Its STEP 0 deletes every scheduled event >= v_effective_from for
-- ALL active/planned plans, then archives the old active + planned plans, then
-- inserts the new one as 'active' or 'planned' by date. That makes a distinct
-- plan per phase impossible: placing a second (future) plan archives the first
-- and wipes its events. The events-as-SOT overhaul demotes training_plans to
-- coexisting provenance instances, so placement becomes ADDITIVE:
--
--   * Delete only the FUTURE scheduled events inside the INCOMING plan's own
--     window [v_effective_from, p_window_end] (never a cross-plan blanket
--     wipe). The service computes that window end (calculatePlacementEndDate,
--     now capped at the next coexisting plan's start) and passes it as
--     p_window_end. Non-overlapping plans coexist; an overlapping placement
--     wins only on its contested dates.
--   * Insert the new plan as 'active' with effective_until = NULL (reads become
--     date-driven in a later checkpoint and resolve off effective_from). No
--     archival of prior plans.
--
-- The freeze rule holds: status='scheduled' preserves completed/missed history,
-- and date >= GREATEST(v_effective_from, v_today) never touches the past.
--
-- DISCIPLINE (mig 110 template): the live signature is the 22-arg overload
-- (...UUID, DATE, UUID, DATE). Appending p_window_end yields a NEW 23-arg
-- signature, so the old overload must be DROPped by explicit signature (a bare
-- CREATE OR REPLACE would leave the 22-arg version live and PUBLIC-executable,
-- re-opening migration 106's lockdown). Re-apply 106's grant lockdown to the
-- new 23-arg signature. PURE ASCII inside the $$ body (supabase CLI v2.45.5
-- statement splitter desyncs on multi-byte UTF-8 in dollar-quoted bodies).
-- Only the training RPC changes here; the nutrition RPC is untouched.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Drop the current live (22-arg) overload by explicit signature.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS create_training_plan_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, UUID, DATE, UUID, DATE);

-- ---------------------------------------------------------------------------
-- 2) Recreate as additive: window-bounded delete + single active insert.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_training_plan_atomic(
  p_client_id UUID,
  p_coach_id UUID,
  p_name TEXT,
  p_description TEXT,
  p_coach_prompt TEXT,
  p_ai_response_raw TEXT,
  p_split_type TEXT,
  p_frequency_per_week INTEGER,
  p_program_duration_weeks INTEGER,
  p_client_weight_kg NUMERIC,
  p_client_body_fat_percentage NUMERIC,
  p_client_goal_weight_kg NUMERIC,
  p_client_tdee NUMERIC,
  p_avg_mood NUMERIC,
  p_avg_energy NUMERIC,
  p_avg_sleep NUMERIC,
  p_avg_stress NUMERIC,
  p_recent_adherence_percentage NUMERIC,
  p_phase_id UUID,
  p_effective_from DATE DEFAULT NULL,
  p_saved_plan_id UUID DEFAULT NULL,
  p_today DATE DEFAULT NULL,
  p_window_end DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- DECLARE initializers evaluate in order: v_today must come first so
  -- v_effective_from can default to it.
  v_today DATE := COALESCE(p_today, CURRENT_DATE);
  v_effective_from DATE := COALESCE(p_effective_from, v_today);
  v_new_plan_id UUID;
BEGIN
  -- Additive placement: clear ONLY the incoming plan's own future window so
  -- the freshly generated events have empty slots to land in (makes re-place
  -- idempotent and lets an overlapping placement win on its contested dates).
  -- No plan-status filter (the new plan id does not exist yet, and we want any
  -- prior occupant of these dates cleared), but status='scheduled' preserves
  -- completed/missed history and the GREATEST() floor preserves the past.
  -- Skip entirely when no window is supplied (pure additive, no surprise wipe).
  IF p_window_end IS NOT NULL THEN
    DELETE FROM training_events
    WHERE client_id = p_client_id
      AND status = 'scheduled'
      AND date >= GREATEST(v_effective_from, v_today)
      AND date <= p_window_end;
  END IF;

  -- Insert the new plan as provenance. Always 'active' (reads are date-driven
  -- off effective_from); effective_until stays NULL so coexisting plans are
  -- distinguished purely by effective_from ordering. No archival of prior plans.
  INSERT INTO training_plans (
    client_id, coach_id, name, description, status, effective_from,
    coach_prompt, ai_response_raw, split_type, frequency_per_week,
    program_duration_weeks, client_weight_kg, client_body_fat_percentage,
    client_goal_weight_kg, client_tdee,
    avg_mood, avg_energy, avg_sleep, avg_stress, recent_adherence_percentage,
    phase_id, saved_plan_id
  ) VALUES (
    p_client_id, p_coach_id, p_name, p_description, 'active', v_effective_from,
    p_coach_prompt, p_ai_response_raw, p_split_type, p_frequency_per_week,
    p_program_duration_weeks, p_client_weight_kg, p_client_body_fat_percentage,
    p_client_goal_weight_kg, p_client_tdee,
    p_avg_mood, p_avg_energy, p_avg_sleep, p_avg_stress, p_recent_adherence_percentage,
    p_phase_id, p_saved_plan_id
  )
  RETURNING id INTO v_new_plan_id;

  RETURN v_new_plan_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Re-apply migration 106's grant lockdown to the new 23-arg signature.
--    A fresh CREATE defaults EXECUTE to PUBLIC; only service_role may execute.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION create_training_plan_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, UUID, DATE, UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_training_plan_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, UUID, DATE, UUID, DATE, DATE) TO service_role;
