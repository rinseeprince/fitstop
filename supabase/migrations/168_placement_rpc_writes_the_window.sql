-- =============================================================================
-- 168: the placement RPC writes the window -- on the signature that is live.
--
-- WHY: 167's A6 restated the RPC from migration 114, whose signature carries
-- p_phase_id. Migration 133 had already dropped that column and replaced the
-- function with a 22-argument overload without it. CREATE OR REPLACE therefore
-- created a SECOND function (23 arguments, referencing a column that no
-- longer exists) instead of replacing the live one, and the service -- which
-- calls by name without p_phase_id -- kept resolving to 133's body, which
-- inserts a NULL end that 167's NOT NULL now refuses. Every placement failed.
-- 167 is applied and tracked, so the fix is this file, not an edit (CONVENTIONS
-- section 8): drop the stray overload, and give the live 22-argument overload
-- the body 167 intended. 167's A1-A5 (repair, same-day archive, backfill,
-- NOT NULL + CHECK, exclusion) were correct and stand.
--
-- Pure ASCII inside the $$ body (the CLI splitter is byte-fragile).
-- =============================================================================

-- The stray 23-argument overload 167 created (UUID p_phase_id at position 19).
DROP FUNCTION IF EXISTS public.create_training_plan_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, UUID, DATE, UUID, DATE, DATE);

-- The live overload (133's signature), with the window model's body.
CREATE OR REPLACE FUNCTION public.create_training_plan_atomic(
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
  v_next_start DATE;
  v_new_plan_id UUID;
BEGIN
  -- The window is the row (migration 167): a placement without an end is the
  -- model that migration retired. The signature keeps its DEFAULT NULL so the
  -- overload stands; the body is where the requirement lives.
  IF p_window_end IS NULL THEN
    RAISE EXCEPTION
      'training plan placement requires p_window_end (start %)', v_effective_from
      USING HINT = 'services/library-placement-service.ts resolves the window before calling; a caller that omits it is a bug on that side.';
  END IF;

  IF p_window_end < v_effective_from THEN
    RAISE EXCEPTION
      'training plan window cannot end before it starts (start %, end %)',
      v_effective_from, p_window_end
      USING HINT = 'p_window_end is the placement''s last day and must be on or after its first.';
  END IF;

  -- Serialize concurrent placements on this client: every live program is
  -- locked for the transaction. Racing FIRST placements have nothing to lock
  -- and collide on the exclusion instead (23P01) -- loud, never silent drift.
  PERFORM 1
  FROM training_plans
  WHERE client_id = p_client_id
    AND deleted_at IS NULL
    AND status <> 'archived'
  FOR UPDATE;

  -- A later live program inside the requested window can only be a race: the
  -- caller capped the window at the next plan's start before calling
  -- (getNextPlanStartCap). Raise rather than silently shorten, because the
  -- caller generates events to the window it asked for.
  SELECT MIN(effective_from) INTO v_next_start
  FROM training_plans
  WHERE client_id = p_client_id
    AND deleted_at IS NULL
    AND status <> 'archived'
    AND effective_from > v_effective_from;

  IF v_next_start IS NOT NULL AND v_next_start <= p_window_end THEN
    RAISE EXCEPTION
      'a program starting % already occupies the requested window (start %, end %)',
      v_next_start, v_effective_from, p_window_end
      USING HINT = 'Another placement landed between the window read and this call; place again.';
  END IF;

  -- A placement supersedes the earlier programs from its start day: every
  -- live program that started earlier and still reaches the start ends the
  -- day before. Convergence, never deletion -- its days before the start
  -- stay its own, on the calendar and on every block it ran in.
  UPDATE training_plans
  SET effective_until = v_effective_from - 1,
      updated_at = NOW()
  WHERE client_id = p_client_id
    AND deleted_at IS NULL
    AND status <> 'archived'
    AND effective_from < v_effective_from
    AND effective_until >= v_effective_from;

  -- A live program starting on the same day never ran a day of its own and
  -- has nothing left on either side of the new one: archived.
  UPDATE training_plans
  SET status = 'archived',
      updated_at = NOW()
  WHERE client_id = p_client_id
    AND deleted_at IS NULL
    AND status <> 'archived'
    AND effective_from = v_effective_from;

  -- Clear the incoming program's own future window so the freshly generated
  -- events have empty slots to land in (re-placing the same window is
  -- idempotent). status='scheduled' preserves completed/missed history and
  -- the GREATEST() floor preserves the past. The earlier programs' days past
  -- this window are the service's to remove after the commit
  -- (cancelFutureEventsForPlans), because a failure there must not roll a
  -- committed placement back.
  DELETE FROM training_events
  WHERE client_id = p_client_id
    AND status = 'scheduled'
    AND date >= GREATEST(v_effective_from, v_today)
    AND date <= p_window_end;

  -- Insert the new program as provenance, its window on the row. Always
  -- 'active': reads are date-driven off the window.
  INSERT INTO training_plans (
    client_id, coach_id, name, description, status, effective_from, effective_until,
    coach_prompt, ai_response_raw, split_type, frequency_per_week,
    program_duration_weeks, client_weight_kg, client_body_fat_percentage,
    client_goal_weight_kg, client_tdee,
    avg_mood, avg_energy, avg_sleep, avg_stress, recent_adherence_percentage,
    saved_plan_id
  ) VALUES (
    p_client_id, p_coach_id, p_name, p_description, 'active', v_effective_from, p_window_end,
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

-- CREATE OR REPLACE keeps the function's ACL; migration 106's lockdown is
-- restated so this file says who may execute it.
REVOKE EXECUTE ON FUNCTION public.create_training_plan_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, DATE, UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_training_plan_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, DATE, UUID, DATE, DATE) TO service_role;
