-- =============================================================================
-- Migration 059: Add plan FKs to log children + remove redundant phase_id
-- =============================================================================

-- Add plan FKs to nutrition_logs and training_logs
ALTER TABLE nutrition_logs ADD COLUMN nutrition_plan_id UUID REFERENCES nutrition_plans(id) ON DELETE SET NULL;
ALTER TABLE training_logs ADD COLUMN training_plan_id UUID REFERENCES training_plans(id) ON DELETE SET NULL;

-- Remove redundant phase_id from child tables
-- Phase is reached via: nutrition_logs.nutrition_plan_id -> plan -> phase -> roadmap
-- Phase is reached via: training_logs.training_plan_id -> plan -> phase -> roadmap
-- Phase is reached via: wellness_logs.daily_log_id -> daily_logs.phase_id
ALTER TABLE wellness_logs DROP COLUMN IF EXISTS phase_id;
ALTER TABLE nutrition_logs DROP COLUMN IF EXISTS phase_id;
ALTER TABLE training_logs DROP COLUMN IF EXISTS phase_id;

-- Update the atomic RPC to accept plan IDs
CREATE OR REPLACE FUNCTION upsert_daily_log_atomic(
  p_client_id UUID,
  p_date DATE,
  p_notes TEXT,
  p_wellness JSONB,
  p_nutrition JSONB,
  p_training JSONB,
  p_nutrition_plan_id UUID DEFAULT NULL,
  p_training_plan_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_log_id UUID;
BEGIN
  -- 1. Upsert spine
  INSERT INTO daily_logs (client_id, date, notes, updated_at)
  VALUES (p_client_id, p_date, p_notes, NOW())
  ON CONFLICT (client_id, date)
  DO UPDATE SET
    notes = EXCLUDED.notes,
    updated_at = NOW()
  RETURNING id INTO v_log_id;

  -- 2. Upsert wellness (skip if NULL)
  IF p_wellness IS NOT NULL THEN
    INSERT INTO wellness_logs (daily_log_id, client_id, date, mood, energy, sleep, stress, updated_at)
    VALUES (
      v_log_id, p_client_id, p_date,
      (p_wellness->>'mood')::INTEGER,
      (p_wellness->>'energy')::INTEGER,
      (p_wellness->>'sleep')::INTEGER,
      (p_wellness->>'stress')::INTEGER,
      NOW()
    )
    ON CONFLICT (daily_log_id)
    DO UPDATE SET
      mood = EXCLUDED.mood,
      energy = EXCLUDED.energy,
      sleep = EXCLUDED.sleep,
      stress = EXCLUDED.stress,
      updated_at = NOW();
  END IF;

  -- 3. Upsert nutrition (skip if NULL)
  IF p_nutrition IS NOT NULL THEN
    INSERT INTO nutrition_logs (
      daily_log_id, client_id, date, nutrition_plan_id,
      calories_consumed, protein_g, carbs_g, fat_g,
      target_calories, target_protein_g, target_carbs_g, target_fat_g,
      nutrition_adherence, calorie_surplus_deficit, updated_at
    )
    VALUES (
      v_log_id, p_client_id, p_date, p_nutrition_plan_id,
      (p_nutrition->>'calories_consumed')::INTEGER,
      (p_nutrition->>'protein_g')::INTEGER,
      (p_nutrition->>'carbs_g')::INTEGER,
      (p_nutrition->>'fat_g')::INTEGER,
      (p_nutrition->>'target_calories')::INTEGER,
      (p_nutrition->>'target_protein_g')::INTEGER,
      (p_nutrition->>'target_carbs_g')::INTEGER,
      (p_nutrition->>'target_fat_g')::INTEGER,
      p_nutrition->>'nutrition_adherence',
      (p_nutrition->>'calorie_surplus_deficit')::INTEGER,
      NOW()
    )
    ON CONFLICT (daily_log_id)
    DO UPDATE SET
      nutrition_plan_id = COALESCE(p_nutrition_plan_id, nutrition_logs.nutrition_plan_id),
      calories_consumed = EXCLUDED.calories_consumed,
      protein_g = EXCLUDED.protein_g,
      carbs_g = EXCLUDED.carbs_g,
      fat_g = EXCLUDED.fat_g,
      target_calories = EXCLUDED.target_calories,
      target_protein_g = EXCLUDED.target_protein_g,
      target_carbs_g = EXCLUDED.target_carbs_g,
      target_fat_g = EXCLUDED.target_fat_g,
      nutrition_adherence = EXCLUDED.nutrition_adherence,
      calorie_surplus_deficit = EXCLUDED.calorie_surplus_deficit,
      updated_at = NOW();
  END IF;

  -- 4. Upsert training (skip if NULL)
  IF p_training IS NOT NULL THEN
    INSERT INTO training_logs (
      daily_log_id, client_id, date, training_plan_id,
      trained, training_session_id, training_data, updated_at
    )
    VALUES (
      v_log_id, p_client_id, p_date, p_training_plan_id,
      (p_training->>'trained')::BOOLEAN,
      NULLIF(p_training->>'training_session_id', '')::UUID,
      p_training->'training_data',
      NOW()
    )
    ON CONFLICT (daily_log_id)
    DO UPDATE SET
      training_plan_id = COALESCE(p_training_plan_id, training_logs.training_plan_id),
      trained = EXCLUDED.trained,
      training_session_id = EXCLUDED.training_session_id,
      training_data = EXCLUDED.training_data,
      updated_at = NOW();
  END IF;

  RETURN v_log_id;
END;
$$;
