-- =============================================================================
-- effective_from advances on the conflict path of create_nutrition_plan_atomic.
--
-- WHY: the column stops meaning "when this plan row was born" and starts
-- meaning "when the current numbers took effect" -- which is what both hero
-- branches already assume. Under 139, a future p_effective_from was transmitted,
-- accepted by the route (only past dates are rejected), and silently discarded
-- on the conflict path while every target column overwrote immediately: the
-- plan-level template was future-dated in intent and present-tense in storage,
-- scheduledFor could never be non-null for an existing plan, and the hero read
-- "Active since <original creation date>" forever. The plan's true birth date
-- lives in created_at, which this function never touches.
--
-- Accepted behaviour change: regenerating today makes the hero read "Active
-- since today". That is true -- the numbers changed today.
--
-- HOW: CREATE OR REPLACE at the IDENTICAL 24-arg signature -- a body swap, no
-- new overload, no arity trap. One line is added to the DO UPDATE SET
-- (effective_from = EXCLUDED.effective_from); everything else is verbatim from
-- migration 139.
--
-- Deliberately ABSENT, with reasons:
--   * No DROP FUNCTION -- same signature, so OR REPLACE swaps in place. A DROP
--     would discard the ACL and force a re-grant.
--   * No REVOKE/GRANT re-apply -- a same-signature CREATE OR REPLACE preserves
--     ownership and privileges (unlike 139, which DROPPED the 26-arg overload
--     and had to re-apply the mig-106 lockdown at the new arity). Verified
--     against the live catalog before this migration was written
--     (acl = {postgres=X/postgres,service_role=X/postgres}) and must be
--     re-verified after push: prosecdef, proconfig, proacl, and exactly ONE
--     pg_proc row. CREATE OR REPLACE is a TOTAL redefinition otherwise --
--     omitting SECURITY DEFINER or SET search_path here would silently drop
--     them with no error at push time, so both are restated below.
--
-- Bucket bookkeeping, stated in BOTH universes because two prior documents
-- counted different ones and both were right:
--   * Over the 23 explicit INSERT columns (139's framing): never-update shrinks
--     from {client_id, status, effective_from} to {client_id, status} -- plus
--     created_at, auto-default, not listed. Always-update grows 20 -> 21, plus
--     effective_until := NULL and updated_at := NOW() (not insert-list columns).
--   * Over all 28 table columns (the execution plan's framing): untouched on
--     conflict shrinks from {id, client_id, name, status, effective_from,
--     created_at} to {id, client_id, name, status, created_at}. id and name are
--     additionally absent from the INSERT itself -- id is minted by the column
--     default on first insert; name has no writer anywhere in the app.
--
-- Pure ASCII inside the $$ body (the old supabase CLI splitter is byte-fragile).
-- =============================================================================

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
  p_effective_from DATE DEFAULT NULL,
  p_today DATE DEFAULT NULL
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
  -- of the 23 insert columns lands in exactly one bucket:
  --   never-update (2): client_id (conflict key), status (stays 'active') --
  --     plus created_at (auto default, not listed) -> first-insert only, so the
  --     row keeps its true birth date.
  --   always-update (21): every other prescriptive setting/target/macro,
  --     the three banner-snapshot columns (base_weight_kg, goal_weight_kg,
  --     goal_deadline), and -- since migration 143 -- effective_from, plus
  --     effective_until := NULL and updated_at := NOW().
  --
  -- effective_from moved buckets in 143: it now means "when the current numbers
  -- took effect", advancing on every conflict-path upsert so a future-dated
  -- regenerate is stored as future-dated ("Starts <date>") and a same-day
  -- regenerate truthfully reads "Active since today". The birth date is
  -- created_at. (id and name are in neither bucket: absent from this INSERT
  -- entirely -- id by column default, name written by nothing.)
  INSERT INTO nutrition_plans (
    client_id, coach_id, status, effective_from,
    work_activity_level, training_volume_hours, protein_target_g_per_kg,
    diet_type, goal_weight_kg, goal_deadline,
    baseline_calories, protein_target_g, carb_target_g, fat_target_g,
    base_weight_kg, bmr, tdee,
    custom_macros_enabled, custom_calories, custom_protein_g, custom_carb_g, custom_fat_g,
    regeneration_reason
  ) VALUES (
    p_client_id, p_coach_id, 'active', v_effective_from,
    p_work_activity_level, p_training_volume_hours, p_protein_target_g_per_kg,
    p_diet_type, p_goal_weight_kg, p_goal_deadline,
    p_baseline_calories, p_protein_target_g, p_carb_target_g, p_fat_target_g,
    p_base_weight_kg, p_bmr, p_tdee,
    p_custom_macros_enabled, p_custom_calories, p_custom_protein_g, p_custom_carb_g, p_custom_fat_g,
    p_regeneration_reason
  )
  ON CONFLICT (client_id) WHERE status = 'active'
  DO UPDATE SET
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
    base_weight_kg = EXCLUDED.base_weight_kg,
    goal_weight_kg = EXCLUDED.goal_weight_kg,
    goal_deadline  = EXCLUDED.goal_deadline,
    effective_from = EXCLUDED.effective_from,
    effective_until = NULL,
    updated_at = NOW()
    -- never-update: client_id, status (and created_at) are omitted on purpose.
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
