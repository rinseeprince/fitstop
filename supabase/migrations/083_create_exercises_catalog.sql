-- Master exercise catalog with two-tier ownership:
-- coach_id = NULL → global (platform-seeded, read-only for coaches)
-- coach_id = UUID → coach-specific (AI-generated or manually created)

CREATE TABLE exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID REFERENCES coaches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  muscle_group TEXT,
  equipment TEXT,
  category TEXT,
  aliases TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique per coach (or globally when coach_id is NULL)
CREATE UNIQUE INDEX idx_exercises_coach_name
  ON exercises(COALESCE(coach_id, '00000000-0000-0000-0000-000000000000'), LOWER(name));

CREATE INDEX idx_exercises_coach ON exercises(coach_id);
CREATE INDEX idx_exercises_name ON exercises(LOWER(name));

-- Add exercise_id FK to training_exercises (nullable for backward compat)
ALTER TABLE training_exercises ADD COLUMN exercise_id UUID REFERENCES exercises(id) ON DELETE SET NULL;
CREATE INDEX idx_training_exercises_exercise ON training_exercises(exercise_id);
