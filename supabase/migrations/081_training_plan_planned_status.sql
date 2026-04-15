-- =============================================================================
-- Migration 081: Add planned status to training plans + update RPC.
-- Mirrors nutrition plan planned status (080) so future-dated training plan
-- regeneration creates a 'planned' plan while leaving the active plan untouched.
-- =============================================================================

-- STEP 1: Add 'planned' to the CHECK constraint
ALTER TABLE training_plans DROP CONSTRAINT IF EXISTS training_plans_status_check;
ALTER TABLE training_plans ADD CONSTRAINT training_plans_status_check
  CHECK (status IN ('active', 'archived', 'draft', 'planned'));

-- STEP 2: Update RPC to branch on effective_from date
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
  p_effective_from DATE DEFAULT CURRENT_DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_effective_from DATE := COALESCE(p_effective_from, CURRENT_DATE);
  v_new_plan_id UUID;
BEGIN
  IF v_effective_from > CURRENT_DATE THEN
    -- =======================================================================
    -- FUTURE DATE: insert as 'planned', leave active plan untouched
    -- =======================================================================

    -- Archive any existing planned plan (only one planned per client)
    UPDATE training_plans
    SET status = 'archived',
        effective_until = v_effective_from - 1,
        updated_at = NOW()
    WHERE client_id = p_client_id
      AND status = 'planned';

    -- Insert new plan as planned
    INSERT INTO training_plans (
      client_id, coach_id, name, description, status, effective_from,
      coach_prompt, ai_response_raw, split_type, frequency_per_week,
      program_duration_weeks, client_weight_kg, client_body_fat_percentage,
      client_goal_weight_kg, client_tdee,
      avg_mood, avg_energy, avg_sleep, avg_stress, recent_adherence_percentage,
      phase_id
    ) VALUES (
      p_client_id, p_coach_id, p_name, p_description, 'planned', v_effective_from,
      p_coach_prompt, p_ai_response_raw, p_split_type, p_frequency_per_week,
      p_program_duration_weeks, p_client_weight_kg, p_client_body_fat_percentage,
      p_client_goal_weight_kg, p_client_tdee,
      p_avg_mood, p_avg_energy, p_avg_sleep, p_avg_stress, p_recent_adherence_percentage,
      p_phase_id
    )
    RETURNING id INTO v_new_plan_id;

  ELSE
    -- =======================================================================
    -- TODAY OR PAST: archive active + any orphaned planned, insert as 'active'
    -- =======================================================================

    -- Archive current active plan
    UPDATE training_plans
    SET status = 'archived',
        effective_until = v_effective_from - 1,
        updated_at = NOW()
    WHERE client_id = p_client_id
      AND status = 'active';

    -- Clean up any orphaned planned plan
    UPDATE training_plans
    SET status = 'archived',
        effective_until = v_effective_from - 1,
        updated_at = NOW()
    WHERE client_id = p_client_id
      AND status = 'planned';

    -- Insert new plan as active
    INSERT INTO training_plans (
      client_id, coach_id, name, description, status, effective_from,
      coach_prompt, ai_response_raw, split_type, frequency_per_week,
      program_duration_weeks, client_weight_kg, client_body_fat_percentage,
      client_goal_weight_kg, client_tdee,
      avg_mood, avg_energy, avg_sleep, avg_stress, recent_adherence_percentage,
      phase_id
    ) VALUES (
      p_client_id, p_coach_id, p_name, p_description, 'active', v_effective_from,
      p_coach_prompt, p_ai_response_raw, p_split_type, p_frequency_per_week,
      p_program_duration_weeks, p_client_weight_kg, p_client_body_fat_percentage,
      p_client_goal_weight_kg, p_client_tdee,
      p_avg_mood, p_avg_energy, p_avg_sleep, p_avg_stress, p_recent_adherence_percentage,
      p_phase_id
    )
    RETURNING id INTO v_new_plan_id;

  END IF;

  RETURN v_new_plan_id;
END;
$$;
