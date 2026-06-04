-- =============================================================================
-- Migration 104: client_goals.goal_start_date (Session 7.8)
--
-- Anchors the long-term goal's pace window. Until now the client-scope goal had a
-- deadline but no explicit start, so pace was anchored implicitly on "today" (or,
-- buggily, on the active nutrition plan's date — a cross-scope mismatch). With an
-- explicit start the effective-goal resolver (lib/goals/resolve-effective-goal.ts)
-- can compute pace from a single client scope: start_date → deadline.
--
-- Nullable + no default: existing goals keep NULL and the resolver falls back to
-- "today" (display-only; no backfill needed). Phase-scoped goals use the phase's
-- own start_date and ignore this column.
-- =============================================================================

ALTER TABLE client_goals
  ADD COLUMN goal_start_date DATE NULL;

COMMENT ON COLUMN client_goals.goal_start_date IS
  'Optional anchor for the long-term goal pace window (start → goal_deadline). NULL falls back to today in the resolver. Phase-scoped goals use the phase start_date instead.';
