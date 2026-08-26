-- 150_move_training_events_atomic.sql
--
-- A client (or coach) rearranges a week: N still-scheduled training events
-- change date in ONE transaction. Replaces "N sequential moves", which cannot
-- express a rotation or a swap under migration 136's one-scheduled-session-
-- per-day index — the first move lands on a day the second has not vacated.
--
-- Park-then-place: every moving row is first parked on a unique far-future
-- sentinel date (vacating every source day), then placed on its target. The
-- partial unique index is satisfied at each statement, so no schema change
-- and no deferrable constraint is needed, and a failure anywhere rolls the
-- whole layout back. (Migration 144's exclusion constraint chose ordered
-- statements over deferral because that RPC has a natural order; a
-- rearrangement has none, hence the park step.)
--
-- Invariants enforced HERE — the write-time truths a route cannot prove:
--   * every event exists and belongs to p_client_id           -> not_found
--   * every event is still `scheduled`                       -> not_scheduled
--   * every event is still on the from_date the caller saw   -> drift
--   * no two moves share a target, no event appears twice    -> duplicate_*
--   * no NON-moving scheduled event holds a target           -> occupied:<date>
-- Policy — the week bound, past targets, non-scheduled occupants — lives in
-- services/training-event-layout-service.ts, the only caller. The message
-- prefixes above are a contract: the service maps them to typed errors.

CREATE OR REPLACE FUNCTION move_training_events_atomic(
  p_client_id UUID,
  p_moves JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_move     RECORD;
  v_event    RECORD;
  v_ids      UUID[];
  v_targets  DATE[];
  v_occupied DATE;
BEGIN
  IF p_moves IS NULL
     OR jsonb_typeof(p_moves) <> 'array'
     OR jsonb_array_length(p_moves) = 0 THEN
    RAISE EXCEPTION 'invalid_moves: p_moves must be a non-empty array';
  END IF;

  SELECT array_agg((m->>'to_date')::date), array_agg((m->>'event_id')::uuid)
    INTO v_targets, v_ids
    FROM jsonb_array_elements(p_moves) AS m;

  IF (SELECT count(*) FROM unnest(v_targets) AS t)
     <> (SELECT count(DISTINCT t) FROM unnest(v_targets) AS t) THEN
    RAISE EXCEPTION 'duplicate_target: two moves share a target date';
  END IF;

  IF (SELECT count(*) FROM unnest(v_ids) AS i)
     <> (SELECT count(DISTINCT i) FROM unnest(v_ids) AS i) THEN
    RAISE EXCEPTION 'duplicate_event: an event appears twice';
  END IF;

  -- Lock every moving row and verify it. A foreign row is reported as
  -- not_found, never as "someone else's".
  FOR v_move IN
    SELECT (m->>'event_id')::uuid AS event_id,
           (m->>'from_date')::date AS from_date,
           (m->>'to_date')::date   AS to_date
      FROM jsonb_array_elements(p_moves) AS m
  LOOP
    SELECT id, client_id, date, status
      INTO v_event
      FROM training_events
     WHERE id = v_move.event_id
     FOR UPDATE;

    IF NOT FOUND OR v_event.client_id <> p_client_id THEN
      RAISE EXCEPTION 'not_found: event % is not this client''s', v_move.event_id;
    END IF;
    IF v_event.status <> 'scheduled' THEN
      RAISE EXCEPTION 'not_scheduled: event % has left the scheduled state', v_move.event_id;
    END IF;
    IF v_event.date <> v_move.from_date THEN
      RAISE EXCEPTION 'drift: event % is on %, not %',
        v_move.event_id, v_event.date, v_move.from_date;
    END IF;
  END LOOP;

  -- A target held by a scheduled event that is NOT moving is a collision the
  -- index would also refuse; name the date first so the caller can render a
  -- sentence rather than a constraint name.
  SELECT e.date
    INTO v_occupied
    FROM training_events e
   WHERE e.client_id = p_client_id
     AND e.status = 'scheduled'
     AND e.date = ANY (v_targets)
     AND NOT (e.id = ANY (v_ids))
   ORDER BY e.date
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'occupied:%', v_occupied;
  END IF;

  -- Park: vacate every source day. Sentinels are distinct per row (ordinality)
  -- and far outside any real calendar, so the partial unique index cannot
  -- collide on them.
  UPDATE training_events e
     SET date = DATE '2999-01-01' + m.ord::int
    FROM (
      SELECT (x->>'event_id')::uuid AS event_id, ord
        FROM jsonb_array_elements(p_moves) WITH ORDINALITY AS t(x, ord)
    ) AS m
   WHERE e.id = m.event_id;

  -- Place. is_modified drives the calendar card's edited badge, as it does
  -- for a coach move; it is not a write predicate (the amendment re-lays
  -- moved future events behind its own warning).
  UPDATE training_events e
     SET date        = m.to_date,
         is_modified = true,
         updated_at  = now()
    FROM (
      SELECT (x->>'event_id')::uuid AS event_id, (x->>'to_date')::date AS to_date
        FROM jsonb_array_elements(p_moves) AS x
    ) AS m
   WHERE e.id = m.event_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION move_training_events_atomic(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION move_training_events_atomic(UUID, JSONB) TO service_role;

COMMENT ON FUNCTION move_training_events_atomic(UUID, JSONB) IS
  'Apply a week layout: move N still-scheduled training events in one transaction (park-then-place under the one-scheduled-per-day index). Called only by services/training-event-layout-service.ts.';
