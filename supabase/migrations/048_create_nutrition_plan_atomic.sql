-- Atomic nutrition plan creation: archive old plan + insert new plan + insert
-- daily targets in a single transaction to prevent orphaned state.

CREATE OR REPLACE FUNCTION create_nutrition_plan_atomic(
  p_client_id UUID,
  p_coach_id UUID,
  p_work_activity_level TEXT,
  p_training_volume_hours TEXT,
  p_protein_target_g_per_kg NUMERIC,
  p_diet_type TEXT,
  p_goal_weight_kg NUMERIC,
  p_goal_deadline DATE,
  p_baseline_calories INTEGER,
  p_protein_target_g NUMERIC,
  p_carb_target_g NUMERIC,
  p_fat_target_g NUMERIC,
  p_base_weight_kg NUMERIC,
  p_bmr NUMERIC,
  p_tdee NUMERIC,
  p_custom_macros_enabled BOOLEAN,
  p_custom_calories NUMERIC,
  p_custom_protein_g NUMERIC,
  p_custom_carb_g NUMERIC,
  p_custom_fat_g NUMERIC,
  p_regeneration_reason TEXT,
  p_daily_targets JSONB  -- array of { day_of_week, calories, protein_g, carb_g, fat_g, is_training_day }
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_yesterday DATE := CURRENT_DATE - 1;
  v_new_plan_id UUID;
  v_target JSONB;
BEGIN
  -- 1. Archive current active plan (if any)
  UPDATE nutrition_plans
  SET status = 'archived',
      effective_until = v_yesterday,
      updated_at = NOW()
  WHERE client_id = p_client_id
    AND status = 'active';

  -- 2. Insert new active plan
  INSERT INTO nutrition_plans (
    client_id, coach_id, status, effective_from,
    work_activity_level, training_volume_hours, protein_target_g_per_kg,
    diet_type, goal_weight_kg, goal_deadline,
    baseline_calories, protein_target_g, carb_target_g, fat_target_g,
    base_weight_kg, bmr, tdee,
    custom_macros_enabled, custom_calories, custom_protein_g, custom_carb_g, custom_fat_g,
    regeneration_reason
  ) VALUES (
    p_client_id, p_coach_id, 'active', v_today,
    p_work_activity_level, p_training_volume_hours, p_protein_target_g_per_kg,
    p_diet_type, p_goal_weight_kg, p_goal_deadline,
    p_baseline_calories, p_protein_target_g, p_carb_target_g, p_fat_target_g,
    p_base_weight_kg, p_bmr, p_tdee,
    p_custom_macros_enabled, p_custom_calories, p_custom_protein_g, p_custom_carb_g, p_custom_fat_g,
    p_regeneration_reason
  )
  RETURNING id INTO v_new_plan_id;

  -- 3. Insert daily target rows from JSONB array
  FOR v_target IN SELECT * FROM jsonb_array_elements(p_daily_targets)
  LOOP
    INSERT INTO nutrition_plan_daily_targets (
      nutrition_plan_id, day_of_week, calories, protein_g, carb_g, fat_g, is_training_day
    ) VALUES (
      v_new_plan_id,
      v_target->>'day_of_week',
      (v_target->>'calories')::INTEGER,
      (v_target->>'protein_g')::NUMERIC,
      (v_target->>'carb_g')::NUMERIC,
      (v_target->>'fat_g')::NUMERIC,
      (v_target->>'is_training_day')::BOOLEAN
    );
  END LOOP;

  RETURN v_new_plan_id;
END;
$$;
