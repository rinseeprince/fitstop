-- Migration 155: drop clients.expected_check_in_day
--
-- Migration 154 stored the due date and backfilled it from the live derivation;
-- this commit swapped every reader onto it. Nothing in the repo reads this
-- column any more — not the schedule (System A), not the check-in period
-- (System B), not the reporting week anchor (System C).
--
-- It is DROPPED rather than kept. A surviving column with no reader gets read
-- again in six months, and the two-jobs problem — one field answering "when is
-- it due", "which week does a check-in report on" and "where does this client's
-- week start" — comes back with it.
--
-- Probed against BOTH databases before writing this, because a row count is a
-- per-database fact and a DROP cannot be undone by a follow-up migration:
--
--   dev  (aeaphsslctwcmebldrzx): 221 clients, 212 backfilled, 0 weekday
--        mismatches between next_check_in_due and this column.
--   prod (etezzztgafcotyahgijk): 0 clients, 0 check_ins.
--
--   Both: 0 indexes on the column, 0 views using it, and exactly ONE
--   non-automatic dependency — the CHECK constraint added with the column in
--   migration 008, which DROP COLUMN removes along with it. No explicit
--   constraint drop is needed, and none is written here so the two stay
--   together.

ALTER TABLE public.clients
  DROP COLUMN IF EXISTS expected_check_in_day;
