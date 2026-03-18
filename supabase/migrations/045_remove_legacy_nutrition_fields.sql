-- Phase 3: Remove legacy nutrition fields from clients table
-- and drop deprecated tables (nutrition_plan_history, nutrition_daily_goals)
--
-- All reads/writes now use nutrition_plans + nutrition_plan_daily_targets.
-- Fields like bmr, tdee, goal_weight, goal_deadline are kept on clients
-- because they are fundamental client profile fields used by training AI,
-- check-in processing, and intake onboarding.

-- =============================================================================
-- 1. Remove nutrition plan configuration fields from clients
-- =============================================================================

ALTER TABLE clients
  DROP COLUMN IF EXISTS baseline_calories,
  DROP COLUMN IF EXISTS calorie_target,
  DROP COLUMN IF EXISTS protein_target_g,
  DROP COLUMN IF EXISTS carb_target_g,
  DROP COLUMN IF EXISTS fat_target_g,
  DROP COLUMN IF EXISTS diet_type,
  DROP COLUMN IF EXISTS work_activity_level,
  DROP COLUMN IF EXISTS training_volume_hours,
  DROP COLUMN IF EXISTS protein_target_g_per_kg,
  DROP COLUMN IF EXISTS custom_day_distribution,
  DROP COLUMN IF EXISTS day_calorie_overrides,
  DROP COLUMN IF EXISTS custom_macros_enabled,
  DROP COLUMN IF EXISTS custom_calories,
  DROP COLUMN IF EXISTS custom_protein_g,
  DROP COLUMN IF EXISTS custom_carb_g,
  DROP COLUMN IF EXISTS custom_fat_g,
  DROP COLUMN IF EXISTS nutrition_plan_base_weight_kg,
  DROP COLUMN IF EXISTS nutrition_plan_created_date;

-- =============================================================================
-- 2. Drop nutrition_plan_history table (data migrated to nutrition_plans in 044)
-- =============================================================================

DROP TABLE IF EXISTS nutrition_plan_history;

-- =============================================================================
-- 3. Drop nutrition_daily_goals table (dead code, no RLS — pre-existing gap)
-- =============================================================================

DROP TABLE IF EXISTS nutrition_daily_goals;
