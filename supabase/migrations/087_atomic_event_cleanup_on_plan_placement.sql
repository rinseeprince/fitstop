-- =============================================================================
-- Migration 087: Move event cleanup into create_training_plan_atomic so plan
-- archival and event deletion happen in a single transaction.
--
-- Before: the RPC archived existing active/planned plans but left their future
-- events behind. library-placement-service.ts then cleaned them up in a
-- separate round trip. If any caller skipped that step — or if a second
-- 'planned' plan was applied before the first one was archived — events were
-- orphaned and the calendar double-booked.
--
-- After: the RPC deletes scheduled events from v_effective_from onward for
-- every currently active or planned plan belonging to this client, then
-- archives those plans and inserts the new one. Completed/missed/partial
-- events are preserved (filtered by status='scheduled'). Past events are
-- preserved (date >= v_effective_from). The service layer keeps its
-- deleteFutureEventsForPlan calls as defence-in-depth — they become no-ops
-- after this migration, but guard against future RPC changes regressing the
-- invariant.
-- =============================================================================

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
  p_effective_from DATE DEFAULT CURRENT_DATE,
  p_saved_plan_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_effective_from DATE := COALESCE(p_effective_from, CURRENT_DATE);
  v_new_plan_id UUID;
BEGIN
  -- STEP 0: Delete scheduled events for any currently active or planned plan
  -- from v_effective_from onward. Runs BEFORE archival so we can still
  -- identify plans by their live status.
  DELETE FROM training_events
  WHERE client_id = p_client_id
    AND status = 'scheduled'
    AND date >= v_effective_from
    AND training_plan_id IN (
      SELECT id FROM training_plans
      WHERE client_id = p_client_id
        AND status IN ('active', 'planned')
    );

  IF v_effective_from > CURRENT_DATE THEN
    -- =======================================================================
    -- FUTURE DATE: insert as 'planned', leave active plan untouched.
    -- =======================================================================

    -- Archive any existing planned plan (only one planned per client).
    UPDATE training_plans
    SET status = 'archived',
        effective_until = v_effective_from - 1,
        updated_at = NOW()
    WHERE client_id = p_client_id
      AND status = 'planned';

    -- Insert new plan as planned.
    INSERT INTO training_plans (
      client_id, coach_id, name, description, status, effective_from,
      coach_prompt, ai_response_raw, split_type, frequency_per_week,
      program_duration_weeks, client_weight_kg, client_body_fat_percentage,
      client_goal_weight_kg, client_tdee,
      avg_mood, avg_energy, avg_sleep, avg_stress, recent_adherence_percentage,
      phase_id, saved_plan_id
    ) VALUES (
      p_client_id, p_coach_id, p_name, p_description, 'planned', v_effective_from,
      p_coach_prompt, p_ai_response_raw, p_split_type, p_frequency_per_week,
      p_program_duration_weeks, p_client_weight_kg, p_client_body_fat_percentage,
      p_client_goal_weight_kg, p_client_tdee,
      p_avg_mood, p_avg_energy, p_avg_sleep, p_avg_stress, p_recent_adherence_percentage,
      p_phase_id, p_saved_plan_id
    )
    RETURNING id INTO v_new_plan_id;

  ELSE
    -- =======================================================================
    -- TODAY OR PAST: archive active + any planned, insert as 'active'.
    -- =======================================================================

    -- Archive current active plan.
    UPDATE training_plans
    SET status = 'archived',
        effective_until = v_effective_from - 1,
        updated_at = NOW()
    WHERE client_id = p_client_id
      AND status = 'active';

    -- Archive any planned plan too — the new active replaces both.
    UPDATE training_plans
    SET status = 'archived',
        effective_until = v_effective_from - 1,
        updated_at = NOW()
    WHERE client_id = p_client_id
      AND status = 'planned';

    -- Insert new plan as active.
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

  END IF;

  RETURN v_new_plan_id;
END;
$$;
