-- =============================================================================
-- Migration 063: Add phase_id FK to training_plans, nutrition_plans, daily_habits
-- Links plans to phases so phase → plan relationships are queryable.
-- =============================================================================

ALTER TABLE training_plans ADD COLUMN IF NOT EXISTS phase_id UUID REFERENCES phases(id) ON DELETE SET NULL;
ALTER TABLE nutrition_plans ADD COLUMN IF NOT EXISTS phase_id UUID REFERENCES phases(id) ON DELETE SET NULL;
ALTER TABLE daily_habits ADD COLUMN IF NOT EXISTS phase_id UUID REFERENCES phases(id) ON DELETE SET NULL;

CREATE INDEX idx_training_plans_phase ON training_plans(phase_id) WHERE phase_id IS NOT NULL;
CREATE INDEX idx_nutrition_plans_phase ON nutrition_plans(phase_id) WHERE phase_id IS NOT NULL;
CREATE INDEX idx_daily_habits_phase ON daily_habits(phase_id) WHERE phase_id IS NOT NULL;
