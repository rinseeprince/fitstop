-- =============================================================================
-- Migration 133: drop the roadmaps/phases feature at the schema level.
--
-- Owner decision 2026-07-25: roadmaps/phases are removed entirely pre-launch
-- (code removal shipped in the four commits preceding this one; the pre-removal
-- state is tagged roadmap-v2-pre-removal). The feature will be rebuilt from
-- scratch post-launch. Zero clients exist, so every drop below is data-safe.
--
-- Ordering is load-bearing:
--   1. daily_logs_full selects daily_logs.phase_id -> the view must drop BEFORE
--      the column (CREATE OR REPLACE cannot remove a mid-list column, and a
--      CASCADE would silently destroy the view).
--   2. The two phase-owned RPCs drop outright.
--   3. The two placement RPCs are recreated WITHOUT their phase args. Per the
--      mig 110/114/115 discipline: DROP the old overload by explicit signature,
--      CREATE the new one, re-apply the 106 lockdown AT THE NEW ARITY (a
--      wrong-arity REVOKE silently re-opens PUBLIC execute -- verify with \df
--      post-push). Bodies are copied verbatim minus the dropped columns; the
--      macro/upsert semantics are deliberately untouched.
--   4. phase_id drops from the five referencing tables (daily_habit_logs's
--      column has zero app readers/writers but its FK would block the table
--      drop). nutrition_plans.goal_source drops too (it recorded which scope
--      drove the calc; with one scope it is a constant).
--   5. phases drops before roadmaps (phases.roadmap_id is ON DELETE RESTRICT).
--   6. daily_logs_full is recreated WITH (security_invoker = on) inline --
--      mandatory, or the view launders past the RLS on its health-PII base
--      tables (assert-rls clause 3 guards this). DROP+CREATE discards grants;
--      Supabase default privileges re-grant to anon/authenticated/service_role
--      on CREATE, and the explicit service_role grant below is the belt for
--      the one consumer the app actually has.
--
-- mig 106's DO-loop proname list still names the dropped functions; it is
-- idempotent and simply matches nothing on a fresh rebuild -- harmless.
-- Pure ASCII inside every $$ body (old supabase CLI splitter is byte-fragile).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Drop the view (recreated in step 6 without phase_id).
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.daily_logs_full;

-- ---------------------------------------------------------------------------
-- 2) Drop the phase-owned RPCs (both live + legacy signatures, re-run safe).
--    archive_roadmap_atomic had no source-level grants (mig 106's DO-loop
--    locked it at runtime), so there is nothing to replay.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS transition_phase_atomic(UUID, TEXT, JSONB, TEXT, BOOLEAN, BOOLEAN, BOOLEAN);
DROP FUNCTION IF EXISTS transition_phase_atomic(UUID, TEXT, JSONB, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, DATE);
DROP FUNCTION IF EXISTS archive_roadmap_atomic(UUID);

-- ---------------------------------------------------------------------------
-- 3a) create_nutrition_plan_atomic: 28 args -> 26 (drop p_phase_id,
--     p_goal_source). Body verbatim from mig 115 minus the two columns
--     (insert columns 26 -> 24, always-update bucket 20 -> 18).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS create_nutrition_plan_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, UUID, TEXT, TEXT, DATE, DATE, BOOLEAN);

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
  p_coach_notes TEXT DEFAULT NULL,
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
  -- of the 24 insert columns lands in exactly one bucket:
  --   never-update (3): client_id (conflict key), status (stays 'active'),
  --     effective_from -- plus created_at (auto default, not listed) -> these
  --     are first-insert only and keep the "active since {date}" banner stable.
  --   case-on-recalc (3): base_weight_kg, goal_weight_kg, goal_deadline -- the
  --     ONLY banner-reference snapshot columns (spec section 9).
  --   always-update (18): every other prescriptive setting/target/macro, plus
  --     effective_until := NULL and updated_at := NOW().
  INSERT INTO nutrition_plans (
    client_id, coach_id, status, effective_from,
    work_activity_level, training_volume_hours, protein_target_g_per_kg,
    diet_type, goal_weight_kg, goal_deadline,
    baseline_calories, protein_target_g, carb_target_g, fat_target_g,
    base_weight_kg, bmr, tdee,
    custom_macros_enabled, custom_calories, custom_protein_g, custom_carb_g, custom_fat_g,
    regeneration_reason, coach_notes
  ) VALUES (
    p_client_id, p_coach_id, 'active', v_effective_from,
    p_work_activity_level, p_training_volume_hours, p_protein_target_g_per_kg,
    p_diet_type, p_goal_weight_kg, p_goal_deadline,
    p_baseline_calories, p_protein_target_g, p_carb_target_g, p_fat_target_g,
    p_base_weight_kg, p_bmr, p_tdee,
    p_custom_macros_enabled, p_custom_calories, p_custom_protein_g, p_custom_carb_g, p_custom_fat_g,
    p_regeneration_reason, p_coach_notes
  )
  ON CONFLICT (client_id) WHERE status = 'active'
  DO UPDATE SET
    -- always-update (18)
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
    coach_notes = EXCLUDED.coach_notes,
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

-- Re-apply the migration 106 grant lockdown at the NEW 26-arg signature.
REVOKE EXECUTE ON FUNCTION create_nutrition_plan_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, TEXT, DATE, DATE, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_nutrition_plan_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, TEXT, DATE, DATE, BOOLEAN) TO service_role;

-- ---------------------------------------------------------------------------
-- 3b) create_training_plan_atomic: 23 args -> 22 (drop the non-defaulted
--     p_phase_id, position 19). Body verbatim from mig 114 minus the column;
--     the additive window-delete keeps writing calorie_surplus_percentage-
--     bearing events downstream exactly as before.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS create_training_plan_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, UUID, DATE, UUID, DATE, DATE);

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
  p_effective_from DATE DEFAULT NULL,
  p_saved_plan_id UUID DEFAULT NULL,
  p_today DATE DEFAULT NULL,
  p_window_end DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- DECLARE initializers evaluate in order: v_today must come first so
  -- v_effective_from can default to it.
  v_today DATE := COALESCE(p_today, CURRENT_DATE);
  v_effective_from DATE := COALESCE(p_effective_from, v_today);
  v_new_plan_id UUID;
BEGIN
  -- Additive placement: clear ONLY the incoming plan's own future window so
  -- the freshly generated events have empty slots to land in (makes re-place
  -- idempotent and lets an overlapping placement win on its contested dates).
  -- No plan-status filter (the new plan id does not exist yet, and we want any
  -- prior occupant of these dates cleared), but status='scheduled' preserves
  -- completed/missed history and the GREATEST() floor preserves the past.
  -- Skip entirely when no window is supplied (pure additive, no surprise wipe).
  IF p_window_end IS NOT NULL THEN
    DELETE FROM training_events
    WHERE client_id = p_client_id
      AND status = 'scheduled'
      AND date >= GREATEST(v_effective_from, v_today)
      AND date <= p_window_end;
  END IF;

  -- Insert the new plan as provenance. Always 'active' (reads are date-driven
  -- off effective_from); effective_until stays NULL so coexisting plans are
  -- distinguished purely by effective_from ordering. No archival of prior plans.
  INSERT INTO training_plans (
    client_id, coach_id, name, description, status, effective_from,
    coach_prompt, ai_response_raw, split_type, frequency_per_week,
    program_duration_weeks, client_weight_kg, client_body_fat_percentage,
    client_goal_weight_kg, client_tdee,
    avg_mood, avg_energy, avg_sleep, avg_stress, recent_adherence_percentage,
    saved_plan_id
  ) VALUES (
    p_client_id, p_coach_id, p_name, p_description, 'active', v_effective_from,
    p_coach_prompt, p_ai_response_raw, p_split_type, p_frequency_per_week,
    p_program_duration_weeks, p_client_weight_kg, p_client_body_fat_percentage,
    p_client_goal_weight_kg, p_client_tdee,
    p_avg_mood, p_avg_energy, p_avg_sleep, p_avg_stress, p_recent_adherence_percentage,
    p_saved_plan_id
  )
  RETURNING id INTO v_new_plan_id;

  RETURN v_new_plan_id;
END;
$$;

-- Re-apply migration 106's grant lockdown to the new 22-arg signature.
REVOKE EXECUTE ON FUNCTION create_training_plan_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, DATE, UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_training_plan_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, DATE, UUID, DATE, DATE) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Drop phase_id from the five referencing tables (indexes + named FK
--    constraints die with the columns) and nutrition_plans.goal_source.
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.training_plans DROP COLUMN IF EXISTS phase_id;
ALTER TABLE IF EXISTS public.nutrition_plans DROP COLUMN IF EXISTS phase_id;
ALTER TABLE IF EXISTS public.daily_habits DROP COLUMN IF EXISTS phase_id;
ALTER TABLE IF EXISTS public.daily_logs DROP COLUMN IF EXISTS phase_id;
ALTER TABLE IF EXISTS public.daily_habit_logs DROP COLUMN IF EXISTS phase_id;
ALTER TABLE IF EXISTS public.nutrition_plans DROP COLUMN IF EXISTS goal_source;

-- The mig 104 column comment referenced phase-scoped goals; re-issue without.
COMMENT ON COLUMN client_goals.goal_start_date IS
  'Optional anchor for the long-term goal pace window (start -> goal_deadline). NULL falls back to today in the resolver.';

-- ---------------------------------------------------------------------------
-- 5) Drop the feature tables. phases first (its roadmap_id FK is ON DELETE
--    RESTRICT); policies, indexes, and updated_at triggers die with them.
--    update_updated_at_column() is shared by many tables and stays.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.phases;
DROP TABLE IF EXISTS public.roadmaps;

-- ---------------------------------------------------------------------------
-- 6) Recreate daily_logs_full without dl.phase_id. security_invoker MUST be
--    inline (mig 123/131): without it the view would launder past the RLS on
--    the health-PII base tables. Column order otherwise matches mig 131
--    (soreness stays last -- readers map by name, order is cosmetic).
-- ---------------------------------------------------------------------------
CREATE VIEW public.daily_logs_full WITH (security_invoker = on) AS
 SELECT dl.id, dl.client_id, dl.date, dl.notes,
    dl.created_at, dl.updated_at,
    wl.mood, wl.energy, wl.sleep, wl.stress,
    nl.calories_consumed, nl.protein_g, nl.carbs_g, nl.fat_g,
    nl.target_calories, nl.target_protein_g, nl.target_carbs_g, nl.target_fat_g,
    nl.nutrition_adherence, nl.calorie_surplus_deficit,
    tl.trained, tl.training_session_id, tl.training_data,
    wl.soreness
   FROM public.daily_logs dl
     LEFT JOIN public.wellness_logs wl ON wl.daily_log_id = dl.id
     LEFT JOIN public.nutrition_logs nl ON nl.daily_log_id = dl.id
     LEFT JOIN public.training_logs tl ON tl.daily_log_id = dl.id;

-- Supabase default privileges re-grant on CREATE; this is the explicit belt
-- for the one consumer the app path actually has (supabaseAdmin).
GRANT ALL ON TABLE public.daily_logs_full TO service_role;
