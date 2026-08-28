-- Migration 156: one check-in per client per period
--
-- Nothing has ever stopped two check-ins covering the same week.
-- `idx_check_ins_period` (client_id, period_start, period_end) is a plain
-- index, not a constraint, so the only thing standing between a double-tap and
-- a duplicate was the screen that opens the form — and a duplicate is not
-- cosmetic: a submitted check-in advances `clients.next_check_in_due` by one
-- frequency step, so two of them advance it twice and the client silently SKIPS
-- a check-in. It has happened once already, at a midnight boundary; the note
-- above the snapshot write in app/api/client/check-ins/route.ts records it.
--
-- The write path now re-checks the gate (409), which catches the retry. This is
-- the backstop that does not depend on every future caller remembering.
--
-- PARTIAL, on period_end IS NOT NULL: 56 legacy rows predating migration 038
-- carry no period at all. Postgres treats NULLs as distinct in a unique index
-- anyway, so the predicate changes no behaviour — it states the intent, and
-- keeps the index off rows it can say nothing about.
--
-- period_end alone, not the (period_start, period_end) pair: the period ENDS on
-- the check-in day, and that is what identifies it. period_start moves on its
-- own — it is clamped forward to the activation date for a partial first week
-- (resolveCheckInWindow) — so including it would let two check-ins share a week
-- whenever their start dates differed.
--
-- Probed before writing, because "zero duplicates exist" is a per-database fact:
--   dev  (aeaphsslctwcmebldrzx): 2864 check-ins, 0 duplicate (client_id,
--        period_end) pairs, 56 with a NULL period.
--   prod (etezzztgafcotyahgijk): 0 check-ins.

CREATE UNIQUE INDEX IF NOT EXISTS idx_check_ins_client_period_unique
  ON public.check_ins (client_id, period_end)
  WHERE period_end IS NOT NULL;

COMMENT ON INDEX public.idx_check_ins_client_period_unique IS
  'One check-in per client per period. A duplicate would advance clients.next_check_in_due twice and silently skip a cycle. The write path checks the gate first and returns 409; this is the backstop.';
