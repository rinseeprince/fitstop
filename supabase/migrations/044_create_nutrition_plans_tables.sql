-- Migration: Create nutrition_plans and nutrition_plan_daily_targets tables
-- Phase 1 of nutrition plans architecture redesign

-- =============================================================================
-- 1. Create nutrition_plans table
-- =============================================================================

CREATE TABLE nutrition_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  coach_id UUID NOT NULL REFERENCES coaches(id),

  -- Identity & lifecycle
  name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  effective_from DATE NOT NULL,
  effective_until DATE,

  -- Calculation inputs (frozen at creation)
  work_activity_level TEXT NOT NULL,
  training_volume_hours TEXT NOT NULL,
  protein_target_g_per_kg NUMERIC NOT NULL DEFAULT 2.0,
  diet_type TEXT NOT NULL DEFAULT 'balanced',
  goal_weight_kg NUMERIC,
  goal_deadline DATE,

  -- Calculated baseline (rest day, before training additions)
  baseline_calories INTEGER NOT NULL,
  protein_target_g NUMERIC NOT NULL,
  carb_target_g NUMERIC NOT NULL,
  fat_target_g NUMERIC NOT NULL,

  -- Snapshot of client metrics at plan creation
  base_weight_kg NUMERIC NOT NULL,
  bmr NUMERIC,
  tdee NUMERIC,

  -- Custom macro overrides
  custom_macros_enabled BOOLEAN NOT NULL DEFAULT false,
  custom_calories INTEGER,
  custom_protein_g NUMERIC,
  custom_carb_g NUMERIC,
  custom_fat_g NUMERIC,

  -- Metadata
  regeneration_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one active plan per client
CREATE UNIQUE INDEX idx_nutrition_plans_active_unique
  ON nutrition_plans(client_id) WHERE status = 'active';

CREATE INDEX idx_nutrition_plans_client_date
  ON nutrition_plans(client_id, effective_from DESC);

-- =============================================================================
-- 2. Create nutrition_plan_daily_targets table
-- =============================================================================

CREATE TABLE nutrition_plan_daily_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nutrition_plan_id UUID NOT NULL REFERENCES nutrition_plans(id) ON DELETE CASCADE,
  day_of_week TEXT NOT NULL,

  -- Coach-prescribed baseline targets for this day
  calories INTEGER NOT NULL,
  protein_g NUMERIC NOT NULL,
  carb_g NUMERIC NOT NULL,
  fat_g NUMERIC NOT NULL,

  -- Training context (snapshot at plan creation, used for UI labeling)
  is_training_day BOOLEAN NOT NULL DEFAULT false,

  UNIQUE(nutrition_plan_id, day_of_week)
);

-- =============================================================================
-- 3. Row-Level Security
-- =============================================================================

-- nutrition_plans
ALTER TABLE nutrition_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coaches_view_client_nutrition_plans" ON nutrition_plans
  FOR SELECT USING (
    client_id IN (
      SELECT id FROM clients
      WHERE coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "clients_view_own_nutrition_plans" ON nutrition_plans
  FOR SELECT USING (
    client_id IN (
      SELECT id FROM clients WHERE user_id = auth.uid()
    )
  );

-- nutrition_plan_daily_targets
ALTER TABLE nutrition_plan_daily_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coaches_view_client_daily_targets" ON nutrition_plan_daily_targets
  FOR SELECT USING (
    nutrition_plan_id IN (
      SELECT id FROM nutrition_plans
      WHERE client_id IN (
        SELECT id FROM clients
        WHERE coach_id IN (SELECT id FROM coaches WHERE user_id = auth.uid())
      )
    )
  );

CREATE POLICY "clients_view_own_daily_targets" ON nutrition_plan_daily_targets
  FOR SELECT USING (
    nutrition_plan_id IN (
      SELECT id FROM nutrition_plans
      WHERE client_id IN (
        SELECT id FROM clients WHERE user_id = auth.uid()
      )
    )
  );

-- Writes go through supabaseAdmin (service role bypass), so no INSERT/UPDATE/DELETE policies needed.

-- =============================================================================
-- 4. Data migration: Migrate nutrition_plan_history -> nutrition_plans (archived)
-- =============================================================================

INSERT INTO nutrition_plans (
  client_id,
  coach_id,
  name,
  status,
  effective_from,
  effective_until,
  work_activity_level,
  training_volume_hours,
  protein_target_g_per_kg,
  diet_type,
  goal_weight_kg,
  goal_deadline,
  baseline_calories,
  protein_target_g,
  carb_target_g,
  fat_target_g,
  base_weight_kg,
  bmr,
  tdee,
  custom_macros_enabled,
  regeneration_reason,
  created_at
)
SELECT
  nph.client_id,
  COALESCE(nph.created_by_coach_id, c.coach_id),
  NULL,  -- no name for historical plans
  'archived',
  nph.created_at::date,
  -- effective_until = day before the next plan for this client, or created_at date if last one
  COALESCE(
    (SELECT (next_plan.created_at::date - INTERVAL '1 day')::date
     FROM nutrition_plan_history next_plan
     WHERE next_plan.client_id = nph.client_id
       AND next_plan.created_at > nph.created_at
     ORDER BY next_plan.created_at ASC
     LIMIT 1),
    nph.created_at::date
  ),
  nph.work_activity_level,
  nph.training_volume_hours,
  nph.protein_target_g_per_kg,
  nph.diet_type,
  nph.goal_weight_kg,
  nph.goal_deadline,
  nph.calorie_target,
  nph.protein_target_g,
  nph.carb_target_g,
  nph.fat_target_g,
  nph.base_weight_kg,
  nph.bmr,
  nph.tdee,
  CASE WHEN nph.regeneration_reason = 'custom_macros' THEN true ELSE false END,
  nph.regeneration_reason,
  nph.created_at
FROM nutrition_plan_history nph
JOIN clients c ON c.id = nph.client_id;

-- =============================================================================
-- 5. Data migration: Backfill active plans from clients with baseline_calories
-- =============================================================================

-- Create active nutrition_plans for clients that have a nutrition plan configured
-- but DON'T already have an active plan from the history migration above
INSERT INTO nutrition_plans (
  client_id,
  coach_id,
  status,
  effective_from,
  effective_until,
  work_activity_level,
  training_volume_hours,
  protein_target_g_per_kg,
  diet_type,
  goal_weight_kg,
  goal_deadline,
  baseline_calories,
  protein_target_g,
  carb_target_g,
  fat_target_g,
  base_weight_kg,
  bmr,
  tdee,
  custom_macros_enabled,
  custom_calories,
  custom_protein_g,
  custom_carb_g,
  custom_fat_g,
  regeneration_reason,
  created_at
)
SELECT
  c.id,
  c.coach_id,
  'active',
  COALESCE(c.nutrition_plan_created_date::date, CURRENT_DATE),
  NULL,  -- active plan has no end date
  COALESCE(c.work_activity_level, 'moderately_active'),
  COALESCE(c.training_volume_hours, '2-3'),
  COALESCE(c.protein_target_g_per_kg, 2.0),
  COALESCE(c.diet_type, 'balanced'),
  CASE WHEN c.goal_weight IS NOT NULL AND c.weight_unit = 'lbs'
       THEN ROUND((c.goal_weight / 2.205)::numeric, 2)
       ELSE c.goal_weight END,
  c.goal_deadline,
  c.baseline_calories,
  COALESCE(c.protein_target_g, 0),
  COALESCE(c.carb_target_g, 0),
  COALESCE(c.fat_target_g, 0),
  COALESCE(c.nutrition_plan_base_weight_kg,
    CASE WHEN c.current_weight IS NOT NULL AND c.weight_unit = 'lbs'
         THEN ROUND((c.current_weight / 2.205)::numeric, 2)
         ELSE COALESCE(c.current_weight, 0) END),
  c.bmr,
  c.tdee,
  COALESCE(c.custom_macros_enabled, false),
  c.custom_calories,
  c.custom_protein_g,
  c.custom_carb_g,
  c.custom_fat_g,
  'initial',
  COALESCE(c.nutrition_plan_created_date::timestamptz, now())
FROM clients c
WHERE c.baseline_calories IS NOT NULL;

-- =============================================================================
-- 6. Backfill nutrition_plan_daily_targets for active plans
-- =============================================================================

-- For clients WITHOUT custom day distribution: all 7 days get the same baseline
-- For clients WITH custom day distribution: use day_calorie_overrides JSON

-- Helper: generate 7 rows per active plan
-- First, handle non-custom-distribution plans (uniform baseline across all days)
INSERT INTO nutrition_plan_daily_targets (
  nutrition_plan_id,
  day_of_week,
  calories,
  protein_g,
  carb_g,
  fat_g,
  is_training_day
)
SELECT
  np.id,
  d.day_name,
  -- Use custom_calories if custom_macros_enabled, otherwise baseline
  CASE WHEN np.custom_macros_enabled AND np.custom_calories IS NOT NULL
       THEN np.custom_calories
       ELSE np.baseline_calories END,
  CASE WHEN np.custom_macros_enabled AND np.custom_protein_g IS NOT NULL
       THEN np.custom_protein_g
       ELSE np.protein_target_g END,
  CASE WHEN np.custom_macros_enabled AND np.custom_carb_g IS NOT NULL
       THEN np.custom_carb_g
       ELSE np.carb_target_g END,
  CASE WHEN np.custom_macros_enabled AND np.custom_fat_g IS NOT NULL
       THEN np.custom_fat_g
       ELSE np.fat_target_g END,
  -- Check if there's a training session on this day from the active training plan
  EXISTS (
    SELECT 1 FROM training_sessions ts
    JOIN training_plans tp ON tp.id = ts.plan_id
    WHERE tp.client_id = np.client_id
      AND tp.status = 'active'
      AND tp.deleted_at IS NULL
      AND ts.session_type != 'external_activity'
      AND LOWER(ts.day_of_week) = d.day_name
  )
FROM nutrition_plans np
JOIN clients c ON c.id = np.client_id
CROSS JOIN (
  VALUES ('monday'), ('tuesday'), ('wednesday'), ('thursday'),
         ('friday'), ('saturday'), ('sunday')
) AS d(day_name)
WHERE np.status = 'active'
  AND (c.custom_day_distribution IS NULL OR c.custom_day_distribution = false);

-- Handle custom day distribution plans: use day_calorie_overrides JSON
INSERT INTO nutrition_plan_daily_targets (
  nutrition_plan_id,
  day_of_week,
  calories,
  protein_g,
  carb_g,
  fat_g,
  is_training_day
)
SELECT
  np.id,
  d.day_name,
  COALESCE((c.day_calorie_overrides->d.day_name->>'calories')::integer, np.baseline_calories),
  COALESCE((c.day_calorie_overrides->d.day_name->>'protein_g')::numeric, np.protein_target_g),
  COALESCE((c.day_calorie_overrides->d.day_name->>'carbs_g')::numeric, np.carb_target_g),
  COALESCE((c.day_calorie_overrides->d.day_name->>'fat_g')::numeric, np.fat_target_g),
  EXISTS (
    SELECT 1 FROM training_sessions ts
    JOIN training_plans tp ON tp.id = ts.plan_id
    WHERE tp.client_id = np.client_id
      AND tp.status = 'active'
      AND tp.deleted_at IS NULL
      AND ts.session_type != 'external_activity'
      AND LOWER(ts.day_of_week) = d.day_name
  )
FROM nutrition_plans np
JOIN clients c ON c.id = np.client_id
CROSS JOIN (
  VALUES ('monday'), ('tuesday'), ('wednesday'), ('thursday'),
         ('friday'), ('saturday'), ('sunday')
) AS d(day_name)
WHERE np.status = 'active'
  AND c.custom_day_distribution = true
  AND c.day_calorie_overrides IS NOT NULL;
