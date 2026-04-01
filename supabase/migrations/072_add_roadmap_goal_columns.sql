-- Snapshot client goals at roadmap creation time for historical reference.
-- These columns are set once on creation and only changed by explicit coach edits.
-- They do NOT affect phase goal logic (phase_goal_weight on phases table controls plan calculations).

ALTER TABLE roadmaps ADD COLUMN goal_weight NUMERIC;
ALTER TABLE roadmaps ADD COLUMN goal_body_fat_percentage NUMERIC;
