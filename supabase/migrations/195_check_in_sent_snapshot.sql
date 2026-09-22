-- A sent check-in is frozen (docs/MEASUREMENT-LOG-PLAN.md §6 commit 8d1, owner
-- ruling 2026-09-22): the check-in as it stood when the client sent it —
-- what they reported, the goal it was judged against and where they stood,
-- the week's food against its targets, their habits, the days they logged and
-- each question's wording — saved once, in the statement that saves the
-- check-in, and never changed. A coach correcting a reading afterwards changes
-- the client's log, never a sent check-in.
--
-- One frozen block with a version number inside (CONVENTIONS §8: a submit-time
-- snapshot with no identity of its own). Its shape is declared and validated in
-- lib/check-in/sent-snapshot.ts, when written and when read.
--
-- Write-once, enforced here: once set, the block never changes and never goes
-- back to empty. An empty block may be filled once — how check-ins sent before
-- this migration, and check-ins a seed script inserts directly, get theirs
-- (scripts/fill-check-in-sent-snapshots.ts). Nothing else about a check-in is
-- guarded: its status, the coach's reply and the AI review still change.

ALTER TABLE public.check_ins ADD COLUMN IF NOT EXISTS sent_snapshot JSONB;

COMMENT ON COLUMN public.check_ins.sent_snapshot IS
  'The check-in as it stood when sent: the readings the client reported, the goal it was judged against and where they stood, the week''s food against its targets, their habits, the days they logged and each question''s wording. Written in the check-in''s INSERT (services/check-in-service.ts submitCheckIn); an empty one is filled once by scripts/fill-check-in-sent-snapshots.ts. Never changed once set (trigger check_ins_sent_snapshot_write_once). Shape: lib/check-in/sent-snapshot.ts. Migration 195.';

CREATE OR REPLACE FUNCTION public.check_ins_sent_snapshot_is_write_once()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.sent_snapshot IS NOT NULL
     AND NEW.sent_snapshot IS DISTINCT FROM OLD.sent_snapshot THEN
    RAISE EXCEPTION 'sent_snapshot_frozen: a sent check-in never changes';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.check_ins_sent_snapshot_is_write_once() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_ins_sent_snapshot_write_once ON public.check_ins;
CREATE TRIGGER check_ins_sent_snapshot_write_once
  BEFORE UPDATE ON public.check_ins
  FOR EACH ROW
  EXECUTE FUNCTION public.check_ins_sent_snapshot_is_write_once();
