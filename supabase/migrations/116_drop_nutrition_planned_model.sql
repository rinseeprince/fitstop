-- Migration 116: drop the 'planned' nutrition-plan model.
--
-- Events-as-SOT overhaul, Session 3 (Mig C). With migration 115 the nutrition
-- plan is a single durable in-place plan -- there is no future/'planned' state
-- anymore. This migration retires the planned model:
--   1. Data step (PL/pgSQL DO block, for the diagnostics): promote a DUE
--      planned plan to active ONLY when the client has no active plan (so the
--      forward calendar is not blanked), then archive every remaining planned
--      plan. Collision-safe vs idx_nutrition_plans_active_unique; a no-op when
--      there are zero planned rows (expected pre-launch).
--   2. DROP INDEX idx_one_planned_nutrition_plan_per_client (migration 079).
--
-- CURRENT_DATE is UTC; acceptable for this one-time, ~0-row pre-launch step.
-- Pure ASCII (old supabase CLI splitter is byte-fragile). After push, assert:
--   SELECT count(*) FROM nutrition_plans WHERE status = 'planned';  -- expect 0

DO $$
DECLARE
  v_promoted INTEGER;
BEGIN
  -- Promote a due planned plan to active only for clients with no active plan.
  UPDATE nutrition_plans p
  SET status = 'active',
      effective_until = NULL,
      updated_at = NOW()
  WHERE p.status = 'planned'
    AND p.effective_from <= CURRENT_DATE
    AND NOT EXISTS (
      SELECT 1 FROM nutrition_plans a
      WHERE a.client_id = p.client_id AND a.status = 'active'
    );

  GET DIAGNOSTICS v_promoted = ROW_COUNT;
  IF v_promoted > 0 THEN
    -- A real promotion should not happen silently pre-launch.
    RAISE NOTICE 'Migration 116 promoted % due planned nutrition plan(s) to active', v_promoted;
  END IF;

  -- Archive everything still planned (future-dated, or due-but-client-had-active).
  UPDATE nutrition_plans
  SET status = 'archived',
      effective_until = COALESCE(effective_until, effective_from),
      updated_at = NOW()
  WHERE status = 'planned';
END $$;

DROP INDEX IF EXISTS idx_one_planned_nutrition_plan_per_client;
