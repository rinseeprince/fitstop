-- Add phase-level goal override columns to phases table.
-- When NULL, the system falls back to the client's overall goal from client_goals.

ALTER TABLE phases
  ADD COLUMN phase_goal_weight NUMERIC,
  ADD COLUMN phase_goal_body_fat_percentage NUMERIC;

COMMENT ON COLUMN phases.phase_goal_weight IS 'Phase-specific goal weight in kg. NULL = use client overall goal.';
COMMENT ON COLUMN phases.phase_goal_body_fat_percentage IS 'Phase-specific goal body fat %. NULL = use client overall goal.';
