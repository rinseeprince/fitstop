-- =============================================================================
-- Migration 121: Week model + self-describing rest (Training Builder S2)
--
-- Additive, non-destructive, idempotent (ADD COLUMN IF NOT EXISTS). Enables
-- multi-week programs and lets a placed plan describe its own rest days so the
-- client read no longer has to join back to the library template.
--
--   coach_saved_sessions / training_sessions gain:
--     week_index INTEGER NOT NULL DEFAULT 0
--       Internal slot ordering only. A program is 1+ ordered "weeks"; the WHOLE
--       program (all slots ordered by (week_index, order_index)) is the repeat
--       unit, and the repeat count is chosen at apply time. week_index carries NO
--       calendar-week / Mon-Sun meaning -- placement stays a sequential walk from
--       the apply date (day_of_week remains null). There is deliberately NO
--       week_mode: one model, no repeat-vs-sequential branch.
--
--   training_sessions ALSO gains:
--     is_rest BOOLEAN NOT NULL DEFAULT false
--       Placement now clones REST slots as real rows (mirroring
--       coach_saved_sessions.is_rest, which exists since migration 084) so
--       getClientTrainingPlan can render rest inline without the saved_plan_id ->
--       template join. Rest rows carry no exercises and never spawn a
--       training_event (the event generator emits for non-rest slots only). Every
--       applied-side reader that counts a row as a workout filters is_rest = false.
--
-- DEFAULT 0 / false backfills every existing row to today's flat single-week,
-- no-explicit-rest behavior, so legacy placements keep working unchanged. No RPC
-- change (placement is service-side, not the create_training_plan_atomic RPC) and
-- no backfill script.
-- =============================================================================

ALTER TABLE coach_saved_sessions
  ADD COLUMN IF NOT EXISTS week_index INTEGER NOT NULL DEFAULT 0;

ALTER TABLE training_sessions
  ADD COLUMN IF NOT EXISTS week_index INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_rest    BOOLEAN NOT NULL DEFAULT false;
