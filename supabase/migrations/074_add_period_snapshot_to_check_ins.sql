-- Add period_snapshot JSONB column to check_ins for frozen day-by-day schedule data
ALTER TABLE check_ins ADD COLUMN period_snapshot JSONB;
COMMENT ON COLUMN check_ins.period_snapshot IS 'Frozen training+nutrition schedule snapshot. Written at submission, never updated.';
