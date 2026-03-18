-- Fix missing ON DELETE behavior on foreign keys that could block coach deletion
-- or leave orphaned records.

-- training_plan_history.created_by_coach_id: no ON DELETE specified (defaults to
-- RESTRICT, blocking coach deletion). Change to SET NULL since the history record
-- should survive even if the coach is removed.
ALTER TABLE training_plan_history
  DROP CONSTRAINT IF EXISTS training_plan_history_created_by_coach_id_fkey,
  ADD CONSTRAINT training_plan_history_created_by_coach_id_fkey
    FOREIGN KEY (created_by_coach_id) REFERENCES coaches(id) ON DELETE SET NULL;

-- nutrition_plans.coach_id: no ON DELETE specified (defaults to RESTRICT, blocking
-- coach deletion). Change to CASCADE since nutrition plans belong to the coach
-- relationship and should be cleaned up.
ALTER TABLE nutrition_plans
  DROP CONSTRAINT IF EXISTS nutrition_plans_coach_id_fkey,
  ADD CONSTRAINT nutrition_plans_coach_id_fkey
    FOREIGN KEY (coach_id) REFERENCES coaches(id) ON DELETE CASCADE;

-- training_plans.coach_id: same issue as nutrition_plans.
ALTER TABLE training_plans
  DROP CONSTRAINT IF EXISTS training_plans_coach_id_fkey,
  ADD CONSTRAINT training_plans_coach_id_fkey
    FOREIGN KEY (coach_id) REFERENCES coaches(id) ON DELETE CASCADE;
