-- =============================================================================
-- 144: nutrition_plans becomes DATE-RANGED VERSIONS (the training-plans model).
--
-- WHY: this REVERSES the recorded single-durable-plan decision (CONVENTIONS
-- "one durable active plan per client, edited in place, no versioning") --
-- owner-approved 2026-08-11, stale-premise class (b) per the execution plan's
-- Section 3. The premise died with migration 143: once effective_from could sit
-- in the future, the single in-place row could only describe the NEXT
-- prescription, and nothing anywhere described the time before it except the
-- generated events (the pre-window cascade leak, the client-card gate serving
-- nothing, reset unable to restore, null history attribution, mixed-era
-- deficits). Versioning is also a RESTORATION: this RPC was close-and-insert
-- from migration 048 through 110 (078 is the nearest template); 115 flattened
-- it to the in-place upsert this migration retires.
--
-- MODEL: N rows per client whose [effective_from, effective_until] windows
-- tile the client's timeline; effective_until IS NULL = the open (latest-saved)
-- version. "Active" is resolved BY DATE (the version covering the date), never
-- by picking the newest status='active' row. status records coach acts only:
-- 'active' | 'archived'. Superseded versions stay 'active' with closed
-- windows. Versions are minted ONLY by plan saves; per-day coach edits still
-- materialize onto nutrition_events (is_modified) and never mint versions.
--
-- WHAT THIS FILE DOES, in order:
--   A1  Close the windows of legacy archived rows (116's COALESCE precedent).
--       History reads carry NO status filter under this model, so an archived
--       row with an open window would claim every date since its start. The
--       old archiveNutritionPlan flipped status without closing the window.
--       Residue, accepted: a legacy archived row keeps a one-day [from, from]
--       approximate claim -- immaterial pre-launch data; new-model rows never
--       take this shape.
--   A2  Swap the singleton guard for the open-row guard. The old unique index
--       (one active row per client) is the in-place model; the new partial
--       unique index -- idx_nutrition_plans_open_unique, (client_id) WHERE
--       status='active' AND effective_until IS NULL -- guarantees at most ONE
--       open version per client and is the loud backstop for racing first
--       saves (23505).
--   A3  btree_gist + an exclusion constraint so the database physically
--       refuses overlapping active windows. It is a BACKSTOP that must never
--       fire; a violation is a loud RPC error, never silent drift.
--       DELIBERATELY NON-DEFERRABLE: the RPC below orders its statements
--       (belt -> close -> sweep -> absorb/insert) so that EVERY intermediate
--       statement state is constraint-clean, and immediate checking is what
--       proves that ordering. Declaring this DEFERRABLE would re-open the
--       ordering question while looking like an improvement. Do not.
--   A4  The RPC rewritten close-and-insert at the IDENTICAL 24-arg signature.
--
-- WHY A2 AND A4 MUST STAY IN THIS ONE FILE: the old RPC's
-- ON CONFLICT (client_id) WHERE status='active' requires the index A2 drops.
-- The supabase CLI applies each migration file in a SINGLE TRANSACTION and
-- Postgres DDL is transactional, so the index drop and the function
-- replacement become visible atomically at commit; a concurrent save blocks on
-- DROP INDEX's ACCESS EXCLUSIVE table lock until then and resumes against the
-- fully-new state. There is no observable between-statements window. (No
-- migration in this repo uses CONCURRENTLY or any other non-transactional
-- construct -- verified -- and this file must never gain one.) Worst case if
-- some future tool ever replayed statements non-transactionally: loud save
-- errors between statements, never corruption.
--
-- THE RPC (three branches on the client's open row, then a universal sweep):
--   (a) no open row              -> plain INSERT of the new version.
--   (b) open row starts BEFORE   -> close it at new_start - 1, INSERT.
--   (c) open row starts ON/AFTER -> ABSORB: update that row in place (all 21
--       always-update columns + effective_from; its daily-targets grid is
--       replaced by the DELETE-then-INSERT below, which is load-bearing here).
--       Same-day re-saves collapse into one version; saving earlier than a
--       queued change replaces it; the open row can never be closed before its
--       own start, so inverted windows are unconstructible.
--   Universal sweep (BOTH paths -- implements the design's "placing a plan on
--   top replaces the overlapped days from its start forward"):
--     s1  DELETE active rows with effective_from >= new_start, excluding the
--         absorb survivor via IS DISTINCT FROM (plain <> against NULL matches
--         nothing, which would silently skip the sweep on the insert path).
--         These are fully-replaced versions. Owner ruling 2026-08-11: hard
--         DELETE, not archive -- a replaced version starting at/after
--         new_start governed at most part of one day; the day's display and
--         scoring truth live in the nutrition_logs snapshot (the priority-1
--         read), same-day collapse is branch (c)'s own semantics for the open
--         row, and any retained window would corrupt no-status-filter history
--         attribution. Daily targets CASCADE; events/logs FKs are SET NULL;
--         the save's own regeneration re-stamps its window's events.
--     s2  Re-close the straddler at new_start - 1: an active row with
--         effective_from < new_start whose window reaches new_start. NULL-safe
--         (never matches the open row). REQUIRED ON THE INSERT PATH TOO:
--         deleting a plan closes the covering version AT today and leaves it
--         active, so a same-day re-create's INSERT would otherwise overlap it
--         on that one day and trip the exclusion constraint.
--
-- BELT: the RPC refuses v_new_start < v_today. This is CALLER-COOPERATIVE,
-- not a DB invariant -- p_today is caller-supplied, so the check binds
-- p_effective_from to the caller's OWN claimed today. What it buys: a future
-- write path that forgets the route's past-date guard fails loudly instead of
-- turning s1 into a history shredder (a past date would sweep every version
-- from that date forward). It is no defense against a caller that supplies a
-- wrong p_today. The one production caller threads the same client-local
-- today the route guard judged, so route-accept implies RPC-accept.
--
-- RACES: the open-row SELECT ... FOR UPDATE serializes concurrent saves on an
-- existing plan (the second applies sequentially on top of the first).
-- First-save races have no row to lock; depending on interleaving they either
-- collide loudly on idx_nutrition_plans_open_unique (23505) or the later
-- transaction's s1 removes the earlier row and replaces it -- the same end
-- state a sequential absorb produces, never corruption.
--
-- Same-signature CREATE OR REPLACE: no DROP (would discard the ACL), no
-- REVOKE/GRANT re-apply (preserved by an in-place replace -- 143's verified
-- precedent). SECURITY DEFINER and SET search_path are restated because a
-- replace is a total redefinition; omitting either silently drops it with no
-- error at push time. Verify pre/post against the live catalog: prosecdef,
-- proconfig, proacl, exactly one pg_proc row.
--
-- Pure ASCII inside the $$ body (the old supabase CLI splitter is
-- byte-fragile).
-- =============================================================================

-- A1: close legacy archived rows' windows (idempotent by predicate).
UPDATE nutrition_plans
SET effective_until = COALESCE(effective_until, effective_from),
    updated_at = NOW()
WHERE status = 'archived' AND effective_until IS NULL;

-- A2: singleton guard -> open-row guard.
DROP INDEX IF EXISTS idx_nutrition_plans_active_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_nutrition_plans_open_unique
  ON nutrition_plans (client_id)
  WHERE status = 'active' AND effective_until IS NULL;

-- A3: the overlap backstop. Existing data satisfies it trivially (the old
-- index guaranteed at most one active row per client). effective_from is NOT
-- NULL; a NULL effective_until produces an unbounded-above range, which is
-- exactly right for the open row.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE nutrition_plans
  DROP CONSTRAINT IF EXISTS nutrition_plans_active_window_overlap;

ALTER TABLE nutrition_plans
  ADD CONSTRAINT nutrition_plans_active_window_overlap
  EXCLUDE USING gist (
    client_id WITH =,
    daterange(effective_from, effective_until, '[]') WITH &&
  )
  WHERE (status = 'active');

-- A4: the RPC, close-and-insert at the identical 24-arg signature.
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
  v_new_start DATE := COALESCE(p_effective_from, v_today);
  v_open_id UUID;
  v_open_from DATE;
  v_new_plan_id UUID;
  v_target JSONB;
BEGIN
  -- Caller-cooperative belt (see header): a past-dated save would make the
  -- sweep below erase every version from that date forward. The message is
  -- deliberately unlike PostgREST's function-resolution errors so a log line
  -- can never be misread as a PGRST202 arity break.
  IF v_new_start < v_today THEN
    RAISE EXCEPTION
      'nutrition plan version cannot start before p_today (start %, today %)',
      v_new_start, v_today
      USING HINT = 'The route rejects past effective dates; this belt keeps a future caller that skips it from sweeping version history.';
  END IF;

  -- Lock the open version so concurrent saves on an existing plan serialize.
  -- First-save races have nothing to lock and collide on
  -- idx_nutrition_plans_open_unique instead (see header).
  SELECT id, effective_from INTO v_open_id, v_open_from
  FROM nutrition_plans
  WHERE client_id = p_client_id
    AND status = 'active'
    AND effective_until IS NULL
  FOR UPDATE;

  -- (b) the open version started before the new date: close it. After this,
  -- its window ends at v_new_start - 1, so neither sweep statement matches it.
  IF v_open_id IS NOT NULL AND v_open_from < v_new_start THEN
    UPDATE nutrition_plans
    SET effective_until = v_new_start - 1,
        updated_at = NOW()
    WHERE id = v_open_id;
  END IF;

  -- s1: remove fully-replaced versions (see header for the DELETE ruling).
  -- IS DISTINCT FROM keeps the sweep total on the insert path, where
  -- v_open_id is NULL and a plain <> would match nothing.
  DELETE FROM nutrition_plans
  WHERE client_id = p_client_id
    AND status = 'active'
    AND effective_from >= v_new_start
    AND id IS DISTINCT FROM v_open_id;

  -- s2: re-close the straddler. NULL-safe: the open row (effective_until IS
  -- NULL) never matches; required on the insert path for the
  -- delete-today-then-recreate-today flow (see header).
  UPDATE nutrition_plans
  SET effective_until = v_new_start - 1,
      updated_at = NOW()
  WHERE client_id = p_client_id
    AND status = 'active'
    AND effective_from < v_new_start
    AND effective_until >= v_new_start;

  IF v_open_id IS NOT NULL AND v_open_from >= v_new_start THEN
    -- (c) ABSORB: the open version starts on/after the new date. Update it in
    -- place: the same 21 always-update columns as 143's conflict path plus
    -- effective_from; id/client_id/status/name/created_at untouched, so the
    -- row keeps its birth date and its identity.
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
      effective_from = v_new_start,
      effective_until = NULL,
      updated_at = NOW()
    WHERE id = v_open_id
    RETURNING id INTO v_new_plan_id;
  ELSE
    -- (a)/(b): insert the new open version. 143's column list verbatim; no
    -- ON CONFLICT -- the arbiter index is gone, and the sweep above already
    -- guaranteed a clean window.
    INSERT INTO nutrition_plans (
      client_id, coach_id, status, effective_from,
      work_activity_level, training_volume_hours, protein_target_g_per_kg,
      diet_type, goal_weight_kg, goal_deadline,
      baseline_calories, protein_target_g, carb_target_g, fat_target_g,
      base_weight_kg, bmr, tdee,
      custom_macros_enabled, custom_calories, custom_protein_g, custom_carb_g, custom_fat_g,
      regeneration_reason
    ) VALUES (
      p_client_id, p_coach_id, 'active', v_new_start,
      p_work_activity_level, p_training_volume_hours, p_protein_target_g_per_kg,
      p_diet_type, p_goal_weight_kg, p_goal_deadline,
      p_baseline_calories, p_protein_target_g, p_carb_target_g, p_fat_target_g,
      p_base_weight_kg, p_bmr, p_tdee,
      p_custom_macros_enabled, p_custom_calories, p_custom_protein_g, p_custom_carb_g, p_custom_fat_g,
      p_regeneration_reason
    )
    RETURNING id INTO v_new_plan_id;
  END IF;

  -- Replace the surviving version's daily-target grid. DELETE-then-INSERT is
  -- load-bearing on the absorb path (the absorbed version keeps its id but
  -- gets the new prescription's grid); on a fresh insert the DELETE is a
  -- no-op, kept unconditional so there is one code path.
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
