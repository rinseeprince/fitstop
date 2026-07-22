


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."content_type" AS ENUM (
    'video_link',
    'hyperlink',
    'pdf',
    'image',
    'document'
);


ALTER TYPE "public"."content_type" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."archive_roadmap_atomic"("p_roadmap_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Close any active OR planned phases so no phase outlives its archived
  -- roadmap. 067's archive_roadmap branch only skipped 'planned'; the active
  -- phase was left dangling. We skip both here.
  UPDATE phases
  SET status = 'skipped',
      updated_at = NOW()
  WHERE roadmap_id = p_roadmap_id
    AND status IN ('active', 'planned');

  -- Archive the roadmap itself.
  UPDATE roadmaps
  SET status = 'archived',
      updated_at = NOW()
  WHERE id = p_roadmap_id;
END;
$$;


ALTER FUNCTION "public"."archive_roadmap_atomic"("p_roadmap_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_age"("date_of_birth" "date") RETURNS integer
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
BEGIN
  IF date_of_birth IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN EXTRACT(YEAR FROM AGE(CURRENT_DATE, date_of_birth))::INTEGER;
END;
$$;


ALTER FUNCTION "public"."calculate_age"("date_of_birth" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."calculate_age"("date_of_birth" "date") IS 'Calculates age in years from a given date of birth';



CREATE OR REPLACE FUNCTION "public"."calculate_client_adherence_stats"("client_uuid" "uuid") RETURNS TABLE("expected_count" integer, "actual_count" integer, "adherence_rate" numeric)
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  account_age_days INTEGER;
  frequency_days INTEGER;
  v_expected_count INTEGER;
  v_actual_count INTEGER;
  v_adherence_rate DECIMAL(5,2);
BEGIN
  -- Get client's account age in days
  SELECT EXTRACT(DAY FROM NOW() - created_at)::INTEGER
  INTO account_age_days
  FROM clients
  WHERE id = client_uuid;

  -- Get frequency in days based on client's settings
  SELECT
    CASE check_in_frequency
      WHEN 'weekly' THEN 7
      WHEN 'biweekly' THEN 14
      WHEN 'monthly' THEN 30
      WHEN 'custom' THEN COALESCE(check_in_frequency_days, 7)
      ELSE 0
    END
  INTO frequency_days
  FROM clients
  WHERE id = client_uuid;

  -- Calculate expected count
  IF frequency_days > 0 AND account_age_days > 0 THEN
    v_expected_count := FLOOR(account_age_days::DECIMAL / frequency_days::DECIMAL)::INTEGER;
  ELSE
    v_expected_count := 0;
  END IF;

  -- Get actual count of completed check-ins
  SELECT COUNT(*)::INTEGER
  INTO v_actual_count
  FROM check_ins
  WHERE client_id = client_uuid;

  -- Calculate adherence rate (cap at 100%)
  IF v_expected_count > 0 THEN
    v_adherence_rate := LEAST((v_actual_count::DECIMAL / v_expected_count::DECIMAL) * 100, 100);
  ELSE
    v_adherence_rate := 100; -- No expectation = 100% adherence
  END IF;

  RETURN QUERY SELECT v_expected_count, v_actual_count, v_adherence_rate;
END;
$$;


ALTER FUNCTION "public"."calculate_client_adherence_stats"("client_uuid" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."calculate_client_adherence_stats"("client_uuid" "uuid") IS 'Calculates expected vs actual check-in counts and adherence rate for a client';



CREATE OR REPLACE FUNCTION "public"."clean_expired_tokens"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  DELETE FROM check_in_tokens
  WHERE expires_at < NOW() AND used_at IS NULL;
END;
$$;


ALTER FUNCTION "public"."clean_expired_tokens"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_nutrition_plan_atomic"("p_client_id" "uuid", "p_coach_id" "uuid", "p_work_activity_level" "text", "p_training_volume_hours" "text", "p_protein_target_g_per_kg" numeric, "p_diet_type" "text", "p_goal_weight_kg" numeric, "p_goal_deadline" "date", "p_baseline_calories" integer, "p_protein_target_g" numeric, "p_carb_target_g" numeric, "p_fat_target_g" numeric, "p_base_weight_kg" numeric, "p_bmr" numeric, "p_tdee" numeric, "p_custom_macros_enabled" boolean, "p_custom_calories" numeric, "p_custom_protein_g" numeric, "p_custom_carb_g" numeric, "p_custom_fat_g" numeric, "p_regeneration_reason" "text", "p_daily_targets" "jsonb", "p_phase_id" "uuid" DEFAULT NULL::"uuid", "p_coach_notes" "text" DEFAULT NULL::"text", "p_goal_source" "text" DEFAULT NULL::"text", "p_effective_from" "date" DEFAULT NULL::"date", "p_today" "date" DEFAULT NULL::"date", "p_recalc_snapshots" boolean DEFAULT false) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."create_nutrition_plan_atomic"("p_client_id" "uuid", "p_coach_id" "uuid", "p_work_activity_level" "text", "p_training_volume_hours" "text", "p_protein_target_g_per_kg" numeric, "p_diet_type" "text", "p_goal_weight_kg" numeric, "p_goal_deadline" "date", "p_baseline_calories" integer, "p_protein_target_g" numeric, "p_carb_target_g" numeric, "p_fat_target_g" numeric, "p_base_weight_kg" numeric, "p_bmr" numeric, "p_tdee" numeric, "p_custom_macros_enabled" boolean, "p_custom_calories" numeric, "p_custom_protein_g" numeric, "p_custom_carb_g" numeric, "p_custom_fat_g" numeric, "p_regeneration_reason" "text", "p_daily_targets" "jsonb", "p_phase_id" "uuid", "p_coach_notes" "text", "p_goal_source" "text", "p_effective_from" "date", "p_today" "date", "p_recalc_snapshots" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_training_plan_atomic"("p_client_id" "uuid", "p_coach_id" "uuid", "p_name" "text", "p_description" "text", "p_coach_prompt" "text", "p_ai_response_raw" "text", "p_split_type" "text", "p_frequency_per_week" integer, "p_program_duration_weeks" integer, "p_client_weight_kg" numeric, "p_client_body_fat_percentage" numeric, "p_client_goal_weight_kg" numeric, "p_client_tdee" numeric, "p_avg_mood" numeric, "p_avg_energy" numeric, "p_avg_sleep" numeric, "p_avg_stress" numeric, "p_recent_adherence_percentage" numeric, "p_phase_id" "uuid", "p_effective_from" "date" DEFAULT NULL::"date", "p_saved_plan_id" "uuid" DEFAULT NULL::"uuid", "p_today" "date" DEFAULT NULL::"date", "p_window_end" "date" DEFAULT NULL::"date") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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

  RETURN v_new_plan_id;
END;
$$;


ALTER FUNCTION "public"."create_training_plan_atomic"("p_client_id" "uuid", "p_coach_id" "uuid", "p_name" "text", "p_description" "text", "p_coach_prompt" "text", "p_ai_response_raw" "text", "p_split_type" "text", "p_frequency_per_week" integer, "p_program_duration_weeks" integer, "p_client_weight_kg" numeric, "p_client_body_fat_percentage" numeric, "p_client_goal_weight_kg" numeric, "p_client_tdee" numeric, "p_avg_mood" numeric, "p_avg_energy" numeric, "p_avg_sleep" numeric, "p_avg_stress" numeric, "p_recent_adherence_percentage" numeric, "p_phase_id" "uuid", "p_effective_from" "date", "p_saved_plan_id" "uuid", "p_today" "date", "p_window_end" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_client_exercise_list"("p_client_id" "uuid", "p_start_date" "date" DEFAULT NULL::"date", "p_end_date" "date" DEFAULT NULL::"date") RETURNS TABLE("exercise_id" "uuid", "name" "text", "log_count" integer, "last_logged_date" timestamp with time zone)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  WITH resolved AS (
    SELECT
      sl.completed_at,
      el.id AS exercise_log_id,
      COALESCE(el.exercise_id, te.exercise_id) AS resolved_exercise_id,
      el.performed_name,
      COALESCE(
        el.exercise_id::TEXT,
        te.exercise_id::TEXT,
        LOWER(el.performed_name),
        'unknown'
      ) AS identity_key
    FROM exercise_logs el
    JOIN session_logs sl ON sl.id = el.session_log_id
    LEFT JOIN training_exercises te ON te.id = el.training_exercise_id
    WHERE sl.client_id = p_client_id
      AND (p_start_date IS NULL OR sl.completed_at >= p_start_date)
      AND (p_end_date   IS NULL OR sl.completed_at <  (p_end_date + INTERVAL '1 day'))
  )
  SELECT
    (ARRAY_AGG(resolved_exercise_id ORDER BY completed_at DESC, exercise_log_id DESC)
      FILTER (WHERE resolved_exercise_id IS NOT NULL))[1] AS exercise_id,
    COALESCE(
      (ARRAY_AGG(performed_name ORDER BY completed_at DESC NULLS LAST, exercise_log_id DESC))[1],
      'Unknown exercise'
    ) AS name,
    COUNT(*)::INT AS log_count,
    MAX(completed_at) AS last_logged_date
  FROM resolved
  GROUP BY identity_key
  ORDER BY log_count DESC, name ASC;
$$;


ALTER FUNCTION "public"."get_client_exercise_list"("p_client_id" "uuid", "p_start_date" "date", "p_end_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_client_streak"("p_client_id" "uuid", "p_today" "date", "p_start_date" "date") RETURNS TABLE("current_streak" integer, "longest_streak" integer)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  WITH days AS (
    -- daily_logs has UNIQUE(client_id, date); DISTINCT is belt-and-braces.
    SELECT DISTINCT date AS d
    FROM daily_logs
    WHERE client_id = p_client_id
      AND date >= p_start_date
      AND date <= p_today
  ),
  islands AS (
    SELECT d, d - (ROW_NUMBER() OVER (ORDER BY d))::int AS grp
    FROM days
  ),
  runs AS (
    SELECT COUNT(*)::int AS run_len, MAX(d) AS run_end
    FROM islands
    GROUP BY grp
  )
  SELECT
    COALESCE(
      (SELECT run_len FROM runs
        WHERE run_end IN (p_today, p_today - 1)
        ORDER BY run_end DESC
        LIMIT 1),
      0
    )::int AS current_streak,
    COALESCE((SELECT MAX(run_len) FROM runs), 0)::int AS longest_streak;
$$;


ALTER FUNCTION "public"."get_client_streak"("p_client_id" "uuid", "p_today" "date", "p_start_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_exercise_progression_window"("p_client_id" "uuid", "p_exercise_id" "uuid" DEFAULT NULL::"uuid", "p_exercise_name" "text" DEFAULT NULL::"text", "p_session_count" integer DEFAULT NULL::integer, "p_start_date" "date" DEFAULT NULL::"date", "p_end_date" "date" DEFAULT NULL::"date") RETURNS TABLE("session_log_id" "uuid", "completed_at" timestamp with time zone, "exercise_log_id" "uuid", "prescribed_exercise_snapshot" "jsonb", "set_id" "uuid", "set_number" integer, "reps" integer, "weight" numeric, "rpe" numeric, "set_type" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  WITH matching AS (
    SELECT
      el.id AS exercise_log_id,
      el.session_log_id,
      sl.completed_at,
      el.prescribed_exercise_snapshot
    FROM exercise_logs el
    JOIN session_logs sl ON sl.id = el.session_log_id
    LEFT JOIN training_exercises te ON te.id = el.training_exercise_id
    WHERE sl.client_id = p_client_id
      AND (
        (p_exercise_id IS NOT NULL AND (el.exercise_id = p_exercise_id OR te.exercise_id = p_exercise_id))
        OR (p_exercise_name IS NOT NULL AND LOWER(el.performed_name) = LOWER(p_exercise_name))
      )
      AND (p_start_date IS NULL OR sl.completed_at >= p_start_date)
      AND (p_end_date   IS NULL OR sl.completed_at <  (p_end_date + INTERVAL '1 day'))
  ),
  windowed_sessions AS (
    SELECT m.session_log_id, MIN(m.completed_at) AS completed_at
    FROM matching m
    GROUP BY m.session_log_id
    ORDER BY MIN(m.completed_at) DESC, m.session_log_id DESC
    LIMIT COALESCE(
      p_session_count,
      CASE WHEN p_start_date IS NULL AND p_end_date IS NULL THEN 12 END
    )
  )
  SELECT
    m.session_log_id,
    m.completed_at,
    m.exercise_log_id,
    m.prescribed_exercise_snapshot,
    sl.id AS set_id,
    sl.set_number,
    sl.reps,
    sl.weight,
    sl.rpe,
    sl.set_type
  FROM matching m
  JOIN windowed_sessions ws ON ws.session_log_id = m.session_log_id
  LEFT JOIN set_logs sl ON sl.exercise_log_id = m.exercise_log_id
  ORDER BY m.completed_at ASC, m.session_log_id ASC, m.exercise_log_id ASC, sl.set_number ASC NULLS LAST;
$$;


ALTER FUNCTION "public"."get_exercise_progression_window"("p_client_id" "uuid", "p_exercise_id" "uuid", "p_exercise_name" "text", "p_session_count" integer, "p_start_date" "date", "p_end_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_exercise_prs"("p_client_id" "uuid", "p_exercise_id" "uuid" DEFAULT NULL::"uuid", "p_exercise_name" "text" DEFAULT NULL::"text") RETURNS TABLE("reps" integer, "weight" numeric, "date" timestamp with time zone)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT DISTINCT ON (sl.reps)
    sl.reps,
    sl.weight,
    slg.completed_at AS date
  FROM exercise_logs el
  JOIN session_logs slg ON slg.id = el.session_log_id
  LEFT JOIN training_exercises te ON te.id = el.training_exercise_id
  JOIN set_logs sl ON sl.exercise_log_id = el.id
  WHERE slg.client_id = p_client_id
    AND sl.reps IS NOT NULL AND sl.weight IS NOT NULL AND sl.weight > 0
    AND sl.set_type <> 'warmup'
    AND (
      (p_exercise_id IS NOT NULL AND (el.exercise_id = p_exercise_id OR te.exercise_id = p_exercise_id))
      OR (p_exercise_name IS NOT NULL AND LOWER(el.performed_name) = LOWER(p_exercise_name))
    )
  ORDER BY sl.reps ASC, sl.weight DESC, slg.completed_at ASC;
$$;


ALTER FUNCTION "public"."get_exercise_prs"("p_client_id" "uuid", "p_exercise_id" "uuid", "p_exercise_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  user_role TEXT;
  user_name TEXT;
BEGIN
  -- Role is derived from server state, NOT from raw_user_meta_data->>'role'.
  -- If this email was invited as a client (invitation row exists), they are a
  -- client; otherwise this is a coach self-signup.
  IF EXISTS (
    SELECT 1 FROM public.client_invitations ci
    WHERE lower(ci.email) = lower(NEW.email)
  ) THEN
    user_role := 'client';
  ELSE
    user_role := 'trainer';
  END IF;

  -- Name/avatar are non-security display fields; still sourced from metadata.
  user_name := COALESCE(
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'full_name',
    split_part(NEW.email, '@', 1)
  );

  INSERT INTO public.profiles (user_id, role)
  VALUES (NEW.id, user_role)
  ON CONFLICT (user_id) DO NOTHING;

  IF user_role = 'trainer' THEN
    INSERT INTO public.coaches (user_id, name, email, avatar_url)
    VALUES (
      NEW.id,
      user_name,
      NEW.email,
      NEW.raw_user_meta_data->>'avatar_url'
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_reminder_responded"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Find the most recent unanswered reminder for this client and mark it as responded
  UPDATE check_in_reminders
  SET
    responded = true,
    responded_at = NOW(),
    check_in_id = NEW.id
  WHERE id = (
    SELECT id FROM check_in_reminders
    WHERE client_id = NEW.client_id
      AND responded = false
    ORDER BY sent_at DESC
    LIMIT 1
  );

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."mark_reminder_responded"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mark_reminder_responded"() IS 'Automatically marks the most recent reminder as responded when client submits a check-in';



CREATE OR REPLACE FUNCTION "public"."transition_phase_atomic"("p_phase_id" "uuid", "p_coach_reflection" "text", "p_phase_summary" "jsonb", "p_next_action" "text", "p_archive_training" boolean, "p_archive_nutrition" boolean, "p_archive_habits" boolean, "p_today" "date" DEFAULT NULL::"date") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_roadmap_id UUID;
  v_next_phase_id UUID;
  v_today DATE := COALESCE(p_today, CURRENT_DATE);
BEGIN
  -- 1. Complete the phase - end_date is the ACTUAL completion date
  --    (coach-local when the caller supplies p_today).
  UPDATE phases
  SET status = 'completed',
      end_date = v_today,
      coach_reflection = p_coach_reflection,
      phase_summary = p_phase_summary,
      updated_at = NOW()
  WHERE id = p_phase_id
  RETURNING roadmap_id INTO v_roadmap_id;

  IF v_roadmap_id IS NULL THEN
    RAISE EXCEPTION 'Phase not found: %', p_phase_id;
  END IF;

  -- 2. Archive plans if requested
  IF p_archive_training THEN
    UPDATE training_plans SET status = 'archived', updated_at = NOW()
      WHERE phase_id = p_phase_id AND status = 'active';
  END IF;
  IF p_archive_nutrition THEN
    UPDATE nutrition_plans SET status = 'archived', updated_at = NOW()
      WHERE phase_id = p_phase_id AND status = 'active';
  END IF;
  IF p_archive_habits THEN
    UPDATE daily_habits SET is_active = false, updated_at = NOW()
      WHERE phase_id = p_phase_id AND is_active = true;
  END IF;

  -- 3. Handle next action
  IF p_next_action = 'activate_next' THEN
    SELECT id INTO v_next_phase_id FROM phases
      WHERE roadmap_id = v_roadmap_id AND status = 'planned'
      ORDER BY order_index ASC LIMIT 1;
    IF v_next_phase_id IS NOT NULL THEN
      UPDATE phases SET status = 'active', start_date = COALESCE(start_date, v_today), updated_at = NOW()
        WHERE id = v_next_phase_id;
    END IF;
  ELSIF p_next_action = 'archive_roadmap' THEN
    UPDATE phases SET status = 'skipped', updated_at = NOW()
      WHERE roadmap_id = v_roadmap_id AND status = 'planned';
    UPDATE roadmaps SET status = 'archived', updated_at = NOW()
      WHERE id = v_roadmap_id;
  END IF;

  -- 4. Write nextPhaseId into the summary JSONB (the RPC knows it, the caller does not)
  IF v_next_phase_id IS NOT NULL THEN
    UPDATE phases SET phase_summary = jsonb_set(phase_summary, '{nextPhaseId}', to_jsonb(v_next_phase_id::TEXT))
      WHERE id = p_phase_id;
  END IF;

  RETURN COALESCE(v_next_phase_id, p_phase_id);
END;
$$;


ALTER FUNCTION "public"."transition_phase_atomic"("p_phase_id" "uuid", "p_coach_reflection" "text", "p_phase_summary" "jsonb", "p_next_action" "text", "p_archive_training" boolean, "p_archive_nutrition" boolean, "p_archive_habits" boolean, "p_today" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_adherence_on_check_in"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  PERFORM update_client_adherence_stats(NEW.client_id);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_adherence_on_check_in"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_adherence_on_check_in"() IS 'Automatically updates client adherence stats when a new check-in is submitted';



CREATE OR REPLACE FUNCTION "public"."update_client_adherence_stats"("client_uuid" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  stats RECORD;
BEGIN
  -- Get calculated stats
  SELECT * INTO stats
  FROM calculate_client_adherence_stats(client_uuid);

  -- Update client record
  UPDATE clients
  SET
    total_check_ins_expected = stats.expected_count,
    total_check_ins_completed = stats.actual_count,
    check_in_adherence_rate = stats.adherence_rate,
    updated_at = NOW()
  WHERE id = client_uuid;
END;
$$;


ALTER FUNCTION "public"."update_client_adherence_stats"("client_uuid" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_client_adherence_stats"("client_uuid" "uuid") IS 'Updates adherence statistics for a client based on their check-in history';



CREATE OR REPLACE FUNCTION "public"."update_content_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_content_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_meal_plan_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_meal_plan_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_profiles_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_profiles_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_training_plan_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_training_plan_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_daily_log_atomic"("p_client_id" "uuid", "p_date" "date", "p_notes" "text", "p_wellness" "jsonb", "p_nutrition" "jsonb", "p_training" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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
      daily_log_id, client_id, date,
      calories_consumed, protein_g, carbs_g, fat_g,
      target_calories, target_protein_g, target_carbs_g, target_fat_g,
      nutrition_adherence, calorie_surplus_deficit, updated_at
    )
    VALUES (
      v_log_id, p_client_id, p_date,
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
      daily_log_id, client_id, date,
      trained, training_session_id, training_data, updated_at
    )
    VALUES (
      v_log_id, p_client_id, p_date,
      (p_training->>'trained')::BOOLEAN,
      NULLIF(p_training->>'training_session_id', '')::UUID,
      p_training->'training_data',
      NOW()
    )
    ON CONFLICT (daily_log_id)
    DO UPDATE SET
      trained = EXCLUDED.trained,
      training_session_id = EXCLUDED.training_session_id,
      training_data = EXCLUDED.training_data,
      updated_at = NOW();
  END IF;

  RETURN v_log_id;
END;
$$;


ALTER FUNCTION "public"."upsert_daily_log_atomic"("p_client_id" "uuid", "p_date" "date", "p_notes" "text", "p_wellness" "jsonb", "p_nutrition" "jsonb", "p_training" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_daily_log_atomic"("p_client_id" "uuid", "p_date" "date", "p_notes" "text", "p_wellness" "jsonb", "p_nutrition" "jsonb", "p_training" "jsonb", "p_nutrition_plan_id" "uuid" DEFAULT NULL::"uuid", "p_training_plan_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."upsert_daily_log_atomic"("p_client_id" "uuid", "p_date" "date", "p_notes" "text", "p_wellness" "jsonb", "p_nutrition" "jsonb", "p_training" "jsonb", "p_nutrition_plan_id" "uuid", "p_training_plan_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."attention_dismissals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coach_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "alert_type" "text" NOT NULL,
    "dismissed_at" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."attention_dismissals" OWNER TO "postgres";


COMMENT ON TABLE "public"."attention_dismissals" IS 'Coach-dismissed attention alerts. RLS enabled with no policies (deny-all): all access is via service_role.';



CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_id" "uuid",
    "actor_role" "text",
    "action" "text" NOT NULL,
    "target_table" "text",
    "target_id" "uuid",
    "client_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "ip_hash" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."body_metrics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "weight" numeric,
    "weight_unit" "text",
    "body_fat_percentage" numeric,
    "bmr" integer,
    "tdee" integer,
    "source" "text" NOT NULL,
    "source_id" "uuid",
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."body_metrics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."check_in_exercise_highlights" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "check_in_id" "uuid" NOT NULL,
    "exercise_id" "uuid",
    "exercise_name" "text" NOT NULL,
    "highlight_type" "text" NOT NULL,
    "details" "text",
    "weight_value" numeric(6,2),
    "weight_unit" "text",
    "reps" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "check_in_exercise_highlights_highlight_type_check" CHECK (("highlight_type" = ANY (ARRAY['pr'::"text", 'struggle'::"text", 'note'::"text"]))),
    CONSTRAINT "check_in_exercise_highlights_weight_unit_check" CHECK (("weight_unit" = ANY (ARRAY['lbs'::"text", 'kg'::"text"])))
);


ALTER TABLE "public"."check_in_exercise_highlights" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."check_in_reminders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"(),
    "reminder_type" "text" NOT NULL,
    "days_overdue" integer,
    "responded" boolean DEFAULT false,
    "responded_at" timestamp with time zone,
    "check_in_id" "uuid",
    "sent_via" "text" DEFAULT 'system'::"text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "check_in_reminders_reminder_type_check" CHECK (("reminder_type" = ANY (ARRAY['upcoming'::"text", 'overdue'::"text", 'follow_up'::"text"]))),
    CONSTRAINT "check_in_reminders_sent_via_check" CHECK (("sent_via" = ANY (ARRAY['system'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."check_in_reminders" OWNER TO "postgres";


COMMENT ON TABLE "public"."check_in_reminders" IS 'Tracks all check-in reminders sent to clients and their responses';



COMMENT ON COLUMN "public"."check_in_reminders"."reminder_type" IS 'Type of reminder: upcoming (before due), overdue (past due), follow_up (multiple days overdue)';



COMMENT ON COLUMN "public"."check_in_reminders"."days_overdue" IS 'Number of days overdue when reminder was sent (NULL if not overdue yet)';



COMMENT ON COLUMN "public"."check_in_reminders"."responded" IS 'Whether client submitted a check-in after this reminder';



COMMENT ON COLUMN "public"."check_in_reminders"."sent_via" IS 'How reminder was sent: system (automated) or manual (coach-initiated)';



CREATE TABLE IF NOT EXISTS "public"."check_in_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone,
    "check_in_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "client_id" "uuid" NOT NULL
);


ALTER TABLE "public"."check_in_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."check_ins" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "mood" integer,
    "energy" integer,
    "sleep" integer,
    "stress" integer,
    "notes" "text",
    "weight" numeric(5,1),
    "weight_unit" "text" DEFAULT 'lbs'::"text",
    "body_fat_percentage" numeric(4,1),
    "waist" numeric(4,1),
    "hips" numeric(4,1),
    "chest" numeric(4,1),
    "arms" numeric(4,1),
    "thighs" numeric(4,1),
    "measurement_unit" "text" DEFAULT 'in'::"text",
    "photo_front" "text",
    "photo_side" "text",
    "photo_back" "text",
    "workouts_completed" integer,
    "adherence_percentage" integer,
    "prs" "text",
    "challenges" "text",
    "ai_summary" "text",
    "ai_insights" "jsonb",
    "ai_recommendations" "jsonb",
    "ai_response_draft" "text",
    "ai_processed_at" timestamp with time zone,
    "coach_response" "text",
    "coach_reviewed_at" timestamp with time zone,
    "response_sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "client_id" "uuid" NOT NULL,
    "nutrition_days_on_target" integer,
    "nutrition_notes" "text",
    "daily_logs_start_date" "date",
    "daily_logs_end_date" "date",
    "uses_daily_logs" boolean DEFAULT false NOT NULL,
    "period_start" "date",
    "period_end" "date",
    "period_snapshot" "jsonb",
    CONSTRAINT "check_ins_adherence_percentage_check" CHECK ((("adherence_percentage" >= 0) AND ("adherence_percentage" <= 100))),
    CONSTRAINT "check_ins_energy_check" CHECK ((("energy" >= 1) AND ("energy" <= 10))),
    CONSTRAINT "check_ins_measurement_unit_check" CHECK (("measurement_unit" = ANY (ARRAY['in'::"text", 'cm'::"text"]))),
    CONSTRAINT "check_ins_mood_check" CHECK ((("mood" >= 1) AND ("mood" <= 5))),
    CONSTRAINT "check_ins_nutrition_days_on_target_check" CHECK ((("nutrition_days_on_target" >= 0) AND ("nutrition_days_on_target" <= 7))),
    CONSTRAINT "check_ins_sleep_check" CHECK ((("sleep" >= 1) AND ("sleep" <= 10))),
    CONSTRAINT "check_ins_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'ai_processed'::"text", 'reviewed'::"text"]))),
    CONSTRAINT "check_ins_stress_check" CHECK ((("stress" >= 1) AND ("stress" <= 10))),
    CONSTRAINT "check_ins_weight_unit_check" CHECK (("weight_unit" = ANY (ARRAY['lbs'::"text", 'kg'::"text"])))
);


ALTER TABLE "public"."check_ins" OWNER TO "postgres";


COMMENT ON COLUMN "public"."check_ins"."daily_logs_start_date" IS 'Start date of the daily logs period this check-in covers (inclusive). NULL for legacy check-ins.';



COMMENT ON COLUMN "public"."check_ins"."daily_logs_end_date" IS 'End date of the daily logs period this check-in covers (inclusive). NULL for legacy check-ins.';



COMMENT ON COLUMN "public"."check_ins"."uses_daily_logs" IS 'Whether this check-in was populated from daily logs data or uses legacy manual inputs.';



COMMENT ON COLUMN "public"."check_ins"."period_snapshot" IS 'Frozen training+nutrition schedule snapshot. Written at submission, never updated.';



CREATE TABLE IF NOT EXISTS "public"."client_goals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "goal_weight" numeric,
    "goal_body_fat_percentage" numeric,
    "goal_deadline" "date",
    "primary_goal" "text",
    "set_by" "text" DEFAULT 'coach'::"text" NOT NULL,
    "notes" "text",
    "effective_from" timestamp with time zone DEFAULT "now"() NOT NULL,
    "superseded_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "goal_start_date" "date"
);


ALTER TABLE "public"."client_goals" OWNER TO "postgres";


COMMENT ON COLUMN "public"."client_goals"."goal_start_date" IS 'Optional anchor for the long-term goal pace window (start → goal_deadline). NULL falls back to today in the resolver. Phase-scoped goals use the phase start_date instead.';



CREATE TABLE IF NOT EXISTS "public"."client_intake" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "primary_goal" "text",
    "goal_details" "text",
    "date_of_birth" "date",
    "gender" "text",
    "height" numeric,
    "height_unit" "text" DEFAULT 'cm'::"text",
    "current_weight" numeric,
    "weight_unit" "text" DEFAULT 'kg'::"text",
    "work_activity_level" "text",
    "dietary_requirements" "text"[] DEFAULT '{}'::"text"[],
    "cooking_frequency" "text",
    "nutrition_notes" "text",
    "training_experience_level" "text",
    "training_time_preference" "text",
    "training_location" "text",
    "available_equipment" "text"[] DEFAULT '{}'::"text"[],
    "days_per_week" integer,
    "session_duration_minutes" integer,
    "injuries_or_limitations" "text",
    "medical_notes" "text",
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "body_fat_percentage" numeric,
    "target_weight" numeric,
    "goal_deadline" "date",
    "goal_description" "text",
    "motivation" "text",
    "food_allergies" "text",
    "diet_description" "text",
    "has_tracked_macros_before" boolean,
    "meals_per_day" integer,
    "biggest_nutrition_challenge" "text",
    "previous_coaching_experience" boolean,
    "previous_coaching_details" "text",
    "anything_else" "text",
    "started_at" timestamp with time zone,
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "uuid",
    "coach_review_notes" "text",
    "goal_body_fat_percentage" numeric(4,2),
    CONSTRAINT "client_intake_body_fat_check" CHECK ((("body_fat_percentage" >= (3)::numeric) AND ("body_fat_percentage" <= (60)::numeric))),
    CONSTRAINT "client_intake_cooking_frequency_check" CHECK (("cooking_frequency" = ANY (ARRAY['mostly_cook'::"text", 'mix_of_both'::"text", 'mostly_eat_out'::"text", 'meal_prep'::"text"]))),
    CONSTRAINT "client_intake_current_weight_check" CHECK ((("current_weight" >= (30)::numeric) AND ("current_weight" <= (300)::numeric))),
    CONSTRAINT "client_intake_days_per_week_check" CHECK ((("days_per_week" >= 1) AND ("days_per_week" <= 7))),
    CONSTRAINT "client_intake_gender_check" CHECK (("gender" = ANY (ARRAY['male'::"text", 'female'::"text", 'other'::"text", 'prefer_not_to_say'::"text"]))),
    CONSTRAINT "client_intake_height_check" CHECK ((("height" >= (100)::numeric) AND ("height" <= (250)::numeric))),
    CONSTRAINT "client_intake_height_unit_check" CHECK (("height_unit" = ANY (ARRAY['cm'::"text", 'in'::"text"]))),
    CONSTRAINT "client_intake_meals_per_day_check" CHECK ((("meals_per_day" >= 1) AND ("meals_per_day" <= 8))),
    CONSTRAINT "client_intake_primary_goal_check" CHECK (("primary_goal" = ANY (ARRAY['lose_weight'::"text", 'build_muscle'::"text", 'recomposition'::"text", 'general_fitness'::"text", 'event_prep'::"text", 'maintain'::"text"]))),
    CONSTRAINT "client_intake_session_duration_check" CHECK ((("session_duration_minutes" >= 15) AND ("session_duration_minutes" <= 180))),
    CONSTRAINT "client_intake_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'completed'::"text", 'reviewed'::"text"]))),
    CONSTRAINT "client_intake_target_weight_check" CHECK ((("target_weight" >= (30)::numeric) AND ("target_weight" <= (300)::numeric))),
    CONSTRAINT "client_intake_training_experience_level_check" CHECK (("training_experience_level" = ANY (ARRAY['complete_beginner'::"text", 'some_experience'::"text", 'intermediate'::"text", 'advanced'::"text"]))),
    CONSTRAINT "client_intake_training_location_check" CHECK (("training_location" = ANY (ARRAY['commercial_gym'::"text", 'home_gym'::"text", 'home_no_equipment'::"text", 'outdoor'::"text", 'mixed'::"text"]))),
    CONSTRAINT "client_intake_training_time_preference_check" CHECK (("training_time_preference" = ANY (ARRAY['morning'::"text", 'midday'::"text", 'evening'::"text", 'flexible'::"text"]))),
    CONSTRAINT "client_intake_weight_unit_check" CHECK (("weight_unit" = ANY (ARRAY['kg'::"text", 'lb'::"text"]))),
    CONSTRAINT "client_intake_work_activity_level_check" CHECK (("work_activity_level" = ANY (ARRAY['sedentary'::"text", 'lightly_active'::"text", 'moderately_active'::"text", 'very_active'::"text", 'extremely_active'::"text"])))
);


ALTER TABLE "public"."client_intake" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "invited_at" timestamp with time zone,
    "accepted_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "token" "text",
    "email" "text" NOT NULL,
    CONSTRAINT "client_invitations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'accepted'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."client_invitations" OWNER TO "postgres";


COMMENT ON COLUMN "public"."client_invitations"."token" IS 'Secure random token for invitation links, replaces Supabase magic links';



COMMENT ON COLUMN "public"."client_invitations"."email" IS 'Client email address for invitation, cached for performance';



CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coach_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "avatar_url" "text",
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "notes" "text",
    "check_in_frequency" "text" DEFAULT 'weekly'::"text",
    "check_in_frequency_days" integer,
    "expected_check_in_day" "text",
    "last_reminder_sent_at" timestamp with time zone,
    "reminder_preferences" "jsonb" DEFAULT '{"enabled": true, "autoSend": false, "sendBeforeHours": 24}'::"jsonb",
    "total_check_ins_expected" integer DEFAULT 0,
    "total_check_ins_completed" integer DEFAULT 0,
    "check_in_adherence_rate" numeric(5,2) DEFAULT 0,
    "current_streak" integer DEFAULT 0,
    "longest_streak" integer DEFAULT 0,
    "goal_weight" numeric(5,1),
    "weight_unit" "text" DEFAULT 'lbs'::"text",
    "current_weight" numeric(5,1),
    "current_body_fat_percentage" numeric(4,2),
    "goal_body_fat_percentage" numeric(4,2),
    "height" numeric(5,2),
    "height_unit" "text" DEFAULT 'in'::"text",
    "gender" "text",
    "bmr" numeric(6,1),
    "tdee" numeric(6,1),
    "date_of_birth" "date",
    "unit_preference" "text" DEFAULT 'imperial'::"text",
    "goal_deadline" "date",
    "bmr_manual_override" boolean DEFAULT false,
    "tdee_manual_override" boolean DEFAULT false,
    "starting_weight" numeric(6,2),
    "starting_body_fat_percentage" numeric(4,1),
    "user_id" "uuid",
    "include_activity_burn" boolean DEFAULT true NOT NULL,
    "onboarding_status" "text" DEFAULT 'active'::"text",
    "welcome_message" "text",
    "walkthrough_completed_at" timestamp with time zone,
    "start_date" "date",
    "work_activity_level" "text" DEFAULT 'sedentary'::"text",
    "timezone" "text" DEFAULT 'UTC'::"text" NOT NULL,
    "surplus_as_carbs" boolean DEFAULT false NOT NULL,
    CONSTRAINT "clients_check_in_frequency_check" CHECK (("check_in_frequency" = ANY (ARRAY['weekly'::"text", 'biweekly'::"text", 'monthly'::"text", 'custom'::"text", 'none'::"text"]))),
    CONSTRAINT "clients_expected_check_in_day_check" CHECK ((("expected_check_in_day" IS NULL) OR ("expected_check_in_day" = ANY (ARRAY['monday'::"text", 'tuesday'::"text", 'wednesday'::"text", 'thursday'::"text", 'friday'::"text", 'saturday'::"text", 'sunday'::"text"])))),
    CONSTRAINT "clients_gender_check" CHECK (("gender" = ANY (ARRAY['male'::"text", 'female'::"text", 'other'::"text"]))),
    CONSTRAINT "clients_height_unit_check" CHECK (("height_unit" = ANY (ARRAY['in'::"text", 'cm'::"text"]))),
    CONSTRAINT "clients_onboarding_status_check" CHECK (("onboarding_status" = ANY (ARRAY['pending_intake'::"text", 'intake_completed'::"text", 'setup_in_progress'::"text", 'active'::"text", 'paused'::"text"]))),
    CONSTRAINT "clients_timezone_check" CHECK (("timezone" ~ '^[A-Za-z_+\-/]+$'::"text")),
    CONSTRAINT "clients_unit_preference_check" CHECK (("unit_preference" = ANY (ARRAY['metric'::"text", 'imperial'::"text"]))),
    CONSTRAINT "clients_weight_unit_check" CHECK (("weight_unit" = ANY (ARRAY['lbs'::"text", 'kg'::"text"]))),
    CONSTRAINT "clients_work_activity_level_check" CHECK (("work_activity_level" = ANY (ARRAY['sedentary'::"text", 'lightly_active'::"text", 'moderately_active'::"text", 'very_active'::"text", 'extremely_active'::"text"])))
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


COMMENT ON COLUMN "public"."clients"."notes" IS 'Optional notes or description about the client';



COMMENT ON COLUMN "public"."clients"."check_in_frequency" IS 'Expected check-in frequency: weekly, biweekly, monthly, custom, none';



COMMENT ON COLUMN "public"."clients"."check_in_frequency_days" IS 'Number of days between check-ins when frequency is set to custom';



COMMENT ON COLUMN "public"."clients"."expected_check_in_day" IS 'Optional specific day of week when check-in is expected';



COMMENT ON COLUMN "public"."clients"."last_reminder_sent_at" IS 'Timestamp of the last reminder sent to this client';



COMMENT ON COLUMN "public"."clients"."reminder_preferences" IS 'Reminder settings: {enabled, autoSend, sendBeforeHours}. Migration 092 normalised legacy snake_case keys to camelCase.';



COMMENT ON COLUMN "public"."clients"."check_in_adherence_rate" IS 'Percentage of expected check-ins completed (0-100)';



COMMENT ON COLUMN "public"."clients"."current_streak" IS 'Number of consecutive on-time check-ins';



COMMENT ON COLUMN "public"."clients"."longest_streak" IS 'Highest consecutive on-time check-ins achieved';



COMMENT ON COLUMN "public"."clients"."goal_weight" IS 'Target weight goal for the client (static until manually updated by coach)';



COMMENT ON COLUMN "public"."clients"."weight_unit" IS 'Preferred unit of measurement for weight (lbs or kg)';



COMMENT ON COLUMN "public"."clients"."current_weight" IS 'Current weight of the client (automatically updated from latest check-in)';



COMMENT ON COLUMN "public"."clients"."current_body_fat_percentage" IS 'Current body fat percentage (automatically updated from latest check-in)';



COMMENT ON COLUMN "public"."clients"."goal_body_fat_percentage" IS 'Target body fat percentage goal (static until manually updated by coach)';



COMMENT ON COLUMN "public"."clients"."height" IS 'Height of the client (static field)';



COMMENT ON COLUMN "public"."clients"."height_unit" IS 'Unit of measurement for height (in or cm)';



COMMENT ON COLUMN "public"."clients"."gender" IS 'Gender of the client for BMR calculations';



COMMENT ON COLUMN "public"."clients"."bmr" IS 'Basal Metabolic Rate calculated by AI';



COMMENT ON COLUMN "public"."clients"."tdee" IS 'Total Daily Energy Expenditure (BMR × activity factor)';



COMMENT ON COLUMN "public"."clients"."date_of_birth" IS 'Client''s date of birth for accurate BMR and age-related calculations';



COMMENT ON COLUMN "public"."clients"."unit_preference" IS 'Client unit preference: metric (kg, cm) or imperial (lbs, inches)';



COMMENT ON COLUMN "public"."clients"."goal_deadline" IS 'Target date to reach goal weight';



COMMENT ON COLUMN "public"."clients"."bmr_manual_override" IS 'When true, BMR will not be auto-recalculated when weight/height/age changes';



COMMENT ON COLUMN "public"."clients"."tdee_manual_override" IS 'When true, TDEE will not be auto-recalculated when BMR changes';



COMMENT ON COLUMN "public"."clients"."starting_weight" IS 'Original weight at client intake, used for goal progress tracking';



COMMENT ON COLUMN "public"."clients"."starting_body_fat_percentage" IS 'Original body fat percentage at client intake, used for goal progress tracking';



COMMENT ON COLUMN "public"."clients"."work_activity_level" IS 'Work activity level for TDEE calculation (sedentary=1.2x to extremely_active=1.9x)';



COMMENT ON COLUMN "public"."clients"."timezone" IS 'IANA time zone (e.g. America/Los_Angeles). Default UTC for pre-backfill rows; Settings UI in Session 2.6 lets clients pick theirs.';



CREATE TABLE IF NOT EXISTS "public"."coach_client_views" (
    "coach_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "last_viewed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."coach_client_views" OWNER TO "postgres";


COMMENT ON TABLE "public"."coach_client_views" IS 'Coach last-viewed-client state. RLS enabled with no policies (deny-all): all access is via service_role.';



COMMENT ON COLUMN "public"."coach_client_views"."last_viewed_at" IS 'When the coach last opened this client''s overview tab. Last-write-wins upsert; doubles as the row update timestamp, so created_at/updated_at are intentionally omitted.';



CREATE TABLE IF NOT EXISTS "public"."coach_saved_exercises" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "saved_session_id" "uuid" NOT NULL,
    "exercise_id" "uuid",
    "name" "text" NOT NULL,
    "order_index" integer DEFAULT 0 NOT NULL,
    "sets" integer DEFAULT 3 NOT NULL,
    "reps_min" integer,
    "reps_max" integer,
    "reps_target" "text",
    "rpe_target" numeric,
    "percentage_1rm" numeric,
    "tempo" "text",
    "rest_seconds" integer,
    "superset_group" "text",
    "is_warmup" boolean DEFAULT false,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "set_specs" "jsonb",
    "video_url" "text"
);


ALTER TABLE "public"."coach_saved_exercises" OWNER TO "postgres";


COMMENT ON TABLE "public"."coach_saved_exercises" IS 'Coach library exercise rows. RLS enabled with no policies (deny-all): all access is via service_role.';



CREATE TABLE IF NOT EXISTS "public"."coach_saved_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coach_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "split_type" "text",
    "frequency_per_week" integer,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "cycle_length" integer,
    "rest_pattern" integer[] DEFAULT '{}'::integer[],
    "default_surplus_percentage" numeric DEFAULT 15,
    "source" "text" DEFAULT 'manual'::"text",
    "coach_prompt" "text",
    "program_duration_weeks" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "coach_saved_plans_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'saved'::"text"])))
);


ALTER TABLE "public"."coach_saved_plans" OWNER TO "postgres";


COMMENT ON TABLE "public"."coach_saved_plans" IS 'Coach program library. RLS enabled with no policies (deny-all): all access is via service_role.';



CREATE TABLE IF NOT EXISTS "public"."coach_saved_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coach_id" "uuid" NOT NULL,
    "saved_plan_id" "uuid",
    "name" "text" NOT NULL,
    "focus" "text",
    "order_index" integer DEFAULT 0 NOT NULL,
    "is_rest" boolean DEFAULT false,
    "estimated_duration_minutes" integer,
    "calorie_surplus_percentage" numeric,
    "notes" "text",
    "session_type" "text" DEFAULT 'training'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "week_index" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."coach_saved_sessions" OWNER TO "postgres";


COMMENT ON TABLE "public"."coach_saved_sessions" IS 'Coach session library. RLS enabled with no policies (deny-all): all access is via service_role.';



CREATE TABLE IF NOT EXISTS "public"."coaches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "avatar_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "timezone" "text" DEFAULT 'UTC'::"text" NOT NULL,
    CONSTRAINT "coaches_timezone_check" CHECK (("timezone" ~ '^[A-Za-z_+\-/]+$'::"text"))
);


ALTER TABLE "public"."coaches" OWNER TO "postgres";


COMMENT ON COLUMN "public"."coaches"."timezone" IS 'IANA time zone (e.g. America/Los_Angeles), auto-synced from the coach''s device on app load (Session 7.81). Default UTC until first sync.';



CREATE TABLE IF NOT EXISTS "public"."content_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "content_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "assigned_by" "uuid" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."content_assignments" OWNER TO "postgres";


COMMENT ON TABLE "public"."content_assignments" IS 'Tracks which content items are specifically assigned to individual clients';



CREATE TABLE IF NOT EXISTS "public"."content_folders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coach_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "parent_folder_id" "uuid",
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."content_folders" OWNER TO "postgres";


COMMENT ON TABLE "public"."content_folders" IS 'Organizes content into folders for coaches, supports one level of nesting';



CREATE TABLE IF NOT EXISTS "public"."content_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coach_id" "uuid" NOT NULL,
    "folder_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "type" "public"."content_type" NOT NULL,
    "url" "text",
    "storage_path" "text",
    "file_name" "text",
    "file_size" bigint,
    "mime_type" "text",
    "thumbnail_url" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "is_library" boolean DEFAULT true,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "content_url_or_storage" CHECK (((("type" = ANY (ARRAY['video_link'::"public"."content_type", 'hyperlink'::"public"."content_type"])) AND ("url" IS NOT NULL)) OR (("type" = ANY (ARRAY['pdf'::"public"."content_type", 'image'::"public"."content_type", 'document'::"public"."content_type"])) AND ("storage_path" IS NOT NULL))))
);


ALTER TABLE "public"."content_items" OWNER TO "postgres";


COMMENT ON TABLE "public"."content_items" IS 'Stores all content types (videos, links, PDFs, images, documents) for coach libraries';



COMMENT ON COLUMN "public"."content_items"."metadata" IS 'Stores oEmbed data, Open Graph tags, and other metadata for content';



COMMENT ON COLUMN "public"."content_items"."is_library" IS 'When true, content is visible to all of the coach''s clients';



CREATE TABLE IF NOT EXISTS "public"."daily_habit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "daily_habit_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "completed" boolean DEFAULT false NOT NULL,
    "value" numeric,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "phase_id" "uuid"
);


ALTER TABLE "public"."daily_habit_logs" OWNER TO "postgres";


COMMENT ON TABLE "public"."daily_habit_logs" IS 'Daily completion logs for client habits';



CREATE TABLE IF NOT EXISTS "public"."daily_habits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coach_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "target_value" numeric,
    "target_unit" "text",
    "is_boolean" boolean DEFAULT true NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "phase_id" "uuid",
    "effective_date" "date" DEFAULT CURRENT_DATE NOT NULL
);


ALTER TABLE "public"."daily_habits" OWNER TO "postgres";


COMMENT ON TABLE "public"."daily_habits" IS 'Coach-defined habits for clients to track daily (e.g., water intake, steps, meditation)';



COMMENT ON COLUMN "public"."daily_habits"."target_value" IS 'Target value for non-boolean habits (e.g., 8 for water glasses)';



COMMENT ON COLUMN "public"."daily_habits"."target_unit" IS 'Unit for target value (e.g., glasses, steps, minutes)';



COMMENT ON COLUMN "public"."daily_habits"."is_boolean" IS 'True for yes/no habits, false for value-based habits';



CREATE TABLE IF NOT EXISTS "public"."daily_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "phase_id" "uuid"
);


ALTER TABLE "public"."daily_logs" OWNER TO "postgres";


COMMENT ON TABLE "public"."daily_logs" IS 'Daily wellness and training logs submitted by clients. One entry per client per day.';



COMMENT ON COLUMN "public"."daily_logs"."notes" IS 'Optional notes from client about their day';



CREATE TABLE IF NOT EXISTS "public"."nutrition_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "daily_log_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "calories_consumed" integer,
    "protein_g" integer,
    "carbs_g" integer,
    "fat_g" integer,
    "target_calories" integer,
    "target_protein_g" integer,
    "target_carbs_g" integer,
    "target_fat_g" integer,
    "nutrition_adherence" "text",
    "calorie_surplus_deficit" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "nutrition_plan_id" "uuid"
);


ALTER TABLE "public"."nutrition_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."training_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "daily_log_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "trained" boolean DEFAULT false,
    "training_session_id" "uuid",
    "training_data" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "training_plan_id" "uuid"
);


ALTER TABLE "public"."training_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wellness_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "daily_log_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "mood" integer,
    "energy" integer,
    "sleep" integer,
    "stress" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."wellness_logs" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."daily_logs_full" WITH ("security_invoker"='on') AS
 SELECT "dl"."id",
    "dl"."client_id",
    "dl"."date",
    "dl"."notes",
    "dl"."phase_id",
    "dl"."created_at",
    "dl"."updated_at",
    "wl"."mood",
    "wl"."energy",
    "wl"."sleep",
    "wl"."stress",
    "nl"."calories_consumed",
    "nl"."protein_g",
    "nl"."carbs_g",
    "nl"."fat_g",
    "nl"."target_calories",
    "nl"."target_protein_g",
    "nl"."target_carbs_g",
    "nl"."target_fat_g",
    "nl"."nutrition_adherence",
    "nl"."calorie_surplus_deficit",
    "tl"."trained",
    "tl"."training_session_id",
    "tl"."training_data"
   FROM ((("public"."daily_logs" "dl"
     LEFT JOIN "public"."wellness_logs" "wl" ON (("wl"."daily_log_id" = "dl"."id")))
     LEFT JOIN "public"."nutrition_logs" "nl" ON (("nl"."daily_log_id" = "dl"."id")))
     LEFT JOIN "public"."training_logs" "tl" ON (("tl"."daily_log_id" = "dl"."id")));


ALTER VIEW "public"."daily_logs_full" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exercise_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_log_id" "uuid" NOT NULL,
    "training_exercise_id" "uuid",
    "completed" boolean DEFAULT false,
    "weight_unit" "text" DEFAULT 'lbs'::"text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "prescribed_exercise_snapshot" "jsonb",
    "exercise_id" "uuid",
    "performed_name" "text",
    CONSTRAINT "client_exercise_completions_weight_unit_check" CHECK (("weight_unit" = ANY (ARRAY['lbs'::"text", 'kg'::"text"])))
);


ALTER TABLE "public"."exercise_logs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."exercise_logs"."exercise_id" IS 'Optional FK to global exercises catalog. Populated when the client selected an exercise from the typeahead picker (Add unplanned, Swap). NULL for prescribed-without-swap and for freehand entries.';



COMMENT ON COLUMN "public"."exercise_logs"."performed_name" IS 'Name of the exercise the client actually performed. Differs from prescribed_exercise_snapshot.name when the client swapped a prescribed exercise or added a freehand unplanned one. NULL on legacy rows; new writes always populate.';



CREATE TABLE IF NOT EXISTS "public"."exercises" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coach_id" "uuid",
    "name" "text" NOT NULL,
    "muscle_group" "text",
    "equipment" "text",
    "category" "text",
    "aliases" "text"[] DEFAULT '{}'::"text"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."exercises" OWNER TO "postgres";


COMMENT ON TABLE "public"."exercises" IS 'Two-tier exercise catalog (coach_id NULL = global). RLS enabled with no policies (deny-all): all access is via service_role.';



CREATE TABLE IF NOT EXISTS "public"."nutrition_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "nutrition_plan_id" "uuid",
    "date" "date" NOT NULL,
    "day_of_week" "text" NOT NULL,
    "baseline_calories" integer NOT NULL,
    "training_burn_calories" integer DEFAULT 0 NOT NULL,
    "protein_g" numeric NOT NULL,
    "carb_g" numeric NOT NULL,
    "fat_g" numeric NOT NULL,
    "diet_type" "text" DEFAULT 'balanced'::"text" NOT NULL,
    "is_training_day" boolean DEFAULT false NOT NULL,
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "calorie_surplus_percentage" numeric,
    "is_modified" boolean DEFAULT false NOT NULL,
    "note" "text",
    CONSTRAINT "nutrition_events_status_check" CHECK (("status" = ANY (ARRAY['scheduled'::"text", 'logged'::"text", 'missed'::"text"])))
);


ALTER TABLE "public"."nutrition_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nutrition_plan_daily_targets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nutrition_plan_id" "uuid" NOT NULL,
    "day_of_week" "text" NOT NULL,
    "calories" integer NOT NULL,
    "protein_g" numeric NOT NULL,
    "carb_g" numeric NOT NULL,
    "fat_g" numeric NOT NULL,
    "is_training_day" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."nutrition_plan_daily_targets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nutrition_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "coach_id" "uuid" NOT NULL,
    "name" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "effective_from" "date" NOT NULL,
    "effective_until" "date",
    "work_activity_level" "text" NOT NULL,
    "training_volume_hours" "text" NOT NULL,
    "protein_target_g_per_kg" numeric DEFAULT 2.0 NOT NULL,
    "diet_type" "text" DEFAULT 'balanced'::"text" NOT NULL,
    "goal_weight_kg" numeric,
    "goal_deadline" "date",
    "baseline_calories" integer NOT NULL,
    "protein_target_g" numeric NOT NULL,
    "carb_target_g" numeric NOT NULL,
    "fat_target_g" numeric NOT NULL,
    "base_weight_kg" numeric NOT NULL,
    "bmr" numeric,
    "tdee" numeric,
    "custom_macros_enabled" boolean DEFAULT false NOT NULL,
    "custom_calories" integer,
    "custom_protein_g" numeric,
    "custom_carb_g" numeric,
    "custom_fat_g" numeric,
    "regeneration_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "phase_id" "uuid",
    "coach_notes" "text",
    "goal_source" "text"
);


ALTER TABLE "public"."nutrition_plans" OWNER TO "postgres";


COMMENT ON COLUMN "public"."nutrition_plans"."coach_notes" IS 'Optional note written by coach at plan creation or regeneration';



COMMENT ON COLUMN "public"."nutrition_plans"."goal_source" IS 'Which goal drove the calorie calculation: "phase" or "client"';



CREATE TABLE IF NOT EXISTS "public"."nutrition_weekly_summaries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "week_start_date" "date" NOT NULL,
    "weekly_calorie_target" integer NOT NULL,
    "weekly_protein_target_g" integer,
    "weekly_carbs_target_g" integer,
    "weekly_fat_target_g" integer,
    "training_days_per_week" integer DEFAULT 0,
    "rest_days_per_week" integer DEFAULT 0,
    "days_completed" integer DEFAULT 0,
    "total_days" integer DEFAULT 7,
    "completion_percentage" numeric(5,2) DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "week_end_date" "date",
    "total_calories_consumed" numeric(8,1),
    "total_protein_consumed_g" numeric(7,2),
    "total_carbs_consumed_g" numeric(7,2),
    "total_fat_consumed_g" numeric(7,2),
    "calorie_difference" numeric(8,1),
    "adherence_percentage" numeric(5,1),
    "weekly_adherence" "text",
    "days_logged" integer DEFAULT 0,
    "days_on_target" integer DEFAULT 0,
    "days_over" integer DEFAULT 0,
    "days_under" integer DEFAULT 0,
    CONSTRAINT "nutrition_weekly_summaries_weekly_adherence_check" CHECK (("weekly_adherence" = ANY (ARRAY['hit'::"text", 'partial'::"text", 'missed'::"text"])))
);


ALTER TABLE "public"."nutrition_weekly_summaries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."phases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "roadmap_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "objectives" "text",
    "order_index" integer DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'planned'::"text" NOT NULL,
    "start_date" "date",
    "end_date" "date",
    "duration_weeks" integer,
    "phase_goals_snapshot" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "coach_reflection" "text",
    "phase_summary" "jsonb",
    "completion_seen" boolean DEFAULT false NOT NULL,
    "phase_goal_weight" numeric,
    "phase_goal_body_fat_percentage" numeric,
    "milestones" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "phases_status_check" CHECK (("status" = ANY (ARRAY['planned'::"text", 'active'::"text", 'completed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."phases" OWNER TO "postgres";


COMMENT ON COLUMN "public"."phases"."phase_goal_weight" IS 'Phase-specific goal weight in kg. NULL = use client overall goal.';



COMMENT ON COLUMN "public"."phases"."phase_goal_body_fat_percentage" IS 'Phase-specific goal body fat %. NULL = use client overall goal.';



COMMENT ON COLUMN "public"."phases"."milestones" IS 'Array of {id, text, completed, completed_at} milestone objects';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'trainer'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['trainer'::"text", 'client'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roadmaps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "coach_id" "uuid" NOT NULL,
    "name" "text" DEFAULT 'Training Roadmap'::"text" NOT NULL,
    "long_term_goal" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "started_at" "date",
    "target_end_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "goal_weight" numeric,
    "goal_body_fat_percentage" numeric,
    CONSTRAINT "roadmaps_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'archived'::"text", 'draft'::"text"])))
);


ALTER TABLE "public"."roadmaps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."session_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "training_session_id" "uuid",
    "completed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completion_quality" "text" DEFAULT 'full'::"text",
    "notes" "text",
    "week_start_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "prescribed_session_snapshot" "jsonb",
    "training_event_id" "uuid",
    CONSTRAINT "client_session_completions_completion_quality_check" CHECK (("completion_quality" = ANY (ARRAY['full'::"text", 'partial'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."session_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."set_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "exercise_log_id" "uuid" NOT NULL,
    "set_number" integer NOT NULL,
    "reps" integer,
    "weight" numeric(7,2),
    "rpe" numeric(3,1),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "set_type" "text" DEFAULT 'working'::"text" NOT NULL,
    CONSTRAINT "set_logs_reps_check" CHECK ((("reps" IS NULL) OR (("reps" >= 1) AND ("reps" <= 100)))),
    CONSTRAINT "set_logs_rpe_check" CHECK ((("rpe" IS NULL) OR (("rpe" >= (1)::numeric) AND ("rpe" <= (10)::numeric)))),
    CONSTRAINT "set_logs_set_number_check" CHECK (("set_number" >= 1)),
    CONSTRAINT "set_logs_set_type_check" CHECK (("set_type" = ANY (ARRAY['warmup'::"text", 'working'::"text", 'amrap'::"text", 'drop'::"text", 'failure'::"text"]))),
    CONSTRAINT "set_logs_weight_check" CHECK ((("weight" IS NULL) OR (("weight" >= (0)::numeric) AND ("weight" <= (2000)::numeric))))
);


ALTER TABLE "public"."set_logs" OWNER TO "postgres";


COMMENT ON TABLE "public"."set_logs" IS 'Per-set actuals for a logged exercise. Standard 3-tier hierarchy: session_log -> exercise_log -> set_log.';



CREATE TABLE IF NOT EXISTS "public"."training_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "training_plan_id" "uuid",
    "training_session_id" "uuid",
    "date" "date" NOT NULL,
    "session_name" "text" NOT NULL,
    "session_focus" "text",
    "estimated_calories" integer,
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "session_log_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_modified" boolean DEFAULT false NOT NULL,
    "calorie_surplus_percentage" numeric,
    CONSTRAINT "training_events_status_check" CHECK (("status" = ANY (ARRAY['scheduled'::"text", 'completed'::"text", 'partial'::"text", 'missed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."training_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."training_events" IS 'Events-as-SOT calendar. RLS enabled with no policies (deny-all): all access is via service_role.';



CREATE TABLE IF NOT EXISTS "public"."training_exercises" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "order_index" integer DEFAULT 0 NOT NULL,
    "sets" integer NOT NULL,
    "reps_min" integer,
    "reps_max" integer,
    "reps_target" "text",
    "rpe_target" numeric(3,1),
    "percentage_1rm" numeric(5,2),
    "tempo" "text",
    "rest_seconds" integer,
    "notes" "text",
    "superset_group" "text",
    "is_warmup" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "exercise_id" "uuid",
    "set_specs" "jsonb",
    "video_url" "text",
    CONSTRAINT "training_exercises_percentage_1rm_check" CHECK ((("percentage_1rm" IS NULL) OR (("percentage_1rm" >= (0)::numeric) AND ("percentage_1rm" <= (100)::numeric)))),
    CONSTRAINT "training_exercises_rpe_target_check" CHECK ((("rpe_target" IS NULL) OR (("rpe_target" >= (1)::numeric) AND ("rpe_target" <= (10)::numeric)))),
    CONSTRAINT "training_exercises_sets_check" CHECK ((("sets" >= 1) AND ("sets" <= 20)))
);


ALTER TABLE "public"."training_exercises" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."training_plan_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "plan_id" "uuid",
    "coach_prompt" "text" NOT NULL,
    "ai_response_raw" "text",
    "plan_snapshot" "jsonb" NOT NULL,
    "client_metrics_snapshot" "jsonb",
    "check_in_data_snapshot" "jsonb",
    "regeneration_reason" "text",
    "created_by_coach_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."training_plan_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."training_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "coach_id" "uuid" NOT NULL,
    "name" "text" DEFAULT 'Training Plan'::"text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "coach_prompt" "text" NOT NULL,
    "ai_response_raw" "text",
    "split_type" "text" NOT NULL,
    "frequency_per_week" integer NOT NULL,
    "program_duration_weeks" integer,
    "client_weight_kg" numeric(5,2),
    "client_body_fat_percentage" numeric(4,1),
    "client_goal_weight_kg" numeric(5,2),
    "client_tdee" integer,
    "avg_mood" numeric(3,1),
    "avg_energy" numeric(3,1),
    "avg_sleep" numeric(3,1),
    "avg_stress" numeric(3,1),
    "recent_adherence_percentage" numeric(5,2),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "phase_id" "uuid",
    "effective_from" "date" DEFAULT CURRENT_DATE NOT NULL,
    "effective_until" "date",
    "saved_plan_id" "uuid",
    CONSTRAINT "training_plans_frequency_per_week_check" CHECK ((("frequency_per_week" >= 1) AND ("frequency_per_week" <= 7))),
    CONSTRAINT "training_plans_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'archived'::"text", 'draft'::"text", 'planned'::"text"])))
);


ALTER TABLE "public"."training_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."training_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plan_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "day_of_week" "text",
    "order_index" integer DEFAULT 0 NOT NULL,
    "focus" "text",
    "notes" "text",
    "estimated_duration_minutes" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "estimated_calories" integer,
    "calories_calculated_at" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL,
    "calorie_surplus_percentage" numeric,
    "week_index" integer DEFAULT 0 NOT NULL,
    "is_rest" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."training_sessions" OWNER TO "postgres";


ALTER TABLE ONLY "public"."attention_dismissals"
    ADD CONSTRAINT "attention_dismissals_coach_id_client_id_alert_type_key" UNIQUE ("coach_id", "client_id", "alert_type");



ALTER TABLE ONLY "public"."attention_dismissals"
    ADD CONSTRAINT "attention_dismissals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."body_metrics"
    ADD CONSTRAINT "body_metrics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."check_in_exercise_highlights"
    ADD CONSTRAINT "check_in_exercise_highlights_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."check_in_reminders"
    ADD CONSTRAINT "check_in_reminders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."check_in_tokens"
    ADD CONSTRAINT "check_in_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."check_in_tokens"
    ADD CONSTRAINT "check_in_tokens_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."check_ins"
    ADD CONSTRAINT "check_ins_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exercise_logs"
    ADD CONSTRAINT "client_exercise_completions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_goals"
    ADD CONSTRAINT "client_goals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_intake"
    ADD CONSTRAINT "client_intake_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_invitations"
    ADD CONSTRAINT "client_invitations_client_id_key" UNIQUE ("client_id");



ALTER TABLE ONLY "public"."client_invitations"
    ADD CONSTRAINT "client_invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_logs"
    ADD CONSTRAINT "client_session_completions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coach_client_views"
    ADD CONSTRAINT "coach_client_views_pkey" PRIMARY KEY ("coach_id", "client_id");



ALTER TABLE ONLY "public"."coach_saved_exercises"
    ADD CONSTRAINT "coach_saved_exercises_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coach_saved_plans"
    ADD CONSTRAINT "coach_saved_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coach_saved_sessions"
    ADD CONSTRAINT "coach_saved_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coaches"
    ADD CONSTRAINT "coaches_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."coaches"
    ADD CONSTRAINT "coaches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coaches"
    ADD CONSTRAINT "coaches_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."content_assignments"
    ADD CONSTRAINT "content_assignments_content_id_client_id_key" UNIQUE ("content_id", "client_id");



ALTER TABLE ONLY "public"."content_assignments"
    ADD CONSTRAINT "content_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_folders"
    ADD CONSTRAINT "content_folders_coach_id_parent_folder_id_name_key" UNIQUE ("coach_id", "parent_folder_id", "name");



ALTER TABLE ONLY "public"."content_folders"
    ADD CONSTRAINT "content_folders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_items"
    ADD CONSTRAINT "content_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_habit_logs"
    ADD CONSTRAINT "daily_habit_logs_daily_habit_id_date_key" UNIQUE ("daily_habit_id", "date");



ALTER TABLE ONLY "public"."daily_habit_logs"
    ADD CONSTRAINT "daily_habit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_habits"
    ADD CONSTRAINT "daily_habits_client_id_name_key" UNIQUE ("client_id", "name");



ALTER TABLE ONLY "public"."daily_habits"
    ADD CONSTRAINT "daily_habits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_logs"
    ADD CONSTRAINT "daily_logs_client_id_date_key" UNIQUE ("client_id", "date");



ALTER TABLE ONLY "public"."daily_logs"
    ADD CONSTRAINT "daily_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exercise_logs"
    ADD CONSTRAINT "exercise_logs_session_log_exercise_key" UNIQUE ("session_log_id", "training_exercise_id");



ALTER TABLE ONLY "public"."exercises"
    ADD CONSTRAINT "exercises_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nutrition_events"
    ADD CONSTRAINT "nutrition_events_client_id_date_key" UNIQUE ("client_id", "date");



ALTER TABLE ONLY "public"."nutrition_events"
    ADD CONSTRAINT "nutrition_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nutrition_logs"
    ADD CONSTRAINT "nutrition_logs_daily_log_id_key" UNIQUE ("daily_log_id");



ALTER TABLE ONLY "public"."nutrition_logs"
    ADD CONSTRAINT "nutrition_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nutrition_plan_daily_targets"
    ADD CONSTRAINT "nutrition_plan_daily_targets_nutrition_plan_id_day_of_week_key" UNIQUE ("nutrition_plan_id", "day_of_week");



ALTER TABLE ONLY "public"."nutrition_plan_daily_targets"
    ADD CONSTRAINT "nutrition_plan_daily_targets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nutrition_plans"
    ADD CONSTRAINT "nutrition_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nutrition_weekly_summaries"
    ADD CONSTRAINT "nutrition_weekly_summaries_client_id_week_start_date_key" UNIQUE ("client_id", "week_start_date");



ALTER TABLE ONLY "public"."nutrition_weekly_summaries"
    ADD CONSTRAINT "nutrition_weekly_summaries_client_week_unique" UNIQUE ("client_id", "week_start_date");



ALTER TABLE ONLY "public"."nutrition_weekly_summaries"
    ADD CONSTRAINT "nutrition_weekly_summaries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."phases"
    ADD CONSTRAINT "phases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."roadmaps"
    ADD CONSTRAINT "roadmaps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."set_logs"
    ADD CONSTRAINT "set_logs_exercise_log_id_set_number_key" UNIQUE ("exercise_log_id", "set_number");



ALTER TABLE ONLY "public"."set_logs"
    ADD CONSTRAINT "set_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."training_events"
    ADD CONSTRAINT "training_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."training_exercises"
    ADD CONSTRAINT "training_exercises_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."training_logs"
    ADD CONSTRAINT "training_logs_daily_log_id_key" UNIQUE ("daily_log_id");



ALTER TABLE ONLY "public"."training_logs"
    ADD CONSTRAINT "training_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."training_plan_history"
    ADD CONSTRAINT "training_plan_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."training_plans"
    ADD CONSTRAINT "training_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."training_sessions"
    ADD CONSTRAINT "training_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."training_events"
    ADD CONSTRAINT "uq_training_events_session_date" UNIQUE ("client_id", "training_session_id", "date");



ALTER TABLE ONLY "public"."wellness_logs"
    ADD CONSTRAINT "wellness_logs_daily_log_id_key" UNIQUE ("daily_log_id");



ALTER TABLE ONLY "public"."wellness_logs"
    ADD CONSTRAINT "wellness_logs_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_audit_logs_actor_created" ON "public"."audit_logs" USING "btree" ("actor_id", "created_at" DESC);



CREATE INDEX "idx_audit_logs_client_created" ON "public"."audit_logs" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "idx_body_metrics_client_recorded" ON "public"."body_metrics" USING "btree" ("client_id", "recorded_at" DESC);



CREATE INDEX "idx_body_metrics_client_source" ON "public"."body_metrics" USING "btree" ("client_id", "source");



CREATE INDEX "idx_check_in_reminders_client_id" ON "public"."check_in_reminders" USING "btree" ("client_id");



CREATE INDEX "idx_check_in_reminders_responded" ON "public"."check_in_reminders" USING "btree" ("responded", "client_id");



CREATE INDEX "idx_check_in_reminders_sent_at" ON "public"."check_in_reminders" USING "btree" ("sent_at" DESC);



CREATE INDEX "idx_check_in_reminders_type" ON "public"."check_in_reminders" USING "btree" ("reminder_type");



CREATE INDEX "idx_check_in_tokens_client_id" ON "public"."check_in_tokens" USING "btree" ("client_id");



CREATE INDEX "idx_check_in_tokens_expires_at" ON "public"."check_in_tokens" USING "btree" ("expires_at");



CREATE INDEX "idx_check_in_tokens_token" ON "public"."check_in_tokens" USING "btree" ("token");



CREATE INDEX "idx_check_ins_client_created_id" ON "public"."check_ins" USING "btree" ("client_id", "created_at" DESC, "id" DESC);



CREATE INDEX "idx_check_ins_client_id" ON "public"."check_ins" USING "btree" ("client_id");



CREATE INDEX "idx_check_ins_created_at" ON "public"."check_ins" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_check_ins_daily_logs_period" ON "public"."check_ins" USING "btree" ("client_id", "daily_logs_start_date", "daily_logs_end_date") WHERE (("daily_logs_start_date" IS NOT NULL) AND ("daily_logs_end_date" IS NOT NULL));



CREATE INDEX "idx_check_ins_period" ON "public"."check_ins" USING "btree" ("client_id", "period_start", "period_end");



CREATE INDEX "idx_check_ins_status" ON "public"."check_ins" USING "btree" ("status");



CREATE INDEX "idx_check_ins_uses_daily_logs" ON "public"."check_ins" USING "btree" ("client_id", "uses_daily_logs") WHERE ("uses_daily_logs" = true);



CREATE UNIQUE INDEX "idx_client_goals_active_unique" ON "public"."client_goals" USING "btree" ("client_id") WHERE ("superseded_at" IS NULL);



CREATE INDEX "idx_client_goals_client_effective" ON "public"."client_goals" USING "btree" ("client_id", "effective_from" DESC);



CREATE INDEX "idx_client_intake_client_id" ON "public"."client_intake" USING "btree" ("client_id");



CREATE INDEX "idx_client_intake_reviewed_by" ON "public"."client_intake" USING "btree" ("reviewed_by");



CREATE INDEX "idx_client_intake_status" ON "public"."client_intake" USING "btree" ("status");



CREATE INDEX "idx_client_invitations_client_id" ON "public"."client_invitations" USING "btree" ("client_id");



CREATE INDEX "idx_client_invitations_email" ON "public"."client_invitations" USING "btree" ("email");



CREATE INDEX "idx_client_invitations_status" ON "public"."client_invitations" USING "btree" ("status");



CREATE UNIQUE INDEX "idx_client_invitations_token" ON "public"."client_invitations" USING "btree" ("token") WHERE ("token" IS NOT NULL);



CREATE INDEX "idx_clients_active" ON "public"."clients" USING "btree" ("active");



CREATE INDEX "idx_clients_adherence_rate" ON "public"."clients" USING "btree" ("check_in_adherence_rate");



CREATE INDEX "idx_clients_check_in_frequency" ON "public"."clients" USING "btree" ("check_in_frequency");



CREATE INDEX "idx_clients_coach_id" ON "public"."clients" USING "btree" ("coach_id");



CREATE INDEX "idx_clients_date_of_birth" ON "public"."clients" USING "btree" ("date_of_birth");



CREATE INDEX "idx_clients_email" ON "public"."clients" USING "btree" ("email");



CREATE INDEX "idx_clients_last_reminder_sent_at" ON "public"."clients" USING "btree" ("last_reminder_sent_at");



CREATE INDEX "idx_clients_user_id" ON "public"."clients" USING "btree" ("user_id");



CREATE INDEX "idx_coach_saved_exercises_exercise" ON "public"."coach_saved_exercises" USING "btree" ("exercise_id");



CREATE INDEX "idx_coach_saved_exercises_session" ON "public"."coach_saved_exercises" USING "btree" ("saved_session_id");



CREATE INDEX "idx_coach_saved_plans_coach" ON "public"."coach_saved_plans" USING "btree" ("coach_id");



CREATE INDEX "idx_coach_saved_plans_coach_status" ON "public"."coach_saved_plans" USING "btree" ("coach_id", "status");



CREATE INDEX "idx_coach_saved_sessions_coach" ON "public"."coach_saved_sessions" USING "btree" ("coach_id");



CREATE INDEX "idx_coach_saved_sessions_plan" ON "public"."coach_saved_sessions" USING "btree" ("saved_plan_id");



CREATE INDEX "idx_coaches_email" ON "public"."coaches" USING "btree" ("email");



CREATE INDEX "idx_coaches_user_id" ON "public"."coaches" USING "btree" ("user_id");



CREATE INDEX "idx_content_assignments_client_id" ON "public"."content_assignments" USING "btree" ("client_id");



CREATE INDEX "idx_content_assignments_content_id" ON "public"."content_assignments" USING "btree" ("content_id");



CREATE INDEX "idx_content_folders_coach_id" ON "public"."content_folders" USING "btree" ("coach_id");



CREATE INDEX "idx_content_folders_parent_folder_id" ON "public"."content_folders" USING "btree" ("parent_folder_id");



CREATE INDEX "idx_content_items_coach_id" ON "public"."content_items" USING "btree" ("coach_id");



CREATE INDEX "idx_content_items_folder_id" ON "public"."content_items" USING "btree" ("folder_id");



CREATE INDEX "idx_content_items_is_library" ON "public"."content_items" USING "btree" ("is_library");



CREATE INDEX "idx_content_items_type" ON "public"."content_items" USING "btree" ("type");



CREATE INDEX "idx_daily_habit_logs_client_date" ON "public"."daily_habit_logs" USING "btree" ("client_id", "date");



CREATE INDEX "idx_daily_habit_logs_habit_id" ON "public"."daily_habit_logs" USING "btree" ("daily_habit_id");



CREATE INDEX "idx_daily_habits_client_id" ON "public"."daily_habits" USING "btree" ("client_id");



CREATE INDEX "idx_daily_habits_coach_id" ON "public"."daily_habits" USING "btree" ("coach_id");



CREATE INDEX "idx_daily_habits_is_active" ON "public"."daily_habits" USING "btree" ("is_active");



CREATE INDEX "idx_daily_habits_phase" ON "public"."daily_habits" USING "btree" ("phase_id") WHERE ("phase_id" IS NOT NULL);



CREATE INDEX "idx_daily_logs_client_date" ON "public"."daily_logs" USING "btree" ("client_id", "date" DESC);



CREATE INDEX "idx_daily_logs_client_date_asc" ON "public"."daily_logs" USING "btree" ("client_id", "date");



CREATE INDEX "idx_exercise_highlights_check_in" ON "public"."check_in_exercise_highlights" USING "btree" ("check_in_id");



CREATE INDEX "idx_exercise_logs_session_log" ON "public"."exercise_logs" USING "btree" ("session_log_id");



CREATE INDEX "idx_exercises_coach" ON "public"."exercises" USING "btree" ("coach_id");



CREATE UNIQUE INDEX "idx_exercises_coach_name" ON "public"."exercises" USING "btree" (COALESCE("coach_id", '00000000-0000-0000-0000-000000000000'::"uuid"), "lower"("name"));



CREATE INDEX "idx_exercises_name" ON "public"."exercises" USING "btree" ("lower"("name"));



CREATE INDEX "idx_exercises_updated_at" ON "public"."exercises" USING "btree" ("updated_at");



CREATE INDEX "idx_nutrition_events_client_date" ON "public"."nutrition_events" USING "btree" ("client_id", "date");



CREATE INDEX "idx_nutrition_events_plan" ON "public"."nutrition_events" USING "btree" ("nutrition_plan_id");



CREATE INDEX "idx_nutrition_logs_client_date" ON "public"."nutrition_logs" USING "btree" ("client_id", "date" DESC);



CREATE UNIQUE INDEX "idx_nutrition_plans_active_unique" ON "public"."nutrition_plans" USING "btree" ("client_id") WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_nutrition_plans_client_date" ON "public"."nutrition_plans" USING "btree" ("client_id", "effective_from" DESC);



CREATE INDEX "idx_nutrition_plans_phase" ON "public"."nutrition_plans" USING "btree" ("phase_id") WHERE ("phase_id" IS NOT NULL);



CREATE INDEX "idx_nutrition_weekly_summaries_client_id" ON "public"."nutrition_weekly_summaries" USING "btree" ("client_id");



CREATE INDEX "idx_nutrition_weekly_summaries_week_start" ON "public"."nutrition_weekly_summaries" USING "btree" ("week_start_date");



CREATE UNIQUE INDEX "idx_phases_active_unique" ON "public"."phases" USING "btree" ("roadmap_id") WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_phases_client_start" ON "public"."phases" USING "btree" ("client_id", "start_date" DESC);



CREATE INDEX "idx_phases_roadmap_order" ON "public"."phases" USING "btree" ("roadmap_id", "order_index");



CREATE INDEX "idx_profiles_role" ON "public"."profiles" USING "btree" ("role");



CREATE INDEX "idx_profiles_user_id" ON "public"."profiles" USING "btree" ("user_id");



CREATE UNIQUE INDEX "idx_roadmaps_active_unique" ON "public"."roadmaps" USING "btree" ("client_id") WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_roadmaps_client_created" ON "public"."roadmaps" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "idx_session_logs_client" ON "public"."session_logs" USING "btree" ("client_id", "week_start_date" DESC);



CREATE INDEX "idx_session_logs_client_completed" ON "public"."session_logs" USING "btree" ("client_id", "completed_at" DESC);



CREATE INDEX "idx_session_logs_client_completed_id" ON "public"."session_logs" USING "btree" ("client_id", "completed_at" DESC, "id" DESC);



CREATE INDEX "idx_session_logs_session" ON "public"."session_logs" USING "btree" ("training_session_id");



CREATE INDEX "idx_set_logs_exercise_log" ON "public"."set_logs" USING "btree" ("exercise_log_id");



CREATE INDEX "idx_training_events_client_date" ON "public"."training_events" USING "btree" ("client_id", "date");



CREATE INDEX "idx_training_events_plan" ON "public"."training_events" USING "btree" ("training_plan_id");



CREATE UNIQUE INDEX "idx_training_events_unique_session_date" ON "public"."training_events" USING "btree" ("client_id", "training_session_id", "date") WHERE ("training_session_id" IS NOT NULL);



CREATE INDEX "idx_training_exercises_active" ON "public"."training_exercises" USING "btree" ("session_id", "order_index") WHERE ("is_active" = true);



CREATE INDEX "idx_training_exercises_exercise" ON "public"."training_exercises" USING "btree" ("exercise_id");



CREATE INDEX "idx_training_exercises_session" ON "public"."training_exercises" USING "btree" ("session_id", "order_index");



CREATE INDEX "idx_training_logs_client_date" ON "public"."training_logs" USING "btree" ("client_id", "date" DESC);



CREATE INDEX "idx_training_logs_trained" ON "public"."training_logs" USING "btree" ("client_id", "trained") WHERE ("trained" = true);



CREATE INDEX "idx_training_plan_history_client" ON "public"."training_plan_history" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "idx_training_plans_client" ON "public"."training_plans" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "idx_training_plans_date_range" ON "public"."training_plans" USING "btree" ("client_id", "effective_from", "effective_until") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_training_plans_phase" ON "public"."training_plans" USING "btree" ("phase_id") WHERE ("phase_id" IS NOT NULL);



CREATE INDEX "idx_training_plans_status" ON "public"."training_plans" USING "btree" ("client_id", "status") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_training_sessions_active" ON "public"."training_sessions" USING "btree" ("plan_id", "order_index") WHERE ("is_active" = true);



CREATE INDEX "idx_training_sessions_calories" ON "public"."training_sessions" USING "btree" ("plan_id", "estimated_calories") WHERE ("estimated_calories" IS NOT NULL);



CREATE INDEX "idx_training_sessions_plan" ON "public"."training_sessions" USING "btree" ("plan_id", "order_index");



CREATE INDEX "idx_wellness_logs_client_date" ON "public"."wellness_logs" USING "btree" ("client_id", "date" DESC);



CREATE UNIQUE INDEX "session_logs_training_event_id_key" ON "public"."session_logs" USING "btree" ("training_event_id") WHERE ("training_event_id" IS NOT NULL);



CREATE OR REPLACE TRIGGER "client_invitations_updated_at" BEFORE UPDATE ON "public"."client_invitations" FOR EACH ROW EXECUTE FUNCTION "public"."update_profiles_updated_at"();



CREATE OR REPLACE TRIGGER "coach_saved_exercises_updated_at" BEFORE UPDATE ON "public"."coach_saved_exercises" FOR EACH ROW EXECUTE FUNCTION "public"."update_training_plan_updated_at"();



CREATE OR REPLACE TRIGGER "coach_saved_plans_updated_at" BEFORE UPDATE ON "public"."coach_saved_plans" FOR EACH ROW EXECUTE FUNCTION "public"."update_training_plan_updated_at"();



CREATE OR REPLACE TRIGGER "coach_saved_sessions_updated_at" BEFORE UPDATE ON "public"."coach_saved_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."update_training_plan_updated_at"();



CREATE OR REPLACE TRIGGER "daily_logs_updated_at" BEFORE UPDATE ON "public"."daily_logs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "exercise_logs_updated_at" BEFORE UPDATE ON "public"."exercise_logs" FOR EACH ROW EXECUTE FUNCTION "public"."update_training_plan_updated_at"();



CREATE OR REPLACE TRIGGER "nutrition_logs_updated_at" BEFORE UPDATE ON "public"."nutrition_logs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_profiles_updated_at"();



CREATE OR REPLACE TRIGGER "session_logs_updated_at" BEFORE UPDATE ON "public"."session_logs" FOR EACH ROW EXECUTE FUNCTION "public"."update_training_plan_updated_at"();



CREATE OR REPLACE TRIGGER "training_exercises_updated_at" BEFORE UPDATE ON "public"."training_exercises" FOR EACH ROW EXECUTE FUNCTION "public"."update_training_plan_updated_at"();



CREATE OR REPLACE TRIGGER "training_logs_updated_at" BEFORE UPDATE ON "public"."training_logs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "training_plans_updated_at" BEFORE UPDATE ON "public"."training_plans" FOR EACH ROW EXECUTE FUNCTION "public"."update_training_plan_updated_at"();



CREATE OR REPLACE TRIGGER "training_sessions_updated_at" BEFORE UPDATE ON "public"."training_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."update_training_plan_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_mark_reminder_responded" AFTER INSERT ON "public"."check_ins" FOR EACH ROW EXECUTE FUNCTION "public"."mark_reminder_responded"();



CREATE OR REPLACE TRIGGER "trigger_update_adherence_on_check_in" AFTER INSERT ON "public"."check_ins" FOR EACH ROW EXECUTE FUNCTION "public"."update_adherence_on_check_in"();



CREATE OR REPLACE TRIGGER "update_check_ins_updated_at" BEFORE UPDATE ON "public"."check_ins" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_client_goals_updated_at" BEFORE UPDATE ON "public"."client_goals" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_client_intake_updated_at" BEFORE UPDATE ON "public"."client_intake" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_clients_updated_at" BEFORE UPDATE ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_coaches_updated_at" BEFORE UPDATE ON "public"."coaches" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_content_folders_updated_at" BEFORE UPDATE ON "public"."content_folders" FOR EACH ROW EXECUTE FUNCTION "public"."update_content_updated_at"();



CREATE OR REPLACE TRIGGER "update_content_items_updated_at" BEFORE UPDATE ON "public"."content_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_content_updated_at"();



CREATE OR REPLACE TRIGGER "update_daily_habit_logs_updated_at" BEFORE UPDATE ON "public"."daily_habit_logs" FOR EACH ROW EXECUTE FUNCTION "public"."update_content_updated_at"();



CREATE OR REPLACE TRIGGER "update_daily_habits_updated_at" BEFORE UPDATE ON "public"."daily_habits" FOR EACH ROW EXECUTE FUNCTION "public"."update_content_updated_at"();



CREATE OR REPLACE TRIGGER "update_exercises_updated_at" BEFORE UPDATE ON "public"."exercises" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_nutrition_weekly_summaries_updated_at" BEFORE UPDATE ON "public"."nutrition_weekly_summaries" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_phases_updated_at" BEFORE UPDATE ON "public"."phases" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_roadmaps_updated_at" BEFORE UPDATE ON "public"."roadmaps" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "wellness_logs_updated_at" BEFORE UPDATE ON "public"."wellness_logs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."attention_dismissals"
    ADD CONSTRAINT "attention_dismissals_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attention_dismissals"
    ADD CONSTRAINT "attention_dismissals_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."body_metrics"
    ADD CONSTRAINT "body_metrics_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."check_in_exercise_highlights"
    ADD CONSTRAINT "check_in_exercise_highlights_check_in_id_fkey" FOREIGN KEY ("check_in_id") REFERENCES "public"."check_ins"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."check_in_exercise_highlights"
    ADD CONSTRAINT "check_in_exercise_highlights_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."training_exercises"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."check_in_reminders"
    ADD CONSTRAINT "check_in_reminders_check_in_id_fkey" FOREIGN KEY ("check_in_id") REFERENCES "public"."check_ins"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."check_in_reminders"
    ADD CONSTRAINT "check_in_reminders_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."check_in_tokens"
    ADD CONSTRAINT "check_in_tokens_check_in_id_fkey" FOREIGN KEY ("check_in_id") REFERENCES "public"."check_ins"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."check_in_tokens"
    ADD CONSTRAINT "check_in_tokens_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."check_ins"
    ADD CONSTRAINT "check_ins_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_goals"
    ADD CONSTRAINT "client_goals_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_intake"
    ADD CONSTRAINT "client_intake_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_intake"
    ADD CONSTRAINT "client_intake_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."coaches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_invitations"
    ADD CONSTRAINT "client_invitations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."coach_client_views"
    ADD CONSTRAINT "coach_client_views_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coach_client_views"
    ADD CONSTRAINT "coach_client_views_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coach_saved_exercises"
    ADD CONSTRAINT "coach_saved_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."coach_saved_exercises"
    ADD CONSTRAINT "coach_saved_exercises_saved_session_id_fkey" FOREIGN KEY ("saved_session_id") REFERENCES "public"."coach_saved_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coach_saved_plans"
    ADD CONSTRAINT "coach_saved_plans_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coach_saved_sessions"
    ADD CONSTRAINT "coach_saved_sessions_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coach_saved_sessions"
    ADD CONSTRAINT "coach_saved_sessions_saved_plan_id_fkey" FOREIGN KEY ("saved_plan_id") REFERENCES "public"."coach_saved_plans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coaches"
    ADD CONSTRAINT "coaches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_assignments"
    ADD CONSTRAINT "content_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."coaches"("id");



ALTER TABLE ONLY "public"."content_assignments"
    ADD CONSTRAINT "content_assignments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_assignments"
    ADD CONSTRAINT "content_assignments_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "public"."content_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_folders"
    ADD CONSTRAINT "content_folders_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_folders"
    ADD CONSTRAINT "content_folders_parent_folder_id_fkey" FOREIGN KEY ("parent_folder_id") REFERENCES "public"."content_folders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_items"
    ADD CONSTRAINT "content_items_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_items"
    ADD CONSTRAINT "content_items_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "public"."content_folders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."daily_habit_logs"
    ADD CONSTRAINT "daily_habit_logs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_habit_logs"
    ADD CONSTRAINT "daily_habit_logs_daily_habit_id_fkey" FOREIGN KEY ("daily_habit_id") REFERENCES "public"."daily_habits"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_habit_logs"
    ADD CONSTRAINT "daily_habit_logs_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "public"."phases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."daily_habits"
    ADD CONSTRAINT "daily_habits_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_habits"
    ADD CONSTRAINT "daily_habits_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_habits"
    ADD CONSTRAINT "daily_habits_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "public"."phases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."daily_logs"
    ADD CONSTRAINT "daily_logs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_logs"
    ADD CONSTRAINT "daily_logs_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "public"."phases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."exercise_logs"
    ADD CONSTRAINT "exercise_logs_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."exercise_logs"
    ADD CONSTRAINT "exercise_logs_session_log_id_fkey" FOREIGN KEY ("session_log_id") REFERENCES "public"."session_logs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exercise_logs"
    ADD CONSTRAINT "exercise_logs_training_exercise_id_fkey" FOREIGN KEY ("training_exercise_id") REFERENCES "public"."training_exercises"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."exercises"
    ADD CONSTRAINT "exercises_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nutrition_events"
    ADD CONSTRAINT "nutrition_events_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nutrition_events"
    ADD CONSTRAINT "nutrition_events_plan_fk" FOREIGN KEY ("nutrition_plan_id") REFERENCES "public"."nutrition_plans"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."nutrition_logs"
    ADD CONSTRAINT "nutrition_logs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nutrition_logs"
    ADD CONSTRAINT "nutrition_logs_daily_log_id_fkey" FOREIGN KEY ("daily_log_id") REFERENCES "public"."daily_logs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nutrition_logs"
    ADD CONSTRAINT "nutrition_logs_nutrition_plan_id_fkey" FOREIGN KEY ("nutrition_plan_id") REFERENCES "public"."nutrition_plans"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."nutrition_plan_daily_targets"
    ADD CONSTRAINT "nutrition_plan_daily_targets_nutrition_plan_id_fkey" FOREIGN KEY ("nutrition_plan_id") REFERENCES "public"."nutrition_plans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nutrition_plans"
    ADD CONSTRAINT "nutrition_plans_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nutrition_plans"
    ADD CONSTRAINT "nutrition_plans_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nutrition_plans"
    ADD CONSTRAINT "nutrition_plans_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "public"."phases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."nutrition_weekly_summaries"
    ADD CONSTRAINT "nutrition_weekly_summaries_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."phases"
    ADD CONSTRAINT "phases_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."phases"
    ADD CONSTRAINT "phases_roadmap_id_fkey" FOREIGN KEY ("roadmap_id") REFERENCES "public"."roadmaps"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roadmaps"
    ADD CONSTRAINT "roadmaps_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roadmaps"
    ADD CONSTRAINT "roadmaps_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id");



ALTER TABLE ONLY "public"."session_logs"
    ADD CONSTRAINT "session_logs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_logs"
    ADD CONSTRAINT "session_logs_training_event_id_fkey" FOREIGN KEY ("training_event_id") REFERENCES "public"."training_events"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."session_logs"
    ADD CONSTRAINT "session_logs_training_session_id_fkey" FOREIGN KEY ("training_session_id") REFERENCES "public"."training_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."set_logs"
    ADD CONSTRAINT "set_logs_exercise_log_id_fkey" FOREIGN KEY ("exercise_log_id") REFERENCES "public"."exercise_logs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."training_events"
    ADD CONSTRAINT "training_events_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."training_events"
    ADD CONSTRAINT "training_events_plan_fk" FOREIGN KEY ("training_plan_id") REFERENCES "public"."training_plans"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."training_events"
    ADD CONSTRAINT "training_events_session_log_id_fkey" FOREIGN KEY ("session_log_id") REFERENCES "public"."session_logs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."training_events"
    ADD CONSTRAINT "training_events_training_session_id_fkey" FOREIGN KEY ("training_session_id") REFERENCES "public"."training_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."training_exercises"
    ADD CONSTRAINT "training_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."training_exercises"
    ADD CONSTRAINT "training_exercises_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."training_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."training_logs"
    ADD CONSTRAINT "training_logs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."training_logs"
    ADD CONSTRAINT "training_logs_daily_log_id_fkey" FOREIGN KEY ("daily_log_id") REFERENCES "public"."daily_logs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."training_logs"
    ADD CONSTRAINT "training_logs_training_plan_id_fkey" FOREIGN KEY ("training_plan_id") REFERENCES "public"."training_plans"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."training_plan_history"
    ADD CONSTRAINT "training_plan_history_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."training_plan_history"
    ADD CONSTRAINT "training_plan_history_created_by_coach_id_fkey" FOREIGN KEY ("created_by_coach_id") REFERENCES "public"."coaches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."training_plan_history"
    ADD CONSTRAINT "training_plan_history_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."training_plans"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."training_plans"
    ADD CONSTRAINT "training_plans_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."training_plans"
    ADD CONSTRAINT "training_plans_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."training_plans"
    ADD CONSTRAINT "training_plans_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "public"."phases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."training_plans"
    ADD CONSTRAINT "training_plans_saved_plan_id_fkey" FOREIGN KEY ("saved_plan_id") REFERENCES "public"."coach_saved_plans"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."training_sessions"
    ADD CONSTRAINT "training_sessions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."training_plans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wellness_logs"
    ADD CONSTRAINT "wellness_logs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wellness_logs"
    ADD CONSTRAINT "wellness_logs_daily_log_id_fkey" FOREIGN KEY ("daily_log_id") REFERENCES "public"."daily_logs"("id") ON DELETE CASCADE;



CREATE POLICY "Authenticated users can create profile" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Authenticated users can create their own coach profile" ON "public"."coaches" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."user_id" = "auth"."uid"()) AND ("p"."role" = 'trainer'::"text"))))));



CREATE POLICY "Clients can view assigned content" ON "public"."content_items" FOR SELECT TO "authenticated" USING (("id" IN ( SELECT "content_assignments"."content_id"
   FROM "public"."content_assignments"
  WHERE ("content_assignments"."client_id" IN ( SELECT "clients"."id"
           FROM "public"."clients"
          WHERE ("clients"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Clients can view library content from their coach" ON "public"."content_items" FOR SELECT TO "authenticated" USING ((("is_library" = true) AND ("coach_id" IN ( SELECT "clients"."coach_id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"())))));



CREATE POLICY "Clients can view own profile" ON "public"."clients" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Clients can view their coach's folders" ON "public"."content_folders" FOR SELECT TO "authenticated" USING (("coach_id" IN ( SELECT "clients"."coach_id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "Clients can view their own assignments" ON "public"."content_assignments" FOR SELECT TO "authenticated" USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "Clients can view their own weekly summaries" ON "public"."nutrition_weekly_summaries" FOR SELECT USING (("auth"."uid"() IN ( SELECT "clients"."user_id"
   FROM "public"."clients"
  WHERE ("clients"."id" = "nutrition_weekly_summaries"."client_id"))));



CREATE POLICY "Coaches can create assignments for their clients" ON "public"."content_assignments" FOR INSERT TO "authenticated" WITH CHECK ((("assigned_by" IN ( SELECT "coaches"."id"
   FROM "public"."coaches"
  WHERE ("coaches"."user_id" = "auth"."uid"()))) AND ("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
           FROM "public"."coaches"
          WHERE ("coaches"."user_id" = "auth"."uid"())))))));



CREATE POLICY "Coaches can create check-ins for their clients" ON "public"."check_ins" FOR INSERT WITH CHECK (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
           FROM "public"."coaches"
          WHERE ("coaches"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Coaches can create client invitations" ON "public"."client_invitations" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."clients" "c"
     JOIN "public"."coaches" "co" ON (("c"."coach_id" = "co"."id")))
  WHERE (("c"."id" = "client_invitations"."client_id") AND ("co"."user_id" = "auth"."uid"())))));



CREATE POLICY "Coaches can create reminders for their clients" ON "public"."check_in_reminders" FOR INSERT WITH CHECK (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
           FROM "public"."coaches"
          WHERE ("coaches"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Coaches can create their own content" ON "public"."content_items" FOR INSERT TO "authenticated" WITH CHECK (("coach_id" IN ( SELECT "coaches"."id"
   FROM "public"."coaches"
  WHERE ("coaches"."user_id" = "auth"."uid"()))));



CREATE POLICY "Coaches can create their own folders" ON "public"."content_folders" FOR INSERT TO "authenticated" WITH CHECK (("coach_id" IN ( SELECT "coaches"."id"
   FROM "public"."coaches"
  WHERE ("coaches"."user_id" = "auth"."uid"()))));



CREATE POLICY "Coaches can create tokens for their clients" ON "public"."check_in_tokens" FOR INSERT WITH CHECK (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
           FROM "public"."coaches"
          WHERE ("coaches"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Coaches can delete assignments for their clients" ON "public"."content_assignments" FOR DELETE TO "authenticated" USING (("assigned_by" IN ( SELECT "coaches"."id"
   FROM "public"."coaches"
  WHERE ("coaches"."user_id" = "auth"."uid"()))));



CREATE POLICY "Coaches can delete their own clients" ON "public"."clients" FOR DELETE USING (("coach_id" IN ( SELECT "coaches"."id"
   FROM "public"."coaches"
  WHERE ("coaches"."user_id" = "auth"."uid"()))));



CREATE POLICY "Coaches can delete their own content" ON "public"."content_items" FOR DELETE TO "authenticated" USING (("coach_id" IN ( SELECT "coaches"."id"
   FROM "public"."coaches"
  WHERE ("coaches"."user_id" = "auth"."uid"()))));



CREATE POLICY "Coaches can delete their own folders" ON "public"."content_folders" FOR DELETE TO "authenticated" USING (("coach_id" IN ( SELECT "coaches"."id"
   FROM "public"."coaches"
  WHERE ("coaches"."user_id" = "auth"."uid"()))));



CREATE POLICY "Coaches can insert their own clients" ON "public"."clients" FOR INSERT WITH CHECK (("coach_id" IN ( SELECT "coaches"."id"
   FROM "public"."coaches"
  WHERE ("coaches"."user_id" = "auth"."uid"()))));



CREATE POLICY "Coaches can manage client weekly summaries" ON "public"."nutrition_weekly_summaries" USING (("auth"."uid"() IN ( SELECT "coaches"."user_id"
   FROM ("public"."coaches"
     JOIN "public"."clients" ON (("clients"."coach_id" = "coaches"."id")))
  WHERE ("clients"."id" = "nutrition_weekly_summaries"."client_id"))));



CREATE POLICY "Coaches can read their own clients" ON "public"."clients" FOR SELECT USING (("coach_id" IN ( SELECT "coaches"."id"
   FROM "public"."coaches"
  WHERE ("coaches"."user_id" = "auth"."uid"()))));



CREATE POLICY "Coaches can read their own data" ON "public"."coaches" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Coaches can update client invitations" ON "public"."client_invitations" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ("public"."clients" "c"
     JOIN "public"."coaches" "co" ON (("c"."coach_id" = "co"."id")))
  WHERE (("c"."id" = "client_invitations"."client_id") AND ("co"."user_id" = "auth"."uid"())))));



CREATE POLICY "Coaches can update reminders for their clients" ON "public"."check_in_reminders" FOR UPDATE USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
           FROM "public"."coaches"
          WHERE ("coaches"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Coaches can update their clients check-ins" ON "public"."check_ins" FOR UPDATE USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
           FROM "public"."coaches"
          WHERE ("coaches"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Coaches can update their clients tokens" ON "public"."check_in_tokens" FOR UPDATE USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
           FROM "public"."coaches"
          WHERE ("coaches"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Coaches can update their own clients" ON "public"."clients" FOR UPDATE USING (("coach_id" IN ( SELECT "coaches"."id"
   FROM "public"."coaches"
  WHERE ("coaches"."user_id" = "auth"."uid"()))));



CREATE POLICY "Coaches can update their own content" ON "public"."content_items" FOR UPDATE TO "authenticated" USING (("coach_id" IN ( SELECT "coaches"."id"
   FROM "public"."coaches"
  WHERE ("coaches"."user_id" = "auth"."uid"())))) WITH CHECK (("coach_id" IN ( SELECT "coaches"."id"
   FROM "public"."coaches"
  WHERE ("coaches"."user_id" = "auth"."uid"()))));



CREATE POLICY "Coaches can update their own data" ON "public"."coaches" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Coaches can update their own folders" ON "public"."content_folders" FOR UPDATE TO "authenticated" USING (("coach_id" IN ( SELECT "coaches"."id"
   FROM "public"."coaches"
  WHERE ("coaches"."user_id" = "auth"."uid"())))) WITH CHECK (("coach_id" IN ( SELECT "coaches"."id"
   FROM "public"."coaches"
  WHERE ("coaches"."user_id" = "auth"."uid"()))));



CREATE POLICY "Coaches can view assignments for their clients" ON "public"."content_assignments" FOR SELECT TO "authenticated" USING (("assigned_by" IN ( SELECT "coaches"."id"
   FROM "public"."coaches"
  WHERE ("coaches"."user_id" = "auth"."uid"()))));



CREATE POLICY "Coaches can view client invitations" ON "public"."client_invitations" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."clients" "c"
     JOIN "public"."coaches" "co" ON (("c"."coach_id" = "co"."id")))
  WHERE (("c"."id" = "client_invitations"."client_id") AND ("co"."user_id" = "auth"."uid"())))));



CREATE POLICY "Coaches can view reminders for their clients" ON "public"."check_in_reminders" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
           FROM "public"."coaches"
          WHERE ("coaches"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Coaches can view their clients check-ins" ON "public"."check_ins" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
           FROM "public"."coaches"
          WHERE ("coaches"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Coaches can view their clients tokens" ON "public"."check_in_tokens" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
           FROM "public"."coaches"
          WHERE ("coaches"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Coaches can view their own content" ON "public"."content_items" FOR SELECT TO "authenticated" USING (("coach_id" IN ( SELECT "coaches"."id"
   FROM "public"."coaches"
  WHERE ("coaches"."user_id" = "auth"."uid"()))));



CREATE POLICY "Coaches can view their own folders" ON "public"."content_folders" FOR SELECT TO "authenticated" USING (("coach_id" IN ( SELECT "coaches"."id"
   FROM "public"."coaches"
  WHERE ("coaches"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK ((("auth"."uid"() = "user_id") AND ("role" = ( SELECT "p"."role"
   FROM "public"."profiles" "p"
  WHERE ("p"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view own profile" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."attention_dismissals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."body_metrics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."check_in_exercise_highlights" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."check_in_reminders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."check_in_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."check_ins" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_goals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_intake" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_invitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clients_delete_daily_logs" ON "public"."daily_logs" FOR DELETE USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_delete_exercise_logs" ON "public"."exercise_logs" FOR DELETE USING (("session_log_id" IN ( SELECT "session_logs"."id"
   FROM "public"."session_logs"
  WHERE ("session_logs"."client_id" IN ( SELECT "clients"."id"
           FROM "public"."clients"
          WHERE ("clients"."user_id" = "auth"."uid"()))))));



CREATE POLICY "clients_delete_session_logs" ON "public"."session_logs" FOR DELETE USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_delete_set_logs" ON "public"."set_logs" FOR DELETE USING (("exercise_log_id" IN ( SELECT "exercise_logs"."id"
   FROM "public"."exercise_logs"
  WHERE ("exercise_logs"."session_log_id" IN ( SELECT "session_logs"."id"
           FROM "public"."session_logs"
          WHERE ("session_logs"."client_id" IN ( SELECT "clients"."id"
                   FROM "public"."clients"
                  WHERE ("clients"."user_id" = "auth"."uid"()))))))));



CREATE POLICY "clients_insert_daily_logs" ON "public"."daily_logs" FOR INSERT TO "authenticated" WITH CHECK (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_insert_exercise_highlights" ON "public"."check_in_exercise_highlights" FOR INSERT WITH CHECK (("check_in_id" IN ( SELECT "check_ins"."id"
   FROM "public"."check_ins"
  WHERE ("check_ins"."client_id" IN ( SELECT "clients"."id"
           FROM "public"."clients"
          WHERE ("clients"."user_id" = "auth"."uid"()))))));



CREATE POLICY "clients_insert_exercise_logs" ON "public"."exercise_logs" FOR INSERT WITH CHECK (("session_log_id" IN ( SELECT "session_logs"."id"
   FROM "public"."session_logs"
  WHERE ("session_logs"."client_id" IN ( SELECT "clients"."id"
           FROM "public"."clients"
          WHERE ("clients"."user_id" = "auth"."uid"()))))));



CREATE POLICY "clients_insert_own_check_ins" ON "public"."check_ins" FOR INSERT WITH CHECK (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_insert_own_daily_logs" ON "public"."daily_logs" FOR INSERT WITH CHECK (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_insert_own_nutrition_logs" ON "public"."nutrition_logs" FOR INSERT WITH CHECK (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_insert_own_training_logs" ON "public"."training_logs" FOR INSERT WITH CHECK (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_insert_own_wellness_logs" ON "public"."wellness_logs" FOR INSERT WITH CHECK (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_insert_session_logs" ON "public"."session_logs" FOR INSERT WITH CHECK (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_insert_set_logs" ON "public"."set_logs" FOR INSERT WITH CHECK (("exercise_log_id" IN ( SELECT "exercise_logs"."id"
   FROM "public"."exercise_logs"
  WHERE ("exercise_logs"."session_log_id" IN ( SELECT "session_logs"."id"
           FROM "public"."session_logs"
          WHERE ("session_logs"."client_id" IN ( SELECT "clients"."id"
                   FROM "public"."clients"
                  WHERE ("clients"."user_id" = "auth"."uid"()))))))));



CREATE POLICY "clients_manage_own_habit_logs" ON "public"."daily_habit_logs" TO "authenticated" USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"())))) WITH CHECK (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_select_exercise_logs" ON "public"."exercise_logs" FOR SELECT USING (("session_log_id" IN ( SELECT "session_logs"."id"
   FROM "public"."session_logs"
  WHERE ("session_logs"."client_id" IN ( SELECT "clients"."id"
           FROM "public"."clients"
          WHERE ("clients"."user_id" = "auth"."uid"()))))));



CREATE POLICY "clients_select_own_daily_logs" ON "public"."daily_logs" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_select_own_nutrition_logs" ON "public"."nutrition_logs" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_select_own_training_logs" ON "public"."training_logs" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_select_own_wellness_logs" ON "public"."wellness_logs" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_select_set_logs" ON "public"."set_logs" FOR SELECT USING (("exercise_log_id" IN ( SELECT "exercise_logs"."id"
   FROM "public"."exercise_logs"
  WHERE ("exercise_logs"."session_log_id" IN ( SELECT "session_logs"."id"
           FROM "public"."session_logs"
          WHERE ("session_logs"."client_id" IN ( SELECT "clients"."id"
                   FROM "public"."clients"
                  WHERE ("clients"."user_id" = "auth"."uid"()))))))));



CREATE POLICY "clients_update_daily_logs" ON "public"."daily_logs" FOR UPDATE TO "authenticated" USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"())))) WITH CHECK (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_update_exercise_logs" ON "public"."exercise_logs" FOR UPDATE USING (("session_log_id" IN ( SELECT "session_logs"."id"
   FROM "public"."session_logs"
  WHERE ("session_logs"."client_id" IN ( SELECT "clients"."id"
           FROM "public"."clients"
          WHERE ("clients"."user_id" = "auth"."uid"()))))));



CREATE POLICY "clients_update_own_daily_logs" ON "public"."daily_logs" FOR UPDATE USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_update_own_nutrition_logs" ON "public"."nutrition_logs" FOR UPDATE USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_update_own_training_logs" ON "public"."training_logs" FOR UPDATE USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_update_own_wellness_logs" ON "public"."wellness_logs" FOR UPDATE USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_update_session_logs" ON "public"."session_logs" FOR UPDATE USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_update_set_logs" ON "public"."set_logs" FOR UPDATE USING (("exercise_log_id" IN ( SELECT "exercise_logs"."id"
   FROM "public"."exercise_logs"
  WHERE ("exercise_logs"."session_log_id" IN ( SELECT "session_logs"."id"
           FROM "public"."session_logs"
          WHERE ("session_logs"."client_id" IN ( SELECT "clients"."id"
                   FROM "public"."clients"
                  WHERE ("clients"."user_id" = "auth"."uid"()))))))));



CREATE POLICY "clients_view_own_body_metrics" ON "public"."body_metrics" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_view_own_check_ins" ON "public"."check_ins" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_view_own_daily_logs" ON "public"."daily_logs" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_view_own_daily_targets" ON "public"."nutrition_plan_daily_targets" FOR SELECT USING (("nutrition_plan_id" IN ( SELECT "nutrition_plans"."id"
   FROM "public"."nutrition_plans"
  WHERE ("nutrition_plans"."client_id" IN ( SELECT "clients"."id"
           FROM "public"."clients"
          WHERE ("clients"."user_id" = "auth"."uid"()))))));



CREATE POLICY "clients_view_own_exercise_highlights" ON "public"."check_in_exercise_highlights" FOR SELECT USING (("check_in_id" IN ( SELECT "check_ins"."id"
   FROM "public"."check_ins"
  WHERE ("check_ins"."client_id" IN ( SELECT "clients"."id"
           FROM "public"."clients"
          WHERE ("clients"."user_id" = "auth"."uid"()))))));



CREATE POLICY "clients_view_own_goals" ON "public"."client_goals" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_view_own_habits" ON "public"."daily_habits" FOR SELECT TO "authenticated" USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_view_own_nutrition_events" ON "public"."nutrition_events" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_view_own_nutrition_plans" ON "public"."nutrition_plans" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_view_own_phases" ON "public"."phases" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_view_own_roadmaps" ON "public"."roadmaps" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_view_own_session_logs" ON "public"."session_logs" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_view_own_training_exercises" ON "public"."training_exercises" FOR SELECT USING (("session_id" IN ( SELECT "training_sessions"."id"
   FROM "public"."training_sessions"
  WHERE ("training_sessions"."plan_id" IN ( SELECT "training_plans"."id"
           FROM "public"."training_plans"
          WHERE ("training_plans"."client_id" IN ( SELECT "clients"."id"
                   FROM "public"."clients"
                  WHERE ("clients"."user_id" = "auth"."uid"()))))))));



CREATE POLICY "clients_view_own_training_plan_history" ON "public"."training_plan_history" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_view_own_training_plans" ON "public"."training_plans" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



CREATE POLICY "clients_view_own_training_sessions" ON "public"."training_sessions" FOR SELECT USING (("plan_id" IN ( SELECT "training_plans"."id"
   FROM "public"."training_plans"
  WHERE ("training_plans"."client_id" IN ( SELECT "clients"."id"
           FROM "public"."clients"
          WHERE ("clients"."user_id" = "auth"."uid"()))))));



CREATE POLICY "clients_view_own_weekly_summaries" ON "public"."nutrition_weekly_summaries" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."coach_client_views" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."coach_saved_exercises" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."coach_saved_plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."coach_saved_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."coaches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "coaches_manage_client_habits" ON "public"."daily_habits" TO "authenticated" USING ((("coach_id" IN ( SELECT "coaches"."id"
   FROM "public"."coaches"
  WHERE ("coaches"."user_id" = "auth"."uid"()))) AND ("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
           FROM "public"."coaches"
          WHERE ("coaches"."user_id" = "auth"."uid"()))))))) WITH CHECK ((("coach_id" IN ( SELECT "coaches"."id"
   FROM "public"."coaches"
  WHERE ("coaches"."user_id" = "auth"."uid"()))) AND ("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
           FROM "public"."coaches"
          WHERE ("coaches"."user_id" = "auth"."uid"())))))));



CREATE POLICY "coaches_manage_client_intake" ON "public"."client_intake" TO "authenticated" USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
           FROM "public"."coaches"
          WHERE ("coaches"."user_id" = "auth"."uid"())))))) WITH CHECK (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
           FROM "public"."coaches"
          WHERE ("coaches"."user_id" = "auth"."uid"()))))));



CREATE POLICY "coaches_select_client_daily_logs" ON "public"."daily_logs" FOR SELECT USING (("client_id" IN ( SELECT "c"."id"
   FROM ("public"."clients" "c"
     JOIN "public"."coaches" "co" ON (("co"."id" = "c"."coach_id")))
  WHERE ("co"."user_id" = "auth"."uid"()))));



CREATE POLICY "coaches_select_client_nutrition_logs" ON "public"."nutrition_logs" FOR SELECT USING (("client_id" IN ( SELECT "c"."id"
   FROM ("public"."clients" "c"
     JOIN "public"."coaches" "co" ON (("co"."id" = "c"."coach_id")))
  WHERE ("co"."user_id" = "auth"."uid"()))));



CREATE POLICY "coaches_select_client_training_logs" ON "public"."training_logs" FOR SELECT USING (("client_id" IN ( SELECT "c"."id"
   FROM ("public"."clients" "c"
     JOIN "public"."coaches" "co" ON (("co"."id" = "c"."coach_id")))
  WHERE ("co"."user_id" = "auth"."uid"()))));



CREATE POLICY "coaches_select_client_wellness_logs" ON "public"."wellness_logs" FOR SELECT USING (("client_id" IN ( SELECT "c"."id"
   FROM ("public"."clients" "c"
     JOIN "public"."coaches" "co" ON (("co"."id" = "c"."coach_id")))
  WHERE ("co"."user_id" = "auth"."uid"()))));



CREATE POLICY "coaches_view_client_body_metrics" ON "public"."body_metrics" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
           FROM "public"."coaches"
          WHERE ("coaches"."user_id" = "auth"."uid"()))))));



CREATE POLICY "coaches_view_client_daily_logs" ON "public"."daily_logs" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
           FROM "public"."coaches"
          WHERE ("coaches"."user_id" = "auth"."uid"()))))));



CREATE POLICY "coaches_view_client_daily_targets" ON "public"."nutrition_plan_daily_targets" FOR SELECT USING (("nutrition_plan_id" IN ( SELECT "nutrition_plans"."id"
   FROM "public"."nutrition_plans"
  WHERE ("nutrition_plans"."client_id" IN ( SELECT "clients"."id"
           FROM "public"."clients"
          WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
                   FROM "public"."coaches"
                  WHERE ("coaches"."user_id" = "auth"."uid"()))))))));



CREATE POLICY "coaches_view_client_exercise_logs" ON "public"."exercise_logs" FOR SELECT USING (("session_log_id" IN ( SELECT "session_logs"."id"
   FROM "public"."session_logs"
  WHERE ("session_logs"."client_id" IN ( SELECT "clients"."id"
           FROM "public"."clients"
          WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
                   FROM "public"."coaches"
                  WHERE ("coaches"."user_id" = "auth"."uid"()))))))));



CREATE POLICY "coaches_view_client_goals" ON "public"."client_goals" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
           FROM "public"."coaches"
          WHERE ("coaches"."user_id" = "auth"."uid"()))))));



CREATE POLICY "coaches_view_client_habit_logs" ON "public"."daily_habit_logs" FOR SELECT TO "authenticated" USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
           FROM "public"."coaches"
          WHERE ("coaches"."user_id" = "auth"."uid"()))))));



CREATE POLICY "coaches_view_client_nutrition_events" ON "public"."nutrition_events" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
           FROM "public"."coaches"
          WHERE ("coaches"."user_id" = "auth"."uid"()))))));



CREATE POLICY "coaches_view_client_nutrition_plans" ON "public"."nutrition_plans" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
           FROM "public"."coaches"
          WHERE ("coaches"."user_id" = "auth"."uid"()))))));



CREATE POLICY "coaches_view_client_phases" ON "public"."phases" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
           FROM "public"."coaches"
          WHERE ("coaches"."user_id" = "auth"."uid"()))))));



CREATE POLICY "coaches_view_client_roadmaps" ON "public"."roadmaps" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
           FROM "public"."coaches"
          WHERE ("coaches"."user_id" = "auth"."uid"()))))));



CREATE POLICY "coaches_view_client_session_logs" ON "public"."session_logs" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
           FROM "public"."coaches"
          WHERE ("coaches"."user_id" = "auth"."uid"()))))));



CREATE POLICY "coaches_view_client_set_logs" ON "public"."set_logs" FOR SELECT USING (("exercise_log_id" IN ( SELECT "exercise_logs"."id"
   FROM "public"."exercise_logs"
  WHERE ("exercise_logs"."session_log_id" IN ( SELECT "session_logs"."id"
           FROM "public"."session_logs"
          WHERE ("session_logs"."client_id" IN ( SELECT "clients"."id"
                   FROM "public"."clients"
                  WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
                           FROM "public"."coaches"
                          WHERE ("coaches"."user_id" = "auth"."uid"()))))))))));



CREATE POLICY "coaches_view_client_weekly_summaries" ON "public"."nutrition_weekly_summaries" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" = "auth"."uid"()))));



ALTER TABLE "public"."content_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."content_folders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."content_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_habit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_habits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "exercise_highlights_delete" ON "public"."check_in_exercise_highlights" FOR DELETE USING (("check_in_id" IN ( SELECT "check_ins"."id"
   FROM "public"."check_ins"
  WHERE ("check_ins"."client_id" IN ( SELECT "clients"."id"
           FROM "public"."clients"
          WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
                   FROM "public"."coaches"
                  WHERE ("coaches"."user_id" = "auth"."uid"()))))))));



CREATE POLICY "exercise_highlights_insert" ON "public"."check_in_exercise_highlights" FOR INSERT WITH CHECK (("check_in_id" IN ( SELECT "check_ins"."id"
   FROM "public"."check_ins"
  WHERE ("check_ins"."client_id" IN ( SELECT "clients"."id"
           FROM "public"."clients"
          WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
                   FROM "public"."coaches"
                  WHERE ("coaches"."user_id" = "auth"."uid"()))))))));



CREATE POLICY "exercise_highlights_select" ON "public"."check_in_exercise_highlights" FOR SELECT USING (("check_in_id" IN ( SELECT "check_ins"."id"
   FROM "public"."check_ins"
  WHERE ("check_ins"."client_id" IN ( SELECT "clients"."id"
           FROM "public"."clients"
          WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
                   FROM "public"."coaches"
                  WHERE ("coaches"."user_id" = "auth"."uid"()))))))));



CREATE POLICY "exercise_highlights_update" ON "public"."check_in_exercise_highlights" FOR UPDATE USING (("check_in_id" IN ( SELECT "check_ins"."id"
   FROM "public"."check_ins"
  WHERE ("check_ins"."client_id" IN ( SELECT "clients"."id"
           FROM "public"."clients"
          WHERE ("clients"."coach_id" IN ( SELECT "coaches"."id"
                   FROM "public"."coaches"
                  WHERE ("coaches"."user_id" = "auth"."uid"()))))))));



ALTER TABLE "public"."exercise_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."exercises" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."nutrition_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."nutrition_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."nutrition_plan_daily_targets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."nutrition_plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."nutrition_weekly_summaries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."phases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roadmaps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."session_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."set_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."training_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."training_exercises" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "training_exercises_delete" ON "public"."training_exercises" FOR DELETE USING (("session_id" IN ( SELECT "training_sessions"."id"
   FROM "public"."training_sessions"
  WHERE ("training_sessions"."plan_id" IN ( SELECT "training_plans"."id"
           FROM "public"."training_plans"
          WHERE ("training_plans"."client_id" IN ( SELECT "clients"."id"
                   FROM "public"."clients"
                  WHERE ("clients"."coach_id" = "auth"."uid"()))))))));



CREATE POLICY "training_exercises_insert" ON "public"."training_exercises" FOR INSERT WITH CHECK (("session_id" IN ( SELECT "training_sessions"."id"
   FROM "public"."training_sessions"
  WHERE ("training_sessions"."plan_id" IN ( SELECT "training_plans"."id"
           FROM "public"."training_plans"
          WHERE ("training_plans"."client_id" IN ( SELECT "clients"."id"
                   FROM "public"."clients"
                  WHERE ("clients"."coach_id" = "auth"."uid"()))))))));



CREATE POLICY "training_exercises_select" ON "public"."training_exercises" FOR SELECT USING (("session_id" IN ( SELECT "training_sessions"."id"
   FROM "public"."training_sessions"
  WHERE ("training_sessions"."plan_id" IN ( SELECT "training_plans"."id"
           FROM "public"."training_plans"
          WHERE ("training_plans"."client_id" IN ( SELECT "clients"."id"
                   FROM "public"."clients"
                  WHERE ("clients"."coach_id" = "auth"."uid"()))))))));



CREATE POLICY "training_exercises_update" ON "public"."training_exercises" FOR UPDATE USING (("session_id" IN ( SELECT "training_sessions"."id"
   FROM "public"."training_sessions"
  WHERE ("training_sessions"."plan_id" IN ( SELECT "training_plans"."id"
           FROM "public"."training_plans"
          WHERE ("training_plans"."client_id" IN ( SELECT "clients"."id"
                   FROM "public"."clients"
                  WHERE ("clients"."coach_id" = "auth"."uid"()))))))));



ALTER TABLE "public"."training_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."training_plan_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "training_plan_history_insert" ON "public"."training_plan_history" FOR INSERT WITH CHECK (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" = "auth"."uid"()))));



CREATE POLICY "training_plan_history_select" ON "public"."training_plan_history" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" = "auth"."uid"()))));



ALTER TABLE "public"."training_plans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "training_plans_delete" ON "public"."training_plans" FOR DELETE USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" = "auth"."uid"()))));



CREATE POLICY "training_plans_insert" ON "public"."training_plans" FOR INSERT WITH CHECK (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" = "auth"."uid"()))));



CREATE POLICY "training_plans_select" ON "public"."training_plans" FOR SELECT USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" = "auth"."uid"()))));



CREATE POLICY "training_plans_update" ON "public"."training_plans" FOR UPDATE USING (("client_id" IN ( SELECT "clients"."id"
   FROM "public"."clients"
  WHERE ("clients"."coach_id" = "auth"."uid"()))));



ALTER TABLE "public"."training_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "training_sessions_delete" ON "public"."training_sessions" FOR DELETE USING (("plan_id" IN ( SELECT "training_plans"."id"
   FROM "public"."training_plans"
  WHERE ("training_plans"."client_id" IN ( SELECT "clients"."id"
           FROM "public"."clients"
          WHERE ("clients"."coach_id" = "auth"."uid"()))))));



CREATE POLICY "training_sessions_insert" ON "public"."training_sessions" FOR INSERT WITH CHECK (("plan_id" IN ( SELECT "training_plans"."id"
   FROM "public"."training_plans"
  WHERE ("training_plans"."client_id" IN ( SELECT "clients"."id"
           FROM "public"."clients"
          WHERE ("clients"."coach_id" = "auth"."uid"()))))));



CREATE POLICY "training_sessions_select" ON "public"."training_sessions" FOR SELECT USING (("plan_id" IN ( SELECT "training_plans"."id"
   FROM "public"."training_plans"
  WHERE ("training_plans"."client_id" IN ( SELECT "clients"."id"
           FROM "public"."clients"
          WHERE ("clients"."coach_id" = "auth"."uid"()))))));



CREATE POLICY "training_sessions_update" ON "public"."training_sessions" FOR UPDATE USING (("plan_id" IN ( SELECT "training_plans"."id"
   FROM "public"."training_plans"
  WHERE ("training_plans"."client_id" IN ( SELECT "clients"."id"
           FROM "public"."clients"
          WHERE ("clients"."coach_id" = "auth"."uid"()))))));



ALTER TABLE "public"."wellness_logs" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT USAGE ON SCHEMA "public" TO "supabase_auth_admin";



REVOKE ALL ON FUNCTION "public"."archive_roadmap_atomic"("p_roadmap_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."archive_roadmap_atomic"("p_roadmap_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_age"("date_of_birth" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_age"("date_of_birth" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_age"("date_of_birth" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_client_adherence_stats"("client_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_client_adherence_stats"("client_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_client_adherence_stats"("client_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."clean_expired_tokens"() TO "anon";
GRANT ALL ON FUNCTION "public"."clean_expired_tokens"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."clean_expired_tokens"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_nutrition_plan_atomic"("p_client_id" "uuid", "p_coach_id" "uuid", "p_work_activity_level" "text", "p_training_volume_hours" "text", "p_protein_target_g_per_kg" numeric, "p_diet_type" "text", "p_goal_weight_kg" numeric, "p_goal_deadline" "date", "p_baseline_calories" integer, "p_protein_target_g" numeric, "p_carb_target_g" numeric, "p_fat_target_g" numeric, "p_base_weight_kg" numeric, "p_bmr" numeric, "p_tdee" numeric, "p_custom_macros_enabled" boolean, "p_custom_calories" numeric, "p_custom_protein_g" numeric, "p_custom_carb_g" numeric, "p_custom_fat_g" numeric, "p_regeneration_reason" "text", "p_daily_targets" "jsonb", "p_phase_id" "uuid", "p_coach_notes" "text", "p_goal_source" "text", "p_effective_from" "date", "p_today" "date", "p_recalc_snapshots" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_nutrition_plan_atomic"("p_client_id" "uuid", "p_coach_id" "uuid", "p_work_activity_level" "text", "p_training_volume_hours" "text", "p_protein_target_g_per_kg" numeric, "p_diet_type" "text", "p_goal_weight_kg" numeric, "p_goal_deadline" "date", "p_baseline_calories" integer, "p_protein_target_g" numeric, "p_carb_target_g" numeric, "p_fat_target_g" numeric, "p_base_weight_kg" numeric, "p_bmr" numeric, "p_tdee" numeric, "p_custom_macros_enabled" boolean, "p_custom_calories" numeric, "p_custom_protein_g" numeric, "p_custom_carb_g" numeric, "p_custom_fat_g" numeric, "p_regeneration_reason" "text", "p_daily_targets" "jsonb", "p_phase_id" "uuid", "p_coach_notes" "text", "p_goal_source" "text", "p_effective_from" "date", "p_today" "date", "p_recalc_snapshots" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_training_plan_atomic"("p_client_id" "uuid", "p_coach_id" "uuid", "p_name" "text", "p_description" "text", "p_coach_prompt" "text", "p_ai_response_raw" "text", "p_split_type" "text", "p_frequency_per_week" integer, "p_program_duration_weeks" integer, "p_client_weight_kg" numeric, "p_client_body_fat_percentage" numeric, "p_client_goal_weight_kg" numeric, "p_client_tdee" numeric, "p_avg_mood" numeric, "p_avg_energy" numeric, "p_avg_sleep" numeric, "p_avg_stress" numeric, "p_recent_adherence_percentage" numeric, "p_phase_id" "uuid", "p_effective_from" "date", "p_saved_plan_id" "uuid", "p_today" "date", "p_window_end" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_training_plan_atomic"("p_client_id" "uuid", "p_coach_id" "uuid", "p_name" "text", "p_description" "text", "p_coach_prompt" "text", "p_ai_response_raw" "text", "p_split_type" "text", "p_frequency_per_week" integer, "p_program_duration_weeks" integer, "p_client_weight_kg" numeric, "p_client_body_fat_percentage" numeric, "p_client_goal_weight_kg" numeric, "p_client_tdee" numeric, "p_avg_mood" numeric, "p_avg_energy" numeric, "p_avg_sleep" numeric, "p_avg_stress" numeric, "p_recent_adherence_percentage" numeric, "p_phase_id" "uuid", "p_effective_from" "date", "p_saved_plan_id" "uuid", "p_today" "date", "p_window_end" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_client_exercise_list"("p_client_id" "uuid", "p_start_date" "date", "p_end_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_client_exercise_list"("p_client_id" "uuid", "p_start_date" "date", "p_end_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_client_streak"("p_client_id" "uuid", "p_today" "date", "p_start_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_client_streak"("p_client_id" "uuid", "p_today" "date", "p_start_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_exercise_progression_window"("p_client_id" "uuid", "p_exercise_id" "uuid", "p_exercise_name" "text", "p_session_count" integer, "p_start_date" "date", "p_end_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_exercise_progression_window"("p_client_id" "uuid", "p_exercise_id" "uuid", "p_exercise_name" "text", "p_session_count" integer, "p_start_date" "date", "p_end_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_exercise_prs"("p_client_id" "uuid", "p_exercise_id" "uuid", "p_exercise_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_exercise_prs"("p_client_id" "uuid", "p_exercise_id" "uuid", "p_exercise_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_reminder_responded"() TO "anon";
GRANT ALL ON FUNCTION "public"."mark_reminder_responded"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_reminder_responded"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."transition_phase_atomic"("p_phase_id" "uuid", "p_coach_reflection" "text", "p_phase_summary" "jsonb", "p_next_action" "text", "p_archive_training" boolean, "p_archive_nutrition" boolean, "p_archive_habits" boolean, "p_today" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transition_phase_atomic"("p_phase_id" "uuid", "p_coach_reflection" "text", "p_phase_summary" "jsonb", "p_next_action" "text", "p_archive_training" boolean, "p_archive_nutrition" boolean, "p_archive_habits" boolean, "p_today" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_adherence_on_check_in"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_adherence_on_check_in"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_adherence_on_check_in"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_client_adherence_stats"("client_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."update_client_adherence_stats"("client_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_client_adherence_stats"("client_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_content_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_content_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_content_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_meal_plan_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_meal_plan_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_meal_plan_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_profiles_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_profiles_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_profiles_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_training_plan_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_training_plan_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_training_plan_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."upsert_daily_log_atomic"("p_client_id" "uuid", "p_date" "date", "p_notes" "text", "p_wellness" "jsonb", "p_nutrition" "jsonb", "p_training" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_daily_log_atomic"("p_client_id" "uuid", "p_date" "date", "p_notes" "text", "p_wellness" "jsonb", "p_nutrition" "jsonb", "p_training" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."upsert_daily_log_atomic"("p_client_id" "uuid", "p_date" "date", "p_notes" "text", "p_wellness" "jsonb", "p_nutrition" "jsonb", "p_training" "jsonb", "p_nutrition_plan_id" "uuid", "p_training_plan_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_daily_log_atomic"("p_client_id" "uuid", "p_date" "date", "p_notes" "text", "p_wellness" "jsonb", "p_nutrition" "jsonb", "p_training" "jsonb", "p_nutrition_plan_id" "uuid", "p_training_plan_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."attention_dismissals" TO "anon";
GRANT ALL ON TABLE "public"."attention_dismissals" TO "authenticated";
GRANT ALL ON TABLE "public"."attention_dismissals" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."body_metrics" TO "anon";
GRANT ALL ON TABLE "public"."body_metrics" TO "authenticated";
GRANT ALL ON TABLE "public"."body_metrics" TO "service_role";



GRANT ALL ON TABLE "public"."check_in_exercise_highlights" TO "anon";
GRANT ALL ON TABLE "public"."check_in_exercise_highlights" TO "authenticated";
GRANT ALL ON TABLE "public"."check_in_exercise_highlights" TO "service_role";



GRANT ALL ON TABLE "public"."check_in_reminders" TO "anon";
GRANT ALL ON TABLE "public"."check_in_reminders" TO "authenticated";
GRANT ALL ON TABLE "public"."check_in_reminders" TO "service_role";



GRANT ALL ON TABLE "public"."check_in_tokens" TO "anon";
GRANT ALL ON TABLE "public"."check_in_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."check_in_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."check_ins" TO "anon";
GRANT ALL ON TABLE "public"."check_ins" TO "authenticated";
GRANT ALL ON TABLE "public"."check_ins" TO "service_role";



GRANT ALL ON TABLE "public"."client_goals" TO "anon";
GRANT ALL ON TABLE "public"."client_goals" TO "authenticated";
GRANT ALL ON TABLE "public"."client_goals" TO "service_role";



GRANT ALL ON TABLE "public"."client_intake" TO "anon";
GRANT ALL ON TABLE "public"."client_intake" TO "authenticated";
GRANT ALL ON TABLE "public"."client_intake" TO "service_role";



GRANT ALL ON TABLE "public"."client_invitations" TO "anon";
GRANT ALL ON TABLE "public"."client_invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."client_invitations" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON TABLE "public"."coach_client_views" TO "anon";
GRANT ALL ON TABLE "public"."coach_client_views" TO "authenticated";
GRANT ALL ON TABLE "public"."coach_client_views" TO "service_role";



GRANT ALL ON TABLE "public"."coach_saved_exercises" TO "anon";
GRANT ALL ON TABLE "public"."coach_saved_exercises" TO "authenticated";
GRANT ALL ON TABLE "public"."coach_saved_exercises" TO "service_role";



GRANT ALL ON TABLE "public"."coach_saved_plans" TO "anon";
GRANT ALL ON TABLE "public"."coach_saved_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."coach_saved_plans" TO "service_role";



GRANT ALL ON TABLE "public"."coach_saved_sessions" TO "anon";
GRANT ALL ON TABLE "public"."coach_saved_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."coach_saved_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."coaches" TO "anon";
GRANT ALL ON TABLE "public"."coaches" TO "authenticated";
GRANT ALL ON TABLE "public"."coaches" TO "service_role";
GRANT ALL ON TABLE "public"."coaches" TO "supabase_auth_admin";



GRANT ALL ON TABLE "public"."content_assignments" TO "anon";
GRANT ALL ON TABLE "public"."content_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."content_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."content_folders" TO "anon";
GRANT ALL ON TABLE "public"."content_folders" TO "authenticated";
GRANT ALL ON TABLE "public"."content_folders" TO "service_role";



GRANT ALL ON TABLE "public"."content_items" TO "anon";
GRANT ALL ON TABLE "public"."content_items" TO "authenticated";
GRANT ALL ON TABLE "public"."content_items" TO "service_role";



GRANT ALL ON TABLE "public"."daily_habit_logs" TO "anon";
GRANT ALL ON TABLE "public"."daily_habit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_habit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."daily_habits" TO "anon";
GRANT ALL ON TABLE "public"."daily_habits" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_habits" TO "service_role";



GRANT ALL ON TABLE "public"."daily_logs" TO "anon";
GRANT ALL ON TABLE "public"."daily_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_logs" TO "service_role";



GRANT ALL ON TABLE "public"."nutrition_logs" TO "anon";
GRANT ALL ON TABLE "public"."nutrition_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."nutrition_logs" TO "service_role";



GRANT ALL ON TABLE "public"."training_logs" TO "anon";
GRANT ALL ON TABLE "public"."training_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."training_logs" TO "service_role";



GRANT ALL ON TABLE "public"."wellness_logs" TO "anon";
GRANT ALL ON TABLE "public"."wellness_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."wellness_logs" TO "service_role";



GRANT ALL ON TABLE "public"."daily_logs_full" TO "anon";
GRANT ALL ON TABLE "public"."daily_logs_full" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_logs_full" TO "service_role";



GRANT ALL ON TABLE "public"."exercise_logs" TO "anon";
GRANT ALL ON TABLE "public"."exercise_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."exercise_logs" TO "service_role";



GRANT ALL ON TABLE "public"."exercises" TO "anon";
GRANT ALL ON TABLE "public"."exercises" TO "authenticated";
GRANT ALL ON TABLE "public"."exercises" TO "service_role";



GRANT ALL ON TABLE "public"."nutrition_events" TO "anon";
GRANT ALL ON TABLE "public"."nutrition_events" TO "authenticated";
GRANT ALL ON TABLE "public"."nutrition_events" TO "service_role";



GRANT ALL ON TABLE "public"."nutrition_plan_daily_targets" TO "anon";
GRANT ALL ON TABLE "public"."nutrition_plan_daily_targets" TO "authenticated";
GRANT ALL ON TABLE "public"."nutrition_plan_daily_targets" TO "service_role";



GRANT ALL ON TABLE "public"."nutrition_plans" TO "anon";
GRANT ALL ON TABLE "public"."nutrition_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."nutrition_plans" TO "service_role";



GRANT ALL ON TABLE "public"."nutrition_weekly_summaries" TO "anon";
GRANT ALL ON TABLE "public"."nutrition_weekly_summaries" TO "authenticated";
GRANT ALL ON TABLE "public"."nutrition_weekly_summaries" TO "service_role";



GRANT ALL ON TABLE "public"."phases" TO "anon";
GRANT ALL ON TABLE "public"."phases" TO "authenticated";
GRANT ALL ON TABLE "public"."phases" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT ALL ON TABLE "public"."profiles" TO "supabase_auth_admin";



GRANT ALL ON TABLE "public"."roadmaps" TO "anon";
GRANT ALL ON TABLE "public"."roadmaps" TO "authenticated";
GRANT ALL ON TABLE "public"."roadmaps" TO "service_role";



GRANT ALL ON TABLE "public"."session_logs" TO "anon";
GRANT ALL ON TABLE "public"."session_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."session_logs" TO "service_role";



GRANT ALL ON TABLE "public"."set_logs" TO "anon";
GRANT ALL ON TABLE "public"."set_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."set_logs" TO "service_role";



GRANT ALL ON TABLE "public"."training_events" TO "anon";
GRANT ALL ON TABLE "public"."training_events" TO "authenticated";
GRANT ALL ON TABLE "public"."training_events" TO "service_role";



GRANT ALL ON TABLE "public"."training_exercises" TO "anon";
GRANT ALL ON TABLE "public"."training_exercises" TO "authenticated";
GRANT ALL ON TABLE "public"."training_exercises" TO "service_role";



GRANT ALL ON TABLE "public"."training_plan_history" TO "anon";
GRANT ALL ON TABLE "public"."training_plan_history" TO "authenticated";
GRANT ALL ON TABLE "public"."training_plan_history" TO "service_role";



GRANT ALL ON TABLE "public"."training_plans" TO "anon";
GRANT ALL ON TABLE "public"."training_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."training_plans" TO "service_role";



GRANT ALL ON TABLE "public"."training_sessions" TO "anon";
GRANT ALL ON TABLE "public"."training_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."training_sessions" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







