-- Coach's library of reusable training plans and sessions.
-- Plans are ordered session sequences (programs) with cycle-aware placement.
-- Sessions can belong to a plan or exist independently for mix-and-match use.
-- Exercises reference the master exercises catalog (EX-1).

CREATE TABLE coach_saved_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  split_type TEXT,
  frequency_per_week INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'saved')),
  cycle_length INTEGER,
  rest_pattern INTEGER[] DEFAULT '{}',
  default_surplus_percentage NUMERIC DEFAULT 15,
  source TEXT DEFAULT 'manual',
  coach_prompt TEXT,
  program_duration_weeks INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_coach_saved_plans_coach ON coach_saved_plans(coach_id);
CREATE INDEX idx_coach_saved_plans_coach_status ON coach_saved_plans(coach_id, status);

CREATE TABLE coach_saved_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  saved_plan_id UUID REFERENCES coach_saved_plans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  focus TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  is_rest BOOLEAN DEFAULT false,
  estimated_duration_minutes INTEGER,
  calorie_surplus_percentage NUMERIC,
  notes TEXT,
  session_type TEXT NOT NULL DEFAULT 'training',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_coach_saved_sessions_coach ON coach_saved_sessions(coach_id);
CREATE INDEX idx_coach_saved_sessions_plan ON coach_saved_sessions(saved_plan_id);

CREATE TABLE coach_saved_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saved_session_id UUID NOT NULL REFERENCES coach_saved_sessions(id) ON DELETE CASCADE,
  exercise_id UUID REFERENCES exercises(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  sets INTEGER NOT NULL DEFAULT 3,
  reps_min INTEGER,
  reps_max INTEGER,
  reps_target TEXT,
  rpe_target NUMERIC,
  percentage_1rm NUMERIC,
  tempo TEXT,
  rest_seconds INTEGER,
  superset_group TEXT,
  is_warmup BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_coach_saved_exercises_session ON coach_saved_exercises(saved_session_id);
CREATE INDEX idx_coach_saved_exercises_exercise ON coach_saved_exercises(exercise_id);

-- Triggers for updated_at (reuse existing function from migration 015)
CREATE TRIGGER coach_saved_plans_updated_at
  BEFORE UPDATE ON coach_saved_plans
  FOR EACH ROW
  EXECUTE FUNCTION update_training_plan_updated_at();

CREATE TRIGGER coach_saved_sessions_updated_at
  BEFORE UPDATE ON coach_saved_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_training_plan_updated_at();

CREATE TRIGGER coach_saved_exercises_updated_at
  BEFORE UPDATE ON coach_saved_exercises
  FOR EACH ROW
  EXECUTE FUNCTION update_training_plan_updated_at();

-- Add provenance FK to training_plans (tracks which library plan was placed)
ALTER TABLE training_plans ADD COLUMN saved_plan_id UUID REFERENCES coach_saved_plans(id) ON DELETE SET NULL;

-- Add calorie surplus percentage to existing training tables
ALTER TABLE training_sessions ADD COLUMN calorie_surplus_percentage NUMERIC;
ALTER TABLE nutrition_events ADD COLUMN calorie_surplus_percentage NUMERIC;
