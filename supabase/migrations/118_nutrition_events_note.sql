-- Per-day coach note on a nutrition event (e.g. "deload week — go easy").
-- Mirrors training_events.session_focus (mig 075): a nullable free-text column.
-- Set via the range-edit path (rides is_modified=true, so it survives regen like
-- the macro edits) and cleared on reset; surfaced to the client on the program
-- card + the per-date day-view. Additive, nullable, no RPC.
ALTER TABLE nutrition_events
  ADD COLUMN IF NOT EXISTS note TEXT;
