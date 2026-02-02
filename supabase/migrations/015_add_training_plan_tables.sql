-- Training Plans table (main plan metadata)
CREATE TABLE IF NOT EXISTS training_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  coach_id UUID NOT NULL REFERENCES coaches(id),
  name TEXT NOT NULL DEFAULT 'Training Plan',
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'draft')),
  coach_prompt TEXT NOT NULL,
  ai_response_raw TEXT,
  split_type TEXT NOT NULL,
  frequency_per_week INTEGER NOT NULL CHECK (frequency_per_week >= 1 AND frequency_per_week <= 7),
  program_duration_weeks INTEGER,
  -- Client metrics snapshot
  client_weight_kg NUMERIC(5, 2),
  client_body_fat_percentage NUMERIC(4, 1),
  client_goal_weight_kg NUMERIC(5, 2),
  client_tdee INTEGER,
  -- Check-in averages snapshot
  avg_mood NUMERIC(3, 1),
  avg_energy NUMERIC(3, 1),
  avg_sleep NUMERIC(3, 1),
  avg_stress NUMERIC(3, 1),
  recent_adherence_percentage NUMERIC(5, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Training Sessions table (individual workout days)
CREATE TABLE IF NOT EXISTS training_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  day_of_week TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  focus TEXT,
  notes TEXT,
  estimated_duration_minutes INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Training Exercises table
CREATE TABLE IF NOT EXISTS training_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  sets INTEGER NOT NULL CHECK (sets >= 1 AND sets <= 20),
  reps_min INTEGER,
  reps_max INTEGER,
  reps_target TEXT,
  rpe_target NUMERIC(3, 1) CHECK (rpe_target IS NULL OR (rpe_target >= 1 AND rpe_target <= 10)),
  percentage_1rm NUMERIC(5, 2) CHECK (percentage_1rm IS NULL OR (percentage_1rm >= 0 AND percentage_1rm <= 100)),
  tempo TEXT,
  rest_seconds INTEGER,
  notes TEXT,
  superset_group TEXT,
  is_warmup BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Training Plan History
CREATE TABLE IF NOT EXISTS training_plan_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES training_plans(id) ON DELETE SET NULL,
  coach_prompt TEXT NOT NULL,
  ai_response_raw TEXT,
  plan_snapshot JSONB NOT NULL,
  client_metrics_snapshot JSONB,
  check_in_data_snapshot JSONB,
  regeneration_reason TEXT,
  created_by_coach_id UUID REFERENCES coaches(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_training_plans_client ON training_plans(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_training_plans_status ON training_plans(client_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_training_sessions_plan ON training_sessions(plan_id, order_index);
CREATE INDEX IF NOT EXISTS idx_training_exercises_session ON training_exercises(session_id, order_index);
CREATE INDEX IF NOT EXISTS idx_training_plan_history_client ON training_plan_history(client_id, created_at DESC);

-- RLS Policies
ALTER TABLE training_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_plan_history ENABLE ROW LEVEL SECURITY;

-- Training Plans policies
CREATE POLICY "training_plans_select" ON training_plans
  FOR SELECT USING (client_id IN (SELECT id FROM clients WHERE coach_id = auth.uid()));

CREATE POLICY "training_plans_insert" ON training_plans
  FOR INSERT WITH CHECK (client_id IN (SELECT id FROM clients WHERE coach_id = auth.uid()));

CREATE POLICY "training_plans_update" ON training_plans
  FOR UPDATE USING (client_id IN (SELECT id FROM clients WHERE coach_id = auth.uid()));

CREATE POLICY "training_plans_delete" ON training_plans
  FOR DELETE USING (client_id IN (SELECT id FROM clients WHERE coach_id = auth.uid()));

-- Training Sessions policies
CREATE POLICY "training_sessions_select" ON training_sessions
  FOR SELECT USING (plan_id IN (SELECT id FROM training_plans WHERE client_id IN (SELECT id FROM clients WHERE coach_id = auth.uid())));

CREATE POLICY "training_sessions_insert" ON training_sessions
  FOR INSERT WITH CHECK (plan_id IN (SELECT id FROM training_plans WHERE client_id IN (SELECT id FROM clients WHERE coach_id = auth.uid())));

CREATE POLICY "training_sessions_update" ON training_sessions
  FOR UPDATE USING (plan_id IN (SELECT id FROM training_plans WHERE client_id IN (SELECT id FROM clients WHERE coach_id = auth.uid())));

CREATE POLICY "training_sessions_delete" ON training_sessions
  FOR DELETE USING (plan_id IN (SELECT id FROM training_plans WHERE client_id IN (SELECT id FROM clients WHERE coach_id = auth.uid())));

-- Training Exercises policies
CREATE POLICY "training_exercises_select" ON training_exercises
  FOR SELECT USING (session_id IN (SELECT id FROM training_sessions WHERE plan_id IN (SELECT id FROM training_plans WHERE client_id IN (SELECT id FROM clients WHERE coach_id = auth.uid()))));

CREATE POLICY "training_exercises_insert" ON training_exercises
  FOR INSERT WITH CHECK (session_id IN (SELECT id FROM training_sessions WHERE plan_id IN (SELECT id FROM training_plans WHERE client_id IN (SELECT id FROM clients WHERE coach_id = auth.uid()))));

CREATE POLICY "training_exercises_update" ON training_exercises
  FOR UPDATE USING (session_id IN (SELECT id FROM training_sessions WHERE plan_id IN (SELECT id FROM training_plans WHERE client_id IN (SELECT id FROM clients WHERE coach_id = auth.uid()))));

CREATE POLICY "training_exercises_delete" ON training_exercises
  FOR DELETE USING (session_id IN (SELECT id FROM training_sessions WHERE plan_id IN (SELECT id FROM training_plans WHERE client_id IN (SELECT id FROM clients WHERE coach_id = auth.uid()))));

-- Training Plan History policies
CREATE POLICY "training_plan_history_select" ON training_plan_history
  FOR SELECT USING (client_id IN (SELECT id FROM clients WHERE coach_id = auth.uid()));

CREATE POLICY "training_plan_history_insert" ON training_plan_history
  FOR INSERT WITH CHECK (client_id IN (SELECT id FROM clients WHERE coach_id = auth.uid()));

-- Trigger for updated_at on training_plans
CREATE OR REPLACE FUNCTION update_training_plan_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER training_plans_updated_at
  BEFORE UPDATE ON training_plans
  FOR EACH ROW
  EXECUTE FUNCTION update_training_plan_updated_at();

CREATE TRIGGER training_sessions_updated_at
  BEFORE UPDATE ON training_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_training_plan_updated_at();

CREATE TRIGGER training_exercises_updated_at
  BEFORE UPDATE ON training_exercises
  FOR EACH ROW
  EXECUTE FUNCTION update_training_plan_updated_at();
