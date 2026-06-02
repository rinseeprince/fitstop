-- =============================================================================
-- Migration 097: Event-keyed session_logs identity (Session 5.2)
--
-- Migrates session_logs from session-week identity
--   UNIQUE(client_id, training_session_id, week_start_date)
-- to event-keyed identity (training_event_id). Fixes the cycle-plan data-loss
-- bug where two events with the same training_session_id in one week collide on
-- the old composite key and silently overwrite each other's log.
--
-- Runs in one transaction (supabase migrate wraps each file). Order is fixed:
--   ADD COLUMN -> report collisions -> deterministic backfill -> reconcile
--   non-owners -> create partial unique index -> drop old constraint.
-- There is intentionally NO naive `UPDATE ... FROM training_events` backfill:
-- it would pick an arbitrary event for any log shared by >1 event. The
-- DISTINCT ON owner backfill below is the only backfill.
-- =============================================================================

-- 1. New event-keyed column. ON DELETE SET NULL mirrors the existing
--    training_events.session_log_id FK (027): deleting an event nulls the
--    back-reference without destroying logged history. Never CASCADE.
ALTER TABLE session_logs
  ADD COLUMN training_event_id UUID NULL
  REFERENCES training_events(id) ON DELETE SET NULL;

-- 2a. Report blast radius: how many session_logs rows are referenced by more
--     than one training_events row (the cycle-plan collisions this migration
--     fixes). Zero is plausible pre-launch; non-zero is handled below, not
--     asserted away.
DO $$
DECLARE
  shared_count int;
BEGIN
  SELECT count(*) INTO shared_count
  FROM (
    SELECT session_log_id
    FROM training_events
    WHERE session_log_id IS NOT NULL
    GROUP BY session_log_id
    HAVING count(*) > 1
  ) collisions;
  RAISE NOTICE 'Migration 097: session_logs shared by >1 event (cycle-plan collisions): %', shared_count;
END $$;

-- 2b. Deterministic owner backfill (the single backfill). For each session_log
--     referenced by one or more events, the earliest-dated event owns the link
--     (tie-break on created_at). DISTINCT ON guarantees exactly one event per
--     log, so the partial unique index below is satisfiable by construction.
UPDATE session_logs sl
SET training_event_id = owner.event_id
FROM (
  SELECT DISTINCT ON (te.session_log_id)
         te.session_log_id,
         te.id AS event_id
  FROM training_events te
  WHERE te.session_log_id IS NOT NULL
  ORDER BY te.session_log_id, te.date ASC, te.created_at ASC
) owner
WHERE sl.id = owner.session_log_id;

-- 2c. Reconcile non-owner events: an event whose log does not point back to it
--     (the losers of a cycle-plan collision) gets its stale back-reference
--     nulled and its now-dataless status reset. Honest about the data the old
--     bug overwrote (unrecoverable) — the event becomes re-loggable instead of
--     a phantom "completed" with no log.
UPDATE training_events te
SET session_log_id = NULL,
    status = CASE WHEN te.date < CURRENT_DATE THEN 'missed' ELSE 'scheduled' END,
    updated_at = now()
WHERE te.session_log_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM session_logs sl
    WHERE sl.id = te.session_log_id
      AND sl.training_event_id = te.id
  );

-- 3. New event-keyed unique key. Partial so legacy never-linked logs
--    (training_event_id IS NULL) coexist freely without uniqueness pressure.
CREATE UNIQUE INDEX session_logs_training_event_id_key
  ON session_logs(training_event_id)
  WHERE training_event_id IS NOT NULL;

-- 4. Drop the old session-week unique key. It is a UNIQUE table constraint
--    (created as UNIQUE(...) in 027, index renamed in 055), so DROP CONSTRAINT
--    (which drops its backing index too) — NOT DROP INDEX.
ALTER TABLE session_logs
  DROP CONSTRAINT session_logs_client_session_week_key;
