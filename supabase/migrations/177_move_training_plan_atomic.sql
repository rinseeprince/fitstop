-- =============================================================================
-- 177: a program that hasn't started moves to a new start date.
--
-- A coach who placed a program on the wrong day moves it from the Plans hero
-- rather than deleting it and doing the client's customisation again. The
-- whole program moves as it is on the calendar: its start, its end and every
-- session between them shift by the same number of days, in one transaction.
-- It keeps its length and gains no day it lost when it was placed.
--
-- The only caller, services/training-plan-move-service.ts, passes the client's
-- deletion floor - the one answer to "from which day may a program start"
-- (services/event-deletion-floor.ts). A program whose start is before the
-- floor has started, and does not move.
--
-- In order:
--   1. Lock the plan and every day the move reads or writes.
--   2. Refuse, in this order:
--        started:           the program starts before the floor, or one of its
--                           days has been logged since the caller read it
--        before_floor:<day> the new start is before the floor
--        overlap:<name>     another live program's window meets the new dates
--        block:<edge>:<name> the new dates cross the start or the end of a
--                           block (a block contains its plans)
--        occupied:<day>     a session would land on a day that already holds
--                           one, in any status
--   3. The plan row takes its new window.
--   4. The program's sessions are parked far outside any real calendar and then
--      placed the same number of days on - park-then-place, as migration 150
--      does - so the one-scheduled-session-per-day index (migration 136) holds
--      after every statement. A session keeps its id, the row it points at and
--      its edited mark; only its date changes.
--
-- Nothing else is written. The session rows count their days from the plan's
-- start, so they stay as they are; a nutrition day is computed from the
-- sessions on its date; the moved window's new updated_at is what turns an
-- Edit plan editor open on this plan stale.
--
-- Error contract (message prefixes the caller maps): invalid:, not_found:,
-- started:, before_floor:, overlap:, block:start: / block:end:, occupied:.
-- The live-window exclusion (23P01) and the one-scheduled-per-day index
-- (23505) stay the backstops for a write landing between the checks and the
-- move.
--
-- Pure ASCII inside the $$ body (the CLI splitter is byte-fragile).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.move_training_plan_atomic(
  p_client_id UUID,
  p_plan_id UUID,
  p_starts_on DATE,
  p_floor DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- A park far before any real calendar (about 700 BC); every parked date stays
  -- distinct because every session moves by the same offset.
  c_park CONSTANT INTEGER := 1000000;
  v_plan RECORD;
  v_shift INTEGER;
  v_from DATE;
  v_until DATE;
  v_other RECORD;
  v_block RECORD;
  v_day DATE;
  v_moved INTEGER := 0;
BEGIN
  IF p_starts_on IS NULL OR p_floor IS NULL THEN
    RAISE EXCEPTION 'invalid: a new start and the floor are required';
  END IF;

  SELECT id, effective_from, effective_until
    INTO v_plan
    FROM training_plans
   WHERE id = p_plan_id
     AND client_id = p_client_id
     AND deleted_at IS NULL
     AND status <> 'archived'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: plan % is not a live plan of this client', p_plan_id;
  END IF;

  IF v_plan.effective_from < p_floor THEN
    RAISE EXCEPTION 'started: the program started on %', v_plan.effective_from;
  END IF;
  IF p_starts_on < p_floor THEN
    RAISE EXCEPTION 'before_floor:%', p_floor;
  END IF;

  v_shift := p_starts_on - v_plan.effective_from;
  IF v_shift = 0 THEN
    RETURN jsonb_build_object(
      'starts_on', v_plan.effective_from,
      'ends_on', v_plan.effective_until,
      'sessions_moved', 0
    );
  END IF;
  v_from := v_plan.effective_from + v_shift;
  v_until := v_plan.effective_until + v_shift;

  -- 1. Every day the move reads or writes, locked.
  PERFORM 1
    FROM training_events
   WHERE client_id = p_client_id
     AND date BETWEEN LEAST(v_plan.effective_from, v_from)
                  AND GREATEST(v_plan.effective_until, v_until)
   FOR UPDATE;

  -- 2. The refusals.
  IF EXISTS (
    SELECT 1
      FROM training_events
     WHERE client_id = p_client_id
       AND date BETWEEN v_plan.effective_from AND v_plan.effective_until
       AND status <> 'scheduled'
  ) THEN
    RAISE EXCEPTION 'started: a day of the program has been logged';
  END IF;

  SELECT name
    INTO v_other
    FROM training_plans
   WHERE client_id = p_client_id
     AND id <> p_plan_id
     AND deleted_at IS NULL
     AND status <> 'archived'
     AND effective_from <= v_until
     AND effective_until >= v_from
   ORDER BY effective_from
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'overlap:%', v_other.name;
  END IF;

  -- A block the new dates meet without holding them whole: they cross its
  -- start when they begin before it, else its end.
  SELECT name, starts_on
    INTO v_block
    FROM client_phases
   WHERE client_id = p_client_id
     AND archived_at IS NULL
     AND starts_on <= v_until
     AND ends_on >= v_from
     AND NOT (starts_on <= v_from AND ends_on >= v_until)
   ORDER BY starts_on
   LIMIT 1;
  IF FOUND THEN
    IF v_block.starts_on > v_from THEN
      RAISE EXCEPTION 'block:start:%', v_block.name;
    END IF;
    RAISE EXCEPTION 'block:end:%', v_block.name;
  END IF;

  -- A day a session lands on that holds anything the move does not carry.
  SELECT held.date
    INTO v_day
    FROM training_events held
    JOIN training_events moving
      ON moving.client_id = held.client_id
     AND moving.date + v_shift = held.date
   WHERE held.client_id = p_client_id
     AND moving.date BETWEEN v_plan.effective_from AND v_plan.effective_until
     AND held.date NOT BETWEEN v_plan.effective_from AND v_plan.effective_until
   ORDER BY held.date
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'occupied:%', v_day;
  END IF;

  -- 3. The window.
  UPDATE training_plans
     SET effective_from = v_from,
         effective_until = v_until,
         updated_at = now()
   WHERE id = p_plan_id;

  -- 4. Park, then place.
  UPDATE training_events
     SET date = date - c_park
   WHERE client_id = p_client_id
     AND date BETWEEN v_plan.effective_from AND v_plan.effective_until;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  UPDATE training_events
     SET date = date + c_park + v_shift,
         updated_at = now()
   WHERE client_id = p_client_id
     AND date BETWEEN v_plan.effective_from - c_park AND v_plan.effective_until - c_park;

  RETURN jsonb_build_object(
    'starts_on', v_from,
    'ends_on', v_until,
    'sessions_moved', v_moved
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.move_training_plan_atomic(UUID, UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_training_plan_atomic(UUID, UUID, DATE, DATE) TO service_role;

COMMENT ON FUNCTION public.move_training_plan_atomic(UUID, UUID, DATE, DATE) IS
  'Move a program that has not started to a new start date: its window and every session between its start and end shift by the same number of days in one transaction, refusing a start before the floor, an overlap, a block edge or a day that already holds a session. Called only by services/training-plan-move-service.ts.';

COMMENT ON COLUMN public.training_plans.effective_until IS
  'The last day this program prescribes. Always written (migration 167): decided at placement - the block covering the start, else the program''s own length capped at the day before the next block, either capped at the next plan - and moved by the plan editor''s save, a block trim, a later placement (which caps every earlier live program at the day before its start), Delete plan (a running program ends yesterday) and a start-date move (migration 177), which shifts the whole window. No open (NULL) row exists.';
