-- =============================================================================
-- Migration 056: Split daily_logs into spine + child tables
-- Creates wellness_logs, nutrition_logs, training_logs as 1:1 children.
-- Migrates data, drops moved columns, adds phase_id, creates transition view.
-- =============================================================================

-- =============================================================================
-- STEP 0: Ensure training_data column exists on daily_logs.
-- On dev, this column was added via Studio after the original CREATE; no
-- migration file ever captured the ALTER. This catch-up keeps the chain
-- replayable on a fresh DB (where 030 doesn't create the column).
-- =============================================================================

ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS training_data JSONB;

-- =============================================================================
-- STEP 1: Formalize UNIQUE constraint + add phase_id to spine
-- =============================================================================

DO $$
BEGIN
  BEGIN
    ALTER TABLE daily_logs ADD CONSTRAINT daily_logs_client_id_date_key UNIQUE (client_id, date);
  EXCEPTION WHEN duplicate_table OR unique_violation THEN
    -- Constraint already exists (created via dashboard)
    NULL;
  END;
END $$;

ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS phase_id UUID;

-- =============================================================================
-- STEP 2: Create child tables
-- =============================================================================

CREATE TABLE IF NOT EXISTS wellness_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_log_id UUID NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  phase_id UUID,
  mood INTEGER,
  energy INTEGER,
  sleep INTEGER,
  stress INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(daily_log_id)
);

CREATE INDEX idx_wellness_logs_client_date ON wellness_logs(client_id, date DESC);

CREATE TABLE IF NOT EXISTS nutrition_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_log_id UUID NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  phase_id UUID,
  calories_consumed INTEGER,
  protein_g INTEGER,
  carbs_g INTEGER,
  fat_g INTEGER,
  target_calories INTEGER,
  target_protein_g INTEGER,
  target_carbs_g INTEGER,
  target_fat_g INTEGER,
  nutrition_adherence TEXT,
  calorie_surplus_deficit INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(daily_log_id)
);

CREATE INDEX idx_nutrition_logs_client_date ON nutrition_logs(client_id, date DESC);

CREATE TABLE IF NOT EXISTS training_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_log_id UUID NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  phase_id UUID,
  trained BOOLEAN DEFAULT FALSE,
  training_session_id UUID,
  training_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(daily_log_id)
);

CREATE INDEX idx_training_logs_client_date ON training_logs(client_id, date DESC);
CREATE INDEX idx_training_logs_trained ON training_logs(client_id, trained) WHERE trained = true;

-- =============================================================================
-- STEP 3: Migrate existing data from daily_logs into child tables
-- =============================================================================

INSERT INTO wellness_logs (daily_log_id, client_id, date, mood, energy, sleep, stress, created_at, updated_at)
SELECT id, client_id, date, mood, energy, sleep, stress, created_at, updated_at
FROM daily_logs
WHERE mood IS NOT NULL OR energy IS NOT NULL OR sleep IS NOT NULL OR stress IS NOT NULL;

INSERT INTO nutrition_logs (daily_log_id, client_id, date,
  calories_consumed, protein_g, carbs_g, fat_g,
  target_calories, target_protein_g, target_carbs_g, target_fat_g,
  nutrition_adherence, calorie_surplus_deficit, created_at, updated_at)
SELECT id, client_id, date,
  calories_consumed, protein_g, carbs_g, fat_g,
  target_calories, target_protein_g, target_carbs_g, target_fat_g,
  nutrition_adherence, calorie_surplus_deficit, created_at, updated_at
FROM daily_logs
WHERE calories_consumed IS NOT NULL OR target_calories IS NOT NULL;

INSERT INTO training_logs (daily_log_id, client_id, date,
  trained, training_session_id, training_data, created_at, updated_at)
SELECT id, client_id, date,
  trained, training_session_id, training_data, created_at, updated_at
FROM daily_logs
WHERE trained = true OR training_data IS NOT NULL;

-- =============================================================================
-- STEP 4: Add phase_id to daily_habit_logs
-- =============================================================================

ALTER TABLE daily_habit_logs ADD COLUMN IF NOT EXISTS phase_id UUID;

-- =============================================================================
-- STEP 5: Drop moved/dead columns from daily_logs
-- =============================================================================

ALTER TABLE daily_logs
  DROP COLUMN IF EXISTS mood,
  DROP COLUMN IF EXISTS energy,
  DROP COLUMN IF EXISTS sleep,
  DROP COLUMN IF EXISTS stress,
  DROP COLUMN IF EXISTS trained,
  DROP COLUMN IF EXISTS training_session_id,
  DROP COLUMN IF EXISTS training_data,
  DROP COLUMN IF EXISTS calories_consumed,
  DROP COLUMN IF EXISTS protein_g,
  DROP COLUMN IF EXISTS carbs_g,
  DROP COLUMN IF EXISTS fat_g,
  DROP COLUMN IF EXISTS target_calories,
  DROP COLUMN IF EXISTS target_protein_g,
  DROP COLUMN IF EXISTS target_carbs_g,
  DROP COLUMN IF EXISTS target_fat_g,
  DROP COLUMN IF EXISTS nutrition_adherence,
  DROP COLUMN IF EXISTS calorie_surplus_deficit,
  DROP COLUMN IF EXISTS completed_activity_ids;

-- =============================================================================
-- STEP 6: Enable RLS + policies on all 3 child tables
-- Pattern from migration 051 (daily_logs RLS)
-- =============================================================================

ALTER TABLE wellness_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutrition_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_logs ENABLE ROW LEVEL SECURITY;

-- wellness_logs
CREATE POLICY "coaches_select_client_wellness_logs"
  ON wellness_logs FOR SELECT
  USING (client_id IN (
    SELECT c.id FROM clients c JOIN coaches co ON co.id = c.coach_id WHERE co.user_id = auth.uid()
  ));

CREATE POLICY "clients_select_own_wellness_logs"
  ON wellness_logs FOR SELECT
  USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "clients_insert_own_wellness_logs"
  ON wellness_logs FOR INSERT
  WITH CHECK (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "clients_update_own_wellness_logs"
  ON wellness_logs FOR UPDATE
  USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

-- nutrition_logs
CREATE POLICY "coaches_select_client_nutrition_logs"
  ON nutrition_logs FOR SELECT
  USING (client_id IN (
    SELECT c.id FROM clients c JOIN coaches co ON co.id = c.coach_id WHERE co.user_id = auth.uid()
  ));

CREATE POLICY "clients_select_own_nutrition_logs"
  ON nutrition_logs FOR SELECT
  USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "clients_insert_own_nutrition_logs"
  ON nutrition_logs FOR INSERT
  WITH CHECK (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "clients_update_own_nutrition_logs"
  ON nutrition_logs FOR UPDATE
  USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

-- training_logs
CREATE POLICY "coaches_select_client_training_logs"
  ON training_logs FOR SELECT
  USING (client_id IN (
    SELECT c.id FROM clients c JOIN coaches co ON co.id = c.coach_id WHERE co.user_id = auth.uid()
  ));

CREATE POLICY "clients_select_own_training_logs"
  ON training_logs FOR SELECT
  USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "clients_insert_own_training_logs"
  ON training_logs FOR INSERT
  WITH CHECK (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "clients_update_own_training_logs"
  ON training_logs FOR UPDATE
  USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

-- =============================================================================
-- STEP 7: updated_at triggers on all 3 child tables
-- Reuses update_updated_at_column() from migration 004
-- =============================================================================

CREATE TRIGGER wellness_logs_updated_at
  BEFORE UPDATE ON wellness_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER nutrition_logs_updated_at
  BEFORE UPDATE ON nutrition_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER training_logs_updated_at
  BEFORE UPDATE ON training_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- STEP 8: Create transition VIEW for cross-domain consumers
-- Used by: daily-logs-service reads, attention-feed-service, coach daily-logs endpoint
-- Domain-specific endpoints query child tables directly
-- =============================================================================

CREATE OR REPLACE VIEW daily_logs_full AS
SELECT
  dl.id, dl.client_id, dl.date, dl.notes, dl.phase_id,
  dl.created_at, dl.updated_at,
  wl.mood, wl.energy, wl.sleep, wl.stress,
  nl.calories_consumed, nl.protein_g, nl.carbs_g, nl.fat_g,
  nl.target_calories, nl.target_protein_g, nl.target_carbs_g, nl.target_fat_g,
  nl.nutrition_adherence, nl.calorie_surplus_deficit,
  tl.trained, tl.training_session_id, tl.training_data
FROM daily_logs dl
LEFT JOIN wellness_logs wl ON wl.daily_log_id = dl.id
LEFT JOIN nutrition_logs nl ON nl.daily_log_id = dl.id
LEFT JOIN training_logs tl ON tl.daily_log_id = dl.id;
