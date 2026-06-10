-- =============================================================================
-- Migration 110: judge plan placement against client-local today, not UTC.
--
-- WHY: both atomic plan RPCs decide active-vs-planned by comparing
-- v_effective_from against CURRENT_DATE - the server's UTC day. A coach
-- applying a plan "today" just after local midnight (e.g. 00:30 BST = 23:30
-- UTC the previous day) gets the plan mis-filed as 'planned' instead of
-- 'active'. Fix: a trailing p_today DATE DEFAULT NULL parameter; the service
-- layer passes the client-local today (clients.timezone, coach-tz fallback -
-- see services/today-service.ts), and CURRENT_DATE remains only as a
-- defensive fallback. p_effective_from's default likewise moves from
-- CURRENT_DATE to v_today: TS callers pass explicit NULL when no date is
-- chosen, so the old COALESCE(p_effective_from, CURRENT_DATE) was the same
-- UTC bug wearing a different hat.
--
-- STRUCTURE (3 parts):
--   1) DROP every live overload of both functions, by EXPLICIT signature.
--      They were CREATE OR REPLACE'd with CHANGED signatures over time
--      (training: 073/081/086/087, nutrition: 048/066/069/078/080), leaving
--      multiple live overloads. Adding a parameter via a bare CREATE OR
--      REPLACE would mint yet another PUBLIC-executable overload - silently
--      re-opening the hole migration 106 closed. The signatures below are the
--      complete live catalog as enumerated by 106's lockdown NOTICEs and
--      re-confirmed by this migration's first (partially applied) run.
--      NOTE: this file is deliberately PURE ASCII. supabase CLI v2.45.5's
--      statement splitter desyncs on multi-byte UTF-8 (e.g. an em dash in a
--      comment) INSIDE a dollar-quoted body: it misses the closing $$ and
--      swallows every following statement into one prepared statement, which
--      the server rejects ("cannot insert multiple commands into a prepared
--      statement", SQLSTATE 42601). Migration 100 got away with it only
--      because its body ends at EOF. Keep non-ASCII out of $$ bodies (or out
--      of migrations entirely) until the CLI is upgraded.
--      An earlier revision used a pg_proc DO-loop for the drops; the explicit
--      IF EXISTS drops keep the re-run after the partial first apply safe.
--   2) CREATE OR REPLACE one canonical definition per function: the 087 / 080
--      body byte-for-byte except for the p_today plumbing, with
--      SET search_path = public pinned in the header (106's defense against
--      search_path hijacking of SECURITY DEFINER functions).
--   3) Re-apply 106's grant lockdown to the new signatures - a fresh CREATE
--      defaults EXECUTE to PUBLIC. Only service_role (supabaseAdmin) may
--      execute.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Drop all live overloads of both plan RPCs (catalog from 106's NOTICEs).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS create_training_plan_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, UUID);
DROP FUNCTION IF EXISTS create_training_plan_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, UUID, DATE);
DROP FUNCTION IF EXISTS create_training_plan_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, UUID, DATE, UUID);
DROP FUNCTION IF EXISTS create_nutrition_plan_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB);
DROP FUNCTION IF EXISTS create_nutrition_plan_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, UUID);
DROP FUNCTION IF EXISTS create_nutrition_plan_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS create_nutrition_plan_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, UUID, TEXT, TEXT, DATE);

-- ---------------------------------------------------------------------------
-- 2a) create_training_plan_atomic - 087 body + p_today.
-- ---------------------------------------------------------------------------
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
  p_effective_from DATE DEFAULT NULL,
  p_saved_plan_id UUID DEFAULT NULL,
  p_today DATE DEFAULT NULL
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
  -- STEP 0: Delete scheduled events for any currently active or planned plan
  -- from v_effective_from onward. Runs BEFORE archival so we can still
  -- identify plans by their live status.
  DELETE FROM training_events
  WHERE client_id = p_client_id
    AND status = 'scheduled'
    AND date >= v_effective_from
    AND training_plan_id IN (
      SELECT id FROM training_plans
      WHERE client_id = p_client_id
        AND status IN ('active', 'planned')
    );

  IF v_effective_from > v_today THEN
    -- =======================================================================
    -- FUTURE DATE: insert as 'planned', leave active plan untouched.
    -- =======================================================================

    -- Archive any existing planned plan (only one planned per client).
    UPDATE training_plans
    SET status = 'archived',
        effective_until = v_effective_from - 1,
        updated_at = NOW()
    WHERE client_id = p_client_id
      AND status = 'planned';

    -- Insert new plan as planned.
    INSERT INTO training_plans (
      client_id, coach_id, name, description, status, effective_from,
      coach_prompt, ai_response_raw, split_type, frequency_per_week,
      program_duration_weeks, client_weight_kg, client_body_fat_percentage,
      client_goal_weight_kg, client_tdee,
      avg_mood, avg_energy, avg_sleep, avg_stress, recent_adherence_percentage,
      phase_id, saved_plan_id
    ) VALUES (
      p_client_id, p_coach_id, p_name, p_description, 'planned', v_effective_from,
      p_coach_prompt, p_ai_response_raw, p_split_type, p_frequency_per_week,
      p_program_duration_weeks, p_client_weight_kg, p_client_body_fat_percentage,
      p_client_goal_weight_kg, p_client_tdee,
      p_avg_mood, p_avg_energy, p_avg_sleep, p_avg_stress, p_recent_adherence_percentage,
      p_phase_id, p_saved_plan_id
    )
    RETURNING id INTO v_new_plan_id;

  ELSE
    -- =======================================================================
    -- TODAY OR PAST: archive active + any planned, insert as 'active'.
    -- =======================================================================

    -- Archive current active plan.
    UPDATE training_plans
    SET status = 'archived',
        effective_until = v_effective_from - 1,
        updated_at = NOW()
    WHERE client_id = p_client_id
      AND status = 'active';

    -- Archive any planned plan too - the new active replaces both.
    UPDATE training_plans
    SET status = 'archived',
        effective_until = v_effective_from - 1,
        updated_at = NOW()
    WHERE client_id = p_client_id
      AND status = 'planned';

    -- Insert new plan as active.
    INSERT INTO training_plans (
      client_id, coach_id, name, description, status, effective_from,
      coach_prompt, ai_response_raw, split_type, frequency_per_week,
      program_duration_weeks, client_weight_kg, client_body_fat_percentage,
      client_goal_weight_kg, client_tdee,
      avg_mood, avg_energy, avg_sleep, avg_stress, recent_adherence_percentage,
      phase_id, saved_plan_id
    ) VALUES (
      p_client_id, p_coach_id, p_name, p_description, 'active', v_effective_from,
      p_coach_prompt, p_ai_response_raw, p_split_type, p_frequency_per_week,
      p_program_duration_weeks, p_client_weight_kg, p_client_body_fat_percentage,
      p_client_goal_weight_kg, p_client_tdee,
      p_avg_mood, p_avg_energy, p_avg_sleep, p_avg_stress, p_recent_adherence_percentage,
      p_phase_id, p_saved_plan_id
    )
    RETURNING id INTO v_new_plan_id;

  END IF;

  RETURN v_new_plan_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2b) create_nutrition_plan_atomic - 080 body + p_today.
-- ---------------------------------------------------------------------------
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
  IF v_effective_from > v_today THEN
    -- =======================================================================
    -- FUTURE DATE: insert as 'planned', leave active plan untouched
    -- =======================================================================

    -- Archive any existing planned plan (only one planned per client)
    UPDATE nutrition_plans
    SET status = 'archived',
        effective_until = v_effective_from - 1,
        updated_at = NOW()
    WHERE client_id = p_client_id
      AND status = 'planned';

    -- Insert new plan as planned
    INSERT INTO nutrition_plans (
      client_id, coach_id, status, effective_from,
      work_activity_level, training_volume_hours, protein_target_g_per_kg,
      diet_type, goal_weight_kg, goal_deadline,
      baseline_calories, protein_target_g, carb_target_g, fat_target_g,
      base_weight_kg, bmr, tdee,
      custom_macros_enabled, custom_calories, custom_protein_g, custom_carb_g, custom_fat_g,
      regeneration_reason, phase_id, coach_notes, goal_source
    ) VALUES (
      p_client_id, p_coach_id, 'planned', v_effective_from,
      p_work_activity_level, p_training_volume_hours, p_protein_target_g_per_kg,
      p_diet_type, p_goal_weight_kg, p_goal_deadline,
      p_baseline_calories, p_protein_target_g, p_carb_target_g, p_fat_target_g,
      p_base_weight_kg, p_bmr, p_tdee,
      p_custom_macros_enabled, p_custom_calories, p_custom_protein_g, p_custom_carb_g, p_custom_fat_g,
      p_regeneration_reason, p_phase_id, p_coach_notes, p_goal_source
    )
    RETURNING id INTO v_new_plan_id;

  ELSE
    -- =======================================================================
    -- TODAY OR PAST: archive active + any orphaned planned, insert as 'active'
    -- =======================================================================

    -- Archive current active plan
    UPDATE nutrition_plans
    SET status = 'archived',
        effective_until = v_effective_from - 1,
        updated_at = NOW()
    WHERE client_id = p_client_id
      AND status = 'active';

    -- Clean up any orphaned planned plan
    UPDATE nutrition_plans
    SET status = 'archived',
        effective_until = v_effective_from - 1,
        updated_at = NOW()
    WHERE client_id = p_client_id
      AND status = 'planned';

    -- Insert new plan as active
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
    RETURNING id INTO v_new_plan_id;

  END IF;

  -- Insert daily target rows (same for both branches)
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
-- 3) Re-apply migration 106's grant lockdown to the new signatures.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION create_training_plan_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, UUID, DATE, UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_training_plan_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, UUID, DATE, UUID, DATE) TO service_role;

REVOKE EXECUTE ON FUNCTION create_nutrition_plan_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, UUID, TEXT, TEXT, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_nutrition_plan_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, UUID, TEXT, TEXT, DATE, DATE) TO service_role;
