-- =============================================================================
-- Migration 119: Per-set prescription model foundation (Training Builder S1)
--
-- Additive, non-destructive. Lays the columns for a per-set prescription model
-- and set-type-aware analytics; nothing authors set_specs yet (the Phase 2
-- builder does), so these stay dormant until then.
--
--   * coach_saved_exercises / training_exercises gain:
--       - set_specs JSONB  -- authoritative per-set list once present; when NULL
--                             the compact columns (sets / reps_min / reps_max)
--                             remain the source of truth (expand-on-read).
--       - video_url  TEXT  -- optional coach demo link (surfaced to the client
--                             in a later phase).
--   * set_logs.set_type    -- per-set type. NOT NULL DEFAULT 'working' so every
--                             existing insert (seeds, client logs) stays valid
--                             without a code change; real non-'working' values
--                             only appear once the client log form seeds from a
--                             prescription's set_specs (Phase 2/5). The analytics
--                             RPCs (migration 120) read this column.
--
-- The set_type CHECK values match the SetSpec.set_type union (utils/
-- exercise-set-specs.ts) and exec-doc D1. No RPC, no backfill.
-- =============================================================================

ALTER TABLE coach_saved_exercises
  ADD COLUMN IF NOT EXISTS set_specs JSONB,
  ADD COLUMN IF NOT EXISTS video_url TEXT;

ALTER TABLE training_exercises
  ADD COLUMN IF NOT EXISTS set_specs JSONB,
  ADD COLUMN IF NOT EXISTS video_url TEXT;

ALTER TABLE set_logs
  ADD COLUMN IF NOT EXISTS set_type TEXT NOT NULL DEFAULT 'working'
    CHECK (set_type IN ('warmup','working','amrap','drop','failure'));
