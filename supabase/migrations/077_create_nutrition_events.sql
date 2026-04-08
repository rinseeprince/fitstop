-- Nutrition events: one row per client per date with concrete calorie/macro targets.
-- Past events are immutable. Future events regenerate on plan changes.

CREATE TABLE nutrition_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  nutrition_plan_id UUID NOT NULL REFERENCES nutrition_plans(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  day_of_week TEXT NOT NULL,
  baseline_calories INTEGER NOT NULL,
  training_burn_calories INTEGER NOT NULL DEFAULT 0,
  external_burn_calories INTEGER NOT NULL DEFAULT 0,
  protein_g NUMERIC NOT NULL,
  carb_g NUMERIC NOT NULL,
  fat_g NUMERIC NOT NULL,
  diet_type TEXT NOT NULL DEFAULT 'balanced',
  is_training_day BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'logged', 'missed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, date)
);

CREATE INDEX idx_nutrition_events_client_date ON nutrition_events(client_id, date);
CREATE INDEX idx_nutrition_events_plan ON nutrition_events(nutrition_plan_id);

-- RLS policies (follows pattern from nutrition_plans in migration 044)
ALTER TABLE nutrition_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coaches_view_client_nutrition_events" ON nutrition_events
  FOR SELECT USING (
    client_id IN (
      SELECT id FROM clients
      WHERE coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "clients_view_own_nutrition_events" ON nutrition_events
  FOR SELECT USING (
    client_id IN (
      SELECT id FROM clients WHERE user_id = auth.uid()
    )
  );

-- Writes go through supabaseAdmin (service role bypass), so no INSERT/UPDATE/DELETE policies needed.
