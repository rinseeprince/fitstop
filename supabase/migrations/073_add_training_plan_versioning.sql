-- Add date-effective versioning to training plans.
-- Mirrors the nutrition plan pattern (044 + 048) so we can answer
-- "what plan was active on date X?" for historical check-in snapshots.

-- =============================================================================
-- STEP 1: Schema changes
-- =============================================================================

ALTER TABLE training_plans ADD COLUMN effective_from DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE training_plans ADD COLUMN effective_until DATE;

-- =============================================================================
-- STEP 2: Backfill existing rows
-- =============================================================================

UPDATE training_plans SET effective_from = created_at::date;
UPDATE training_plans SET effective_until = updated_at::date WHERE status = 'archived';

-- =============================================================================
-- STEP 3: Index for date-range lookups
-- =============================================================================

CREATE INDEX idx_training_plans_date_range
  ON training_plans (client_id, effective_from, effective_until)
  WHERE deleted_at IS NULL;

-- =============================================================================
-- STEP 4: Atomic RPC — archive old plan + insert new plan in one transaction
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
  p_phase_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_yesterday DATE := CURRENT_DATE - 1;
  v_new_plan_id UUID;
BEGIN
  -- 1. Archive current active plan (if any)
  UPDATE training_plans
  SET status = 'archived',
      effective_until = v_yesterday,
      updated_at = NOW()
  WHERE client_id = p_client_id
    AND status = 'active';

  -- 2. Insert new active plan
  INSERT INTO training_plans (
    client_id, coach_id, name, description, status, effective_from,
    coach_prompt, ai_response_raw, split_type, frequency_per_week,
    program_duration_weeks, client_weight_kg, client_body_fat_percentage,
    client_goal_weight_kg, client_tdee,
    avg_mood, avg_energy, avg_sleep, avg_stress, recent_adherence_percentage,
    phase_id
  ) VALUES (
    p_client_id, p_coach_id, p_name, p_description, 'active', v_today,
    p_coach_prompt, p_ai_response_raw, p_split_type, p_frequency_per_week,
    p_program_duration_weeks, p_client_weight_kg, p_client_body_fat_percentage,
    p_client_goal_weight_kg, p_client_tdee,
    p_avg_mood, p_avg_energy, p_avg_sleep, p_avg_stress, p_recent_adherence_percentage,
    p_phase_id
  )
  RETURNING id INTO v_new_plan_id;

  RETURN v_new_plan_id;
END;
$$;
