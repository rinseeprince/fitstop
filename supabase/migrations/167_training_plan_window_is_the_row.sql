-- =============================================================================
-- 167: a training program's window is the row.
--
-- WHY (owner decision 2026-09-10): a placed program's row carried no end. The
-- coach-side "plan for today" read kept resolving a finished program because
-- its window never closed, while the client, the attention feed and the block
-- facts derived the end from the count of active slot rows -- a count that
-- drifts by a day every time a session is edited "for this day only", because
-- that edit adds a second active row at the same slot. Two definitions of
-- "ended", and neither on the row. Nutrition solved the same problem in
-- migration 166 by storing the window; this migration gives training the same
-- shape, so both tracks answer "which plan governs this day" from one fact.
--
-- MODEL: every program is [effective_from, effective_until], both stored. The
-- end is decided ONCE at placement, by the same bound a nutrition version
-- takes -- the block covering the start, else the program's own length capped
-- at the day before the next block, either capped at the next plan -- and
-- moved only by the three writers that change a program's length (the
-- amendment, the block extension, the block shorten) and by a later placement,
-- which caps every earlier live program at the day before its own start. A
-- live program starting on the same day as a new placement never ran a day of
-- its own and is archived. Live windows never overlap: the exclusion below is
-- the backstop that must never fire.
--
-- WHAT THIS FILE DOES, in order:
--   A1  Repair archived rows carrying an inverted end (one on dev: a close
--       written at start - 1 by a pre-166 delete). An archived row governs
--       nothing; a one-day window is the same approximate claim 166's A1 made.
--   A2  Archive the OLDER of each same-day live pair (two on dev). Every
--       reader already tiebreaks a shared start on created_at DESC, so the
--       newer row is the one that governs; the older one is the ghost the
--       exclusion in A5 would otherwise trip on.
--   A3  Give every row without an end one: the start plus its active slot
--       rows minus one, capped at the day before the next live plan of the
--       same client, floored at the start. Every client is a test client and
--       prod holds zero rows, so this is the NOT NULL constraint's
--       requirement, not a product decision; it names the day each program's
--       calendar already stopped.
--   A4  effective_until NOT NULL, plus CHECK (effective_until >= effective_from).
--   A5  Live windows never overlap: a gist exclusion scoped to live rows, the
--       constraint nutrition_plans carries since 144.
--   A6  The placement RPC, same 23-argument signature (CREATE OR REPLACE
--       keeps its grants; they are restated regardless). The end is required
--       and written; every earlier live program still reaching the start is
--       capped at the day before; a same-day live program is archived; a
--       later live program inside the requested window raises, because the
--       caller already capped the window at the next plan and a plan inside
--       it can only be a race.
--
-- Pure ASCII inside the $$ body (the CLI splitter is byte-fragile).
-- =============================================================================

-- A1: an inverted end on an archived row becomes a one-day window.
UPDATE public.training_plans
SET effective_until = effective_from,
    updated_at = NOW()
WHERE effective_until IS NOT NULL
  AND effective_until < effective_from;

-- A2: of two live programs sharing a start, the older is archived.
UPDATE public.training_plans p
SET status = 'archived',
    updated_at = NOW()
WHERE p.deleted_at IS NULL
  AND p.status <> 'archived'
  AND EXISTS (
    SELECT 1
    FROM public.training_plans q
    WHERE q.client_id = p.client_id
      AND q.effective_from = p.effective_from
      AND q.deleted_at IS NULL
      AND q.status <> 'archived'
      AND q.id <> p.id
      AND (q.created_at > p.created_at OR (q.created_at = p.created_at AND q.id > p.id))
  );

-- A3: every row without an end gets the day its calendar already stopped.
UPDATE public.training_plans p
SET effective_until = GREATEST(
      p.effective_from,
      LEAST(
        COALESCE(
          (SELECT n.effective_from - 1
           FROM public.training_plans n
           WHERE n.client_id = p.client_id
             AND n.deleted_at IS NULL
             AND n.status <> 'archived'
             AND n.effective_from > p.effective_from
           ORDER BY n.effective_from
           LIMIT 1),
          'infinity'::date),
        p.effective_from
          + GREATEST(1, (SELECT COUNT(*) FROM public.training_sessions s
                         WHERE s.plan_id = p.id AND s.is_active))::int
          - 1
      )
    ),
    updated_at = NOW()
WHERE p.effective_until IS NULL;

-- A4: the column IS the window.
ALTER TABLE public.training_plans
  ALTER COLUMN effective_until SET NOT NULL;

ALTER TABLE public.training_plans
  DROP CONSTRAINT IF EXISTS training_plans_window_valid;

ALTER TABLE public.training_plans
  ADD CONSTRAINT training_plans_window_valid
  CHECK (effective_until >= effective_from);

COMMENT ON COLUMN public.training_plans.effective_until IS
  'The last day this program prescribes. Always written (migration 167): decided at placement like a nutrition version''s end -- the block covering the start, else the program''s own length capped at the day before the next block, either capped at the next plan -- and moved only by the amendment, the block extension, the block shorten and a later placement, which caps every earlier live program at the day before its start. Delete ends a running program at yesterday. No open (NULL) row exists.';

-- A5: live windows never overlap. btree_gist supplies `uuid WITH =`; installed
-- by 144 and 164, restated so this file stands alone.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.training_plans
  DROP CONSTRAINT IF EXISTS training_plans_live_window_overlap;

ALTER TABLE public.training_plans
  ADD CONSTRAINT training_plans_live_window_overlap
  EXCLUDE USING gist (
    client_id WITH =,
    daterange(effective_from, effective_until, '[]') WITH &&
  )
  WHERE (deleted_at IS NULL AND status <> 'archived');

-- A6: the placement RPC. Same signature as 114; body restated in full.
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
  p_phase_id UUID,
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
  -- model this migration retires. The signature keeps its DEFAULT NULL so the
  -- 23-argument overload stands; the body is where the requirement lives.
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
    phase_id, saved_plan_id
  ) VALUES (
    p_client_id, p_coach_id, p_name, p_description, 'active', v_effective_from, p_window_end,
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

-- CREATE OR REPLACE keeps the function's ACL, but migration 106's lockdown is
-- restated so this file says who may execute it.
REVOKE EXECUTE ON FUNCTION public.create_training_plan_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, UUID, DATE, UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_training_plan_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, UUID, DATE, UUID, DATE, DATE) TO service_role;
