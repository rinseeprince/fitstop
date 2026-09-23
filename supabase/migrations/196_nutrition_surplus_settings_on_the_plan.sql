-- Migration 196: the two training-surplus settings belong to the saved plan.
--
-- Owner, 2026-09-23: a past day's target never changes, and the surplus
-- settings apply when the coach saves the plan, never when a switch moves.
-- Until now "Apply training day surplus" (clients.include_activity_burn,
-- migration 033) and "Add training calories as" (clients.surplus_as_carbs,
-- migration 117) sat on the client, were written the moment the coach flipped
-- them, and every computed day -- past ones included -- was priced with them
-- as they stood at that moment. They now live on each saved version and are
-- written by the plan save in its own transaction, so a day is priced with the
-- settings of the version covering it: a change applies from the save's first
-- day (the client's today at the earliest, by the save's own belt) and every
-- earlier day keeps what it had.
--
-- Filled from each version's client's current values -- what every one of its
-- days shows today -- so nothing moves when this lands. Probed before: DEV 359
-- versions (150 archived) over 236 clients, 105 of those versions on a client
-- with the surplus off and 158 on one adding it as carbs only; PROD holds no
-- clients and no versions.

ALTER TABLE public.nutrition_plans
  ADD COLUMN IF NOT EXISTS include_activity_burn BOOLEAN,
  ADD COLUMN IF NOT EXISTS surplus_as_carbs BOOLEAN;

-- The fill reads the client's columns, so it runs only while they exist: a
-- re-run after the drop below must not fail on them.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clients'
      AND column_name = 'include_activity_burn'
  ) THEN
    UPDATE public.nutrition_plans p
    SET include_activity_burn = c.include_activity_burn,
        surplus_as_carbs = c.surplus_as_carbs
    FROM public.clients c
    WHERE c.id = p.client_id
      AND p.include_activity_burn IS NULL;
  END IF;
END $$;

-- The defaults are the settings a first plan has always started from (surplus
-- on, kept to the plan's split). The save states both on every version; the
-- defaults serve a row inserted by hand, never the app.
ALTER TABLE public.nutrition_plans
  ALTER COLUMN include_activity_burn SET DEFAULT true,
  ALTER COLUMN surplus_as_carbs SET DEFAULT false;

UPDATE public.nutrition_plans SET include_activity_burn = true WHERE include_activity_burn IS NULL;
UPDATE public.nutrition_plans SET surplus_as_carbs = false WHERE surplus_as_carbs IS NULL;

ALTER TABLE public.nutrition_plans
  ALTER COLUMN include_activity_burn SET NOT NULL,
  ALTER COLUMN surplus_as_carbs SET NOT NULL;

COMMENT ON COLUMN public.nutrition_plans.include_activity_burn IS
  'Apply training day surplus: whether a day with a session adds its sessions'' surplus percentage to this version''s baseline. Saved with the version by create_nutrition_plan_atomic (migration 196); a day is priced with the setting of the version covering it, so a change applies from the save''s first day and never reaches an earlier one.';
COMMENT ON COLUMN public.nutrition_plans.surplus_as_carbs IS
  'Add training calories as: false keeps the plan''s carb:fat split on a training-day surplus, true adds the whole surplus as carbs (protein is held either way). Saved with the version by create_nutrition_plan_atomic (migration 196), priced like include_activity_burn.';

-- The RPC: the 26-argument overload goes; the 28-argument one replaces it.
-- Body verbatim from migration 172 but for the two settings on both arms and
-- the belt that refuses a save without them.
DROP FUNCTION IF EXISTS public.create_nutrition_plan_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, DATE, DATE, DATE, TEXT);

CREATE OR REPLACE FUNCTION public.create_nutrition_plan_atomic(
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
  -- The version's two surplus settings (migration 196). Required, and declared
  -- before the defaulted parameters for the reason p_effective_until gives.
  p_include_activity_burn BOOLEAN,
  p_surplus_as_carbs BOOLEAN,
  -- The placement's last day, resolved by the caller (services/nutrition-plan-service.ts
  -- resolveNutritionPlacementEnd). Required: a version without an end is the
  -- model migration 166 retired. Declared before the two defaulted parameters
  -- because Postgres requires every parameter after a defaulted one to carry a
  -- default; PostgREST calls by name, so the position is invisible to callers.
  p_effective_until DATE,
  p_effective_from DATE DEFAULT NULL,
  p_today DATE DEFAULT NULL,
  -- The coach's note for this save (migration 172). One of the save's
  -- arguments, so it lands in the version's transaction; omitted when the save
  -- carries none, which on a same-day re-save clears the version's note -- the
  -- note is the latest save's, empty included.
  p_coach_note TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- v_today first: DECLARE initializers evaluate in order.
  v_today DATE := COALESCE(p_today, CURRENT_DATE);
  v_start DATE := COALESCE(p_effective_from, v_today);
  v_end DATE := p_effective_until;
  v_next_start DATE;
  v_same_id UUID;
  v_plan_id UUID;
  v_target JSONB;
BEGIN
  -- Caller-cooperative belt (144's): a past-dated save would cap version
  -- history behind the client's back. The message is deliberately unlike
  -- PostgREST's function-resolution errors so a log line can never be misread
  -- as a PGRST202 arity break.
  IF v_start < v_today THEN
    RAISE EXCEPTION
      'nutrition plan version cannot start before p_today (start %, today %)',
      v_start, v_today
      USING HINT = 'The route rejects past effective dates; this belt keeps a future caller that skips it from rewriting version history.';
  END IF;

  IF v_end IS NULL OR v_end < v_start THEN
    RAISE EXCEPTION
      'nutrition plan version cannot end before it starts (start %, end %)',
      v_start, v_end
      USING HINT = 'p_effective_until is the placement''s last day and must be on or after its first.';
  END IF;

  -- A version prices its training days with its own two settings, so a save
  -- that does not state them has nothing to price them with.
  IF p_include_activity_burn IS NULL OR p_surplus_as_carbs IS NULL THEN
    RAISE EXCEPTION
      'nutrition plan version needs both surplus settings (include_activity_burn %, surplus_as_carbs %)',
      p_include_activity_burn, p_surplus_as_carbs
      USING HINT = 'The drawer sends both with every save (migration 196).';
  END IF;

  -- Serialize concurrent saves on this client: every active version is locked
  -- for the transaction. Racing FIRST saves have nothing to lock and collide
  -- on the gist exclusion instead (23P01) -- loud, never silent drift.
  PERFORM 1
  FROM nutrition_plans
  WHERE client_id = p_client_id
    AND status = 'active'
  FOR UPDATE;

  -- A version starting on the same day is REPLACED IN PLACE: it keeps its id,
  -- so a retry lands on one row rather than a twin, and its note is the
  -- latest save's.
  SELECT id INTO v_same_id
  FROM nutrition_plans
  WHERE client_id = p_client_id
    AND status = 'active'
    AND effective_from = v_start;

  -- The next queued version caps this one (training's getNextPlanStartCap).
  -- The caller already applied the same cap; this is the belt that keeps the
  -- row consistent if a version was queued between the caller's read and now.
  SELECT MIN(effective_from) INTO v_next_start
  FROM nutrition_plans
  WHERE client_id = p_client_id
    AND status = 'active'
    AND effective_from > v_start;

  IF v_next_start IS NOT NULL AND v_next_start - 1 < v_end THEN
    v_end := v_next_start - 1;
  END IF;

  -- Cap the predecessor: the active version that started before v_start and
  -- still reaches it. Convergence, not deletion -- its days before v_start
  -- stay its own, settings included. Windows never overlap, so at most one row
  -- matches.
  UPDATE nutrition_plans
  SET effective_until = v_start - 1,
      updated_at = NOW()
  WHERE client_id = p_client_id
    AND status = 'active'
    AND effective_from < v_start
    AND effective_until >= v_start;

  IF v_same_id IS NOT NULL THEN
    -- Same-day re-save: the same always-update columns, plus the window's end,
    -- the note and the two settings; id/client_id/status/name/created_at/
    -- effective_from stay.
    UPDATE nutrition_plans SET
      coach_id = p_coach_id,
      work_activity_level = p_work_activity_level,
      training_volume_hours = p_training_volume_hours,
      protein_target_g_per_kg = p_protein_target_g_per_kg,
      diet_type = p_diet_type,
      goal_weight_kg = p_goal_weight_kg,
      goal_deadline = p_goal_deadline,
      baseline_calories = p_baseline_calories,
      protein_target_g = p_protein_target_g,
      carb_target_g = p_carb_target_g,
      fat_target_g = p_fat_target_g,
      base_weight_kg = p_base_weight_kg,
      bmr = p_bmr,
      tdee = p_tdee,
      custom_macros_enabled = p_custom_macros_enabled,
      custom_calories = p_custom_calories,
      custom_protein_g = p_custom_protein_g,
      custom_carb_g = p_custom_carb_g,
      custom_fat_g = p_custom_fat_g,
      regeneration_reason = p_regeneration_reason,
      include_activity_burn = p_include_activity_burn,
      surplus_as_carbs = p_surplus_as_carbs,
      coach_note = p_coach_note,
      effective_until = v_end,
      updated_at = NOW()
    WHERE id = v_same_id
    RETURNING id INTO v_plan_id;
  ELSE
    -- A new placement. No ON CONFLICT: the cap above cleared its window, and
    -- the gist exclusion is the backstop that must never fire.
    INSERT INTO nutrition_plans (
      client_id, coach_id, status, effective_from, effective_until,
      work_activity_level, training_volume_hours, protein_target_g_per_kg,
      diet_type, goal_weight_kg, goal_deadline,
      baseline_calories, protein_target_g, carb_target_g, fat_target_g,
      base_weight_kg, bmr, tdee,
      custom_macros_enabled, custom_calories, custom_protein_g, custom_carb_g, custom_fat_g,
      regeneration_reason, include_activity_burn, surplus_as_carbs, coach_note
    ) VALUES (
      p_client_id, p_coach_id, 'active', v_start, v_end,
      p_work_activity_level, p_training_volume_hours, p_protein_target_g_per_kg,
      p_diet_type, p_goal_weight_kg, p_goal_deadline,
      p_baseline_calories, p_protein_target_g, p_carb_target_g, p_fat_target_g,
      p_base_weight_kg, p_bmr, p_tdee,
      p_custom_macros_enabled, p_custom_calories, p_custom_protein_g, p_custom_carb_g, p_custom_fat_g,
      p_regeneration_reason, p_include_activity_burn, p_surplus_as_carbs, p_coach_note
    )
    RETURNING id INTO v_plan_id;
  END IF;

  -- Replace the version's daily-target grid. DELETE-then-INSERT is load-bearing
  -- on the same-day path (the row keeps its id and gets the new grid); on a
  -- fresh insert the DELETE is a no-op, kept unconditional so there is one path.
  DELETE FROM nutrition_plan_daily_targets WHERE nutrition_plan_id = v_plan_id;

  FOR v_target IN SELECT * FROM jsonb_array_elements(p_daily_targets)
  LOOP
    INSERT INTO nutrition_plan_daily_targets (
      nutrition_plan_id, day_of_week, calories, protein_g, carb_g, fat_g, is_training_day
    ) VALUES (
      v_plan_id,
      v_target->>'day_of_week',
      (v_target->>'calories')::INTEGER,
      (v_target->>'protein_g')::NUMERIC,
      (v_target->>'carb_g')::NUMERIC,
      (v_target->>'fat_g')::NUMERIC,
      (v_target->>'is_training_day')::BOOLEAN
    );
  END LOOP;

  RETURN v_plan_id;
END;
$$;

-- A dropped-and-recreated function starts with Postgres' default PUBLIC
-- execute (migration 106's finding), so the lockdown is restated here.
REVOKE EXECUTE ON FUNCTION public.create_nutrition_plan_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, BOOLEAN, BOOLEAN, DATE, DATE, DATE, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_nutrition_plan_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, BOOLEAN, BOOLEAN, DATE, DATE, DATE, TEXT) TO service_role;

-- The client's two columns go: the settings are the plan's now, and nothing
-- else reads them (probed: no function, view or policy refers to either).
ALTER TABLE public.clients
  DROP COLUMN IF EXISTS include_activity_burn,
  DROP COLUMN IF EXISTS surplus_as_carbs;
