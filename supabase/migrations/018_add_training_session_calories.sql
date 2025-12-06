-- Add estimated calories field to training sessions
-- This stores AI-estimated calorie burn for weight training sessions
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS estimated_calories INTEGER;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS calories_calculated_at TIMESTAMPTZ;

-- Index for efficient summing of calories per plan
CREATE INDEX IF NOT EXISTS idx_training_sessions_calories
ON training_sessions(plan_id, estimated_calories)
WHERE estimated_calories IS NOT NULL;
