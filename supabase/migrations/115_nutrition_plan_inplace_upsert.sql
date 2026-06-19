-- Migration 115: create_nutrition_plan_atomic -> single durable in-place upsert.
--
-- Events-as-SOT overhaul, Session 3 (Mig B). Nutrition collapses from a
-- versioned archive-and-replace model to ONE durable mutable plan per client.
-- This RPC stops minting a new row + archiving the old one on every save;
-- instead it UPSERTS the single active plan (the partial unique index
-- idx_nutrition_plans_active_unique is the conflict target) and REPLACES its
-- daily-target rows. The future/'planned' branch is removed entirely (the
-- planned model + its index are dropped in migration 116).
--
-- New arg p_recalc_snapshots BOOLEAN (default false): when true (explicit
-- "Recalculate plan" / fresh Generate recompute) the weight/goal banner
-- snapshot (base_weight_kg, goal_weight_kg, goal_deadline) is re-stamped; when
-- false (in-place edit, e.g. a preserve-calories regen) it is preserved so the
-- weight-drift + goal-drift banners stay accurate (spec section 9 / D5).
-- created_at + effective_from are NEVER re-stamped on update (first-insert
-- only), so the "active since {date}" banner stays stable even on a recalc.
--
-- Pure ASCII inside the $$ body (old supabase CLI splitter is byte-fragile).
-- SECURITY DEFINER + SET search_path = public + REVOKE/GRANT lockdown per
-- migrations 106/110.

-- Drop the live 27-arg overload (migration 110) by explicit signature before
-- recreating at the new 28-arg signature.
DROP FUNCTION IF EXISTS create_nutrition_plan_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, UUID, TEXT, TEXT, DATE, DATE);

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
  p_daily_targets JSONB,
  p_phase_id UUID DEFAULT NULL,
  p_coach_notes TEXT DEFAULT NULL,
  p_goal_source TEXT DEFAULT NULL,
  p_effective_from DATE DEFAULT NULL,
  p_today DATE DEFAULT NULL,
  p_recalc_snapshots BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- v_today first: DECLARE initializers evaluate in order.
  v_today DATE := COALESCE(p_today, CURRENT_DATE);
  v_effective_from DATE := COALESCE(p_effective_from, v_today);
  v_new_plan_id UUID;
  v_target JSONB;
BEGIN
  -- Upsert the single active plan. On first insert every column is stamped;
  -- on conflict (an active plan already exists) we update in place. Every one
  -- of the 26 insert columns lands in exactly one bucket:
  --   never-update (3): client_id (conflict key), status (stays 'active'),
  --     effective_from -- plus created_at (auto default, not listed) -> these
  --     are first-insert only and keep the "active since {date}" banner stable.
  --   case-on-recalc (3): base_weight_kg, goal_weight_kg, goal_deadline -- the
  --     ONLY banner-reference snapshot columns (spec section 9).
  --   always-update (20): every other prescriptive setting/target/macro, plus
  --     effective_until := NULL and updated_at := NOW().
  INSERT INTO nutrition_plans (
    client_id, coach_id, status, effective_from,
    work_activity_level, training_volume_hours, protein_target_g_per_kg,
    diet_type, goal_weight_kg, goal_deadline,
    baseline_calories, protein_target_g, carb_target_g, fat_target_g,
    base_weight_kg, bmr, tdee,
    custom_macros_enabled, custom_calories, custom_protein_g, custom_carb_g, custom_fat_g,
    regeneration_reason, phase_id, coach_notes, goal_source
  ) VALUES (
    p_client_id, p_coach_id, 'active', v_effective_from,
    p_work_activity_level, p_training_volume_hours, p_protein_target_g_per_kg,
    p_diet_type, p_goal_weight_kg, p_goal_deadline,
    p_baseline_calories, p_protein_target_g, p_carb_target_g, p_fat_target_g,
    p_base_weight_kg, p_bmr, p_tdee,
    p_custom_macros_enabled, p_custom_calories, p_custom_protein_g, p_custom_carb_g, p_custom_fat_g,
    p_regeneration_reason, p_phase_id, p_coach_notes, p_goal_source
  )
  ON CONFLICT (client_id) WHERE status = 'active'
  DO UPDATE SET
    -- always-update (20)
    coach_id = EXCLUDED.coach_id,
    work_activity_level = EXCLUDED.work_activity_level,
    training_volume_hours = EXCLUDED.training_volume_hours,
    protein_target_g_per_kg = EXCLUDED.protein_target_g_per_kg,
    diet_type = EXCLUDED.diet_type,
    baseline_calories = EXCLUDED.baseline_calories,
    protein_target_g = EXCLUDED.protein_target_g,
    carb_target_g = EXCLUDED.carb_target_g,
    fat_target_g = EXCLUDED.fat_target_g,
    bmr = EXCLUDED.bmr,
    tdee = EXCLUDED.tdee,
    custom_macros_enabled = EXCLUDED.custom_macros_enabled,
    custom_calories = EXCLUDED.custom_calories,
    custom_protein_g = EXCLUDED.custom_protein_g,
    custom_carb_g = EXCLUDED.custom_carb_g,
    custom_fat_g = EXCLUDED.custom_fat_g,
    regeneration_reason = EXCLUDED.regeneration_reason,
    phase_id = EXCLUDED.phase_id,
    coach_notes = EXCLUDED.coach_notes,
    goal_source = EXCLUDED.goal_source,
    effective_until = NULL,
    updated_at = NOW(),
    -- case-on-recalc (3): re-stamp the banner snapshot only on explicit recalc
    base_weight_kg = CASE WHEN p_recalc_snapshots THEN EXCLUDED.base_weight_kg ELSE nutrition_plans.base_weight_kg END,
    goal_weight_kg = CASE WHEN p_recalc_snapshots THEN EXCLUDED.goal_weight_kg ELSE nutrition_plans.goal_weight_kg END,
    goal_deadline  = CASE WHEN p_recalc_snapshots THEN EXCLUDED.goal_deadline  ELSE nutrition_plans.goal_deadline  END
    -- never-update: client_id, status, effective_from (and created_at) are omitted on purpose.
  RETURNING id INTO v_new_plan_id;

  -- Replace the plan's daily-target rows. DELETE-then-INSERT (a plain insert
  -- loop would collide on UNIQUE(nutrition_plan_id, day_of_week) on the 2nd save).
  DELETE FROM nutrition_plan_daily_targets WHERE nutrition_plan_id = v_new_plan_id;

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

-- Re-apply the migration 106 grant lockdown at the NEW 28-arg signature.
-- (Wrong arity here silently re-opens PUBLIC execute -- verify with \df post-push.)
REVOKE EXECUTE ON FUNCTION create_nutrition_plan_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, UUID, TEXT, TEXT, DATE, DATE, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_nutrition_plan_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, UUID, TEXT, TEXT, DATE, DATE, BOOLEAN) TO service_role;
