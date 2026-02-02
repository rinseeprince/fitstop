-- Add nutrition calculation fields to clients table
ALTER TABLE clients
  -- Unit preference (client-level setting)
  ADD COLUMN IF NOT EXISTS unit_preference TEXT DEFAULT 'imperial'
    CHECK (unit_preference IN ('metric', 'imperial')),

  -- Activity and training inputs
  ADD COLUMN IF NOT EXISTS work_activity_level TEXT DEFAULT 'sedentary'
    CHECK (work_activity_level IN ('sedentary', 'lightly_active', 'moderately_active', 'very_active', 'extremely_active')),
  ADD COLUMN IF NOT EXISTS training_volume_hours TEXT DEFAULT '0-1'
    CHECK (training_volume_hours IN ('0-1', '2-3', '4-5', '6-7', '8+')),

  -- Protein and diet preferences
  ADD COLUMN IF NOT EXISTS protein_target_g_per_kg NUMERIC(3, 1) DEFAULT 2.0
    CHECK (protein_target_g_per_kg >= 1.0 AND protein_target_g_per_kg <= 3.0),
  ADD COLUMN IF NOT EXISTS diet_type TEXT DEFAULT 'balanced'
    CHECK (diet_type IN ('balanced', 'high_carb', 'low_carb', 'keto', 'custom')),

  -- Goal timeline
  ADD COLUMN IF NOT EXISTS goal_deadline DATE,

  -- Plan metadata (tracks when plan was created/regenerated)
  ADD COLUMN IF NOT EXISTS nutrition_plan_created_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS nutrition_plan_base_weight_kg NUMERIC(5, 2),

  -- Locked nutrition targets (set by calculation, don't auto-update)
  ADD COLUMN IF NOT EXISTS calorie_target INTEGER,
  ADD COLUMN IF NOT EXISTS protein_target_g NUMERIC(5, 1),
  ADD COLUMN IF NOT EXISTS carb_target_g NUMERIC(5, 1),
  ADD COLUMN IF NOT EXISTS fat_target_g NUMERIC(5, 1),

  -- Custom macro overrides (for manual adjustments)
  ADD COLUMN IF NOT EXISTS custom_macros_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS custom_protein_g NUMERIC(5, 1),
  ADD COLUMN IF NOT EXISTS custom_carb_g NUMERIC(5, 1),
  ADD COLUMN IF NOT EXISTS custom_fat_g NUMERIC(5, 1);

-- Add comments for clarity
COMMENT ON COLUMN clients.unit_preference IS 'Client unit preference: metric (kg, cm) or imperial (lbs, inches)';
COMMENT ON COLUMN clients.work_activity_level IS 'Work activity level for TDEE calculation (sedentary=1.2x to extremely_active=1.9x)';
COMMENT ON COLUMN clients.training_volume_hours IS 'Weekly training hours for TDEE adjustment (0-1, 2-3, 4-5, 6-7, 8+)';
COMMENT ON COLUMN clients.protein_target_g_per_kg IS 'Protein target in g/kg body weight (1.6-2.5 typical range)';
COMMENT ON COLUMN clients.diet_type IS 'Macro distribution type: balanced (50/50), high_carb (65/35), low_carb (25/75), keto (10/90)';
COMMENT ON COLUMN clients.goal_deadline IS 'Target date to reach goal weight';
COMMENT ON COLUMN clients.nutrition_plan_created_date IS 'Timestamp when nutrition plan was last created/regenerated';
COMMENT ON COLUMN clients.nutrition_plan_base_weight_kg IS 'Client weight (in kg) when plan was created - used to detect significant changes';
COMMENT ON COLUMN clients.calorie_target IS 'Daily calorie target from calculation (locked until regenerated)';
COMMENT ON COLUMN clients.protein_target_g IS 'Daily protein target in grams (locked until regenerated)';
COMMENT ON COLUMN clients.carb_target_g IS 'Daily carbohydrate target in grams (locked until regenerated)';
COMMENT ON COLUMN clients.fat_target_g IS 'Daily fat target in grams (locked until regenerated)';
COMMENT ON COLUMN clients.custom_macros_enabled IS 'Whether PT has manually overridden calculated macros';

-- Create nutrition plan history table
CREATE TABLE IF NOT EXISTS nutrition_plan_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Snapshot of client metrics at time of plan creation
  base_weight_kg NUMERIC(5, 2) NOT NULL,
  goal_weight_kg NUMERIC(5, 2),
  bmr INTEGER,
  tdee INTEGER,

  -- Settings used for this plan
  work_activity_level TEXT NOT NULL,
  training_volume_hours TEXT NOT NULL,
  protein_target_g_per_kg NUMERIC(3, 1) NOT NULL,
  diet_type TEXT NOT NULL,
  goal_deadline DATE,

  -- Calculated targets
  calorie_target INTEGER NOT NULL,
  protein_target_g NUMERIC(5, 1) NOT NULL,
  carb_target_g NUMERIC(5, 1) NOT NULL,
  fat_target_g NUMERIC(5, 1) NOT NULL,

  -- Metadata
  created_by_coach_id UUID REFERENCES coaches(id),
  regeneration_reason TEXT
);

-- Add index for efficient history queries
CREATE INDEX IF NOT EXISTS idx_nutrition_plan_history_client_id
  ON nutrition_plan_history(client_id, created_at DESC);

-- Add RLS policies for nutrition plan history
ALTER TABLE nutrition_plan_history ENABLE ROW LEVEL SECURITY;

-- Coaches can view their clients' nutrition history
CREATE POLICY "Coaches can view their clients' nutrition history"
  ON nutrition_plan_history
  FOR SELECT
  USING (
    client_id IN (
      SELECT id FROM clients WHERE coach_id = auth.uid()
    )
  );

-- Coaches can insert nutrition history for their clients
CREATE POLICY "Coaches can insert nutrition history for their clients"
  ON nutrition_plan_history
  FOR INSERT
  WITH CHECK (
    client_id IN (
      SELECT id FROM clients WHERE coach_id = auth.uid()
    )
  );

COMMENT ON TABLE nutrition_plan_history IS 'Historical record of nutrition plan calculations - tracks how plans evolve over time';
COMMENT ON COLUMN nutrition_plan_history.base_weight_kg IS 'Client weight when this plan was generated';
COMMENT ON COLUMN nutrition_plan_history.regeneration_reason IS 'Why plan was regenerated (e.g., "weight_change", "settings_update", "manual")';
