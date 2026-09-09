-- =============================================================================
-- 166: a nutrition plan is a PLACEMENT, like a training program.
--
-- WHY (owner decision 2026-09-09, reversing migration 144's tiled-versions
-- model): a version with no end was the one cause behind three separate
-- defects, because its residue kept answering questions about the present.
-- A future block filled with the previous block's calories when a program was
-- placed into it; a deleted plan's closed [today, today] window still claimed
-- the block card; and a logged day's one-day residue made every later
-- placement's cascade regenerate that day alone while the card reported the
-- block as set. Each was patched on the reads (a generation clamp, a close at
-- the floor minus one, a block-scoped delete). This migration fixes the model
-- and the patches go with it.
--
-- MODEL: every version is [effective_from, effective_until], both stored. The
-- end is resolved at save exactly as training resolves its placement window
-- (the block covering the start, else the furthest live program's end, else
-- eight weeks) and capped at the next queued version's start. A save caps its
-- predecessor at start - 1 and replaces IN PLACE only a version starting on
-- the same day, so a same-day re-save collapses and a note retry never mints
-- a twin. A delete ARCHIVES the versions with days on or after the deletion
-- floor and removes those days, the training clear's shape. Reads resolve by
-- date among status = 'active' rows; an archived row governs nothing. There
-- is no open row any more, so idx_nutrition_plans_open_unique goes; the gist
-- exclusion stays, already scoped to active rows. A gap is a real state: no
-- version covers the day, no target exists, and the client's food log is
-- refused there (accepted cost, owner 2026-09-09).
--
-- WHAT THIS FILE DOES, in order:
--   A1  Repair archived residue carrying an inverted window (pre-fix deletes
--       closed a same-day version at today - 1). An archived row governs
--       nothing; a one-day window is the same approximate claim 144's A1 made.
--   A2  Give every open row an end: where its generated events end, else eight
--       weeks from its start. Every client is a test client (owner,
--       2026-09-09) and prod holds zero rows, so this is the NOT NULL
--       constraint's requirement, not a product decision; it leaves every
--       already-generated day governed.
--   A3  effective_until NOT NULL, plus CHECK (effective_until >= effective_from).
--   A4  DROP idx_nutrition_plans_open_unique.
--   A5  The RPC at 25 arguments (p_effective_until, required). The 24-argument
--       overload is DROPPED: a changed signature is a new function, so the
--       REVOKE/GRANT and search_path are re-applied explicitly (139's shape).
--
-- Pure ASCII inside the $$ body (the CLI splitter is byte-fragile).
-- =============================================================================

-- A1: archived residue with inverted windows becomes a one-day window.
UPDATE public.nutrition_plans
SET effective_until = effective_from,
    updated_at = NOW()
WHERE effective_until IS NOT NULL
  AND effective_until < effective_from;

-- A2: every open row gets an end -- the last day it generated, else 8 weeks.
UPDATE public.nutrition_plans np
SET effective_until = COALESCE(
      (SELECT MAX(e.date)
       FROM public.nutrition_events e
       WHERE e.nutrition_plan_id = np.id
         AND e.date >= np.effective_from),
      np.effective_from + 56),
    updated_at = NOW()
WHERE np.effective_until IS NULL;

-- A3: the column IS the window.
ALTER TABLE public.nutrition_plans
  ALTER COLUMN effective_until SET NOT NULL;

ALTER TABLE public.nutrition_plans
  DROP CONSTRAINT IF EXISTS nutrition_plans_window_valid;

ALTER TABLE public.nutrition_plans
  ADD CONSTRAINT nutrition_plans_window_valid
  CHECK (effective_until >= effective_from);

COMMENT ON COLUMN public.nutrition_plans.effective_until IS
  'The last day this version prescribes. Always written (migration 166): resolved at save like a training placement window -- the block covering the start, else the furthest live program''s end, else eight weeks -- capped at the next queued version''s start. A save caps its predecessor at start - 1; a delete archives the version rather than closing it. No open (NULL) row exists.';

-- A4: no open row exists any more.
DROP INDEX IF EXISTS public.idx_nutrition_plans_open_unique;

-- A5: the RPC. The 24-argument overload goes; the 25-argument one replaces it.
DROP FUNCTION IF EXISTS public.create_nutrition_plan_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, DATE, DATE);

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
  -- The placement's last day, resolved by the caller (services/nutrition-plan-service.ts
  -- resolveNutritionPlacementEnd). Required: a version without an end is the
  -- model this migration retires. Declared before the two defaulted parameters
  -- because Postgres requires every parameter after a defaulted one to carry a
  -- default; PostgREST calls by name, so the position is invisible to callers.
  p_effective_until DATE,
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

  -- Serialize concurrent saves on this client: every active version is locked
  -- for the transaction. Racing FIRST saves have nothing to lock and collide
  -- on the gist exclusion instead (23P01) -- loud, never silent drift.
  PERFORM 1
  FROM nutrition_plans
  WHERE client_id = p_client_id
    AND status = 'active'
  FOR UPDATE;

  -- A version starting on the same day is REPLACED IN PLACE: it keeps its id,
  -- so its events, its note rows and a retry after a failed note insert all
  -- land on one row rather than a twin.
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
  -- stay its own. Windows never overlap, so at most one row matches.
  UPDATE nutrition_plans
  SET effective_until = v_start - 1,
      updated_at = NOW()
  WHERE client_id = p_client_id
    AND status = 'active'
    AND effective_from < v_start
    AND effective_until >= v_start;

  IF v_same_id IS NOT NULL THEN
    -- Same-day re-save: the same 21 always-update columns as before, plus the
    -- window's end; id/client_id/status/name/created_at/effective_from stay.
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
      regeneration_reason
    ) VALUES (
      p_client_id, p_coach_id, 'active', v_start, v_end,
      p_work_activity_level, p_training_volume_hours, p_protein_target_g_per_kg,
      p_diet_type, p_goal_weight_kg, p_goal_deadline,
      p_baseline_calories, p_protein_target_g, p_carb_target_g, p_fat_target_g,
      p_base_weight_kg, p_bmr, p_tdee,
      p_custom_macros_enabled, p_custom_calories, p_custom_protein_g, p_custom_carb_g, p_custom_fat_g,
      p_regeneration_reason
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
REVOKE EXECUTE ON FUNCTION public.create_nutrition_plan_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, DATE, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_nutrition_plan_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, DATE, DATE, DATE) TO service_role;
