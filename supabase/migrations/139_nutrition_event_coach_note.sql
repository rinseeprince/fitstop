-- =============================================================================
-- Coach-private per-day note on nutrition_events, and the removal of the
-- write-only plan-level note it replaces.
--
-- WHY: nutrition_plans.coach_notes had ZERO read sites anywhere in the app. The
-- builder textarea that wrote it also cleared itself on every successful save,
-- and this RPC's always-update bucket re-stamped the column each time — so each
-- regenerate nulled the previous note. The field was invisible AND
-- self-destructing. Notes now land on the DATE the change took effect, where the
-- coach actually looks.
--
-- Distinct from nutrition_events.note, which is CLIENT-FACING (authored in the
-- calendar's Edit-targets sheet and rendered in the client portal). coach_note
-- is never returned by /api/client/**.
--
--
-- ORDERING IS LOAD-BEARING:
--   1. Add the column.
--   2. Backfill BEFORE anything drops — the source data is gone after step 5.
--   3+4. Rebuild the RPC (26 -> 24 args) and re-apply the mig 106 lockdown AT
--        THE NEW ARITY. A wrong-arity REVOKE silently re-opens PUBLIC execute on
--        a SECURITY DEFINER function (mig 133's own recorded warning).
--   5. Only then drop the column. plpgsql bodies are NOT dependency-tracked, so
--      Postgres will happily let you drop a column the live function still
--      references — it fails at RUNTIME, not at push.
--
-- Every drop is IF EXISTS so a half-failed push stays re-runnable.
-- Pure ASCII inside the $$ body (the old supabase CLI splitter is byte-fragile).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) The coach-private note column.
-- ---------------------------------------------------------------------------
ALTER TABLE public.nutrition_events
  ADD COLUMN IF NOT EXISTS coach_note TEXT;

COMMENT ON COLUMN public.nutrition_events.coach_note IS
  'Coach-private note about a plan change taking effect on this date. NEVER returned by /api/client/** — distinct from `note`, which IS shown to the client.';

-- ---------------------------------------------------------------------------
-- 2) Lossless backfill, before the source column disappears.
--
-- Idempotent (guarded on coach_note IS NULL), so a re-run after a partial push
-- neither duplicates nor overwrites.
--
-- CAVEAT, deliberately recorded: these salvaged markers are NOT a timeline.
-- coach_notes was re-stamped on every plan upsert while effective_from is in the
-- RPC's never-update bucket, so a note lands on the plan's ORIGINAL start date
-- rather than the day of the change it describes. Harmless for the handful of
-- seeded rows; do not read them as history.
-- ---------------------------------------------------------------------------
UPDATE nutrition_events e
   SET coach_note = p.coach_notes
  FROM nutrition_plans p
 WHERE e.client_id = p.client_id
   AND e.date      = p.effective_from
   AND p.coach_notes IS NOT NULL
   AND e.coach_note IS NULL;

-- ---------------------------------------------------------------------------
-- 3) create_nutrition_plan_atomic: 26 args -> 24.
--
--    Drops p_coach_notes (position 23) and p_recalc_snapshots (position 26).
--    p_recalc_snapshots was `!body.preserveCalories` at its only conditional
--    call site; preserveCalories is retired, so it is now constant true and the
--    three CASE WHEN expressions collapse to plain EXCLUDED.
--
--    Body otherwise verbatim from mig 133: insert columns 24 -> 23,
--    always-update bucket 18 -> 17, case-on-recalc 3 -> 0.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS create_nutrition_plan_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, TEXT, DATE, DATE, BOOLEAN);

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
  --   never-update (3): client_id (conflict key), status (stays 'active'),
  --     effective_from -- plus created_at (auto default, not listed) -> these
  --     are first-insert only and keep the "active since {date}" banner stable.
  --   always-update (20): every other prescriptive setting/target/macro,
  --     including the three banner-snapshot columns (base_weight_kg,
  --     goal_weight_kg, goal_deadline), plus effective_until := NULL and
  --     updated_at := NOW().
  --
  -- The snapshot columns used to be conditional on p_recalc_snapshots, which
  -- was false on exactly one path: the preserve-calories regen, which reused
  -- the stored baseline instead of recalculating and therefore had to leave
  -- base_weight_kg alone or the weight-drift banner would wrongly silence.
  -- That path is gone -- every surviving caller is a genuine recompute, which
  -- is precisely the condition that warrants re-stamping.
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
    effective_until = NULL,
    updated_at = NOW()
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

-- ---------------------------------------------------------------------------
-- 4) Re-apply the migration 106 grant lockdown at the NEW 24-arg signature.
--    Verify with \df post-push: a wrong-arity REVOKE is silent and leaves
--    PUBLIC execute on a SECURITY DEFINER function taking caller-supplied ids.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION create_nutrition_plan_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_nutrition_plan_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, DATE, DATE) TO service_role;

-- ---------------------------------------------------------------------------
-- 5) Drop the superseded column, now that no live function references it.
-- ---------------------------------------------------------------------------
ALTER TABLE public.nutrition_plans DROP COLUMN IF EXISTS coach_notes;
