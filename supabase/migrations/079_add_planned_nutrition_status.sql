-- =============================================================================
-- Migration 079: Add 'planned' status for nutrition plans with future effective dates.
-- A planned plan waits until its effective_from date, then gets lazily promoted
-- to active (archiving the current active plan).
-- =============================================================================

-- nutrition_plans.status is TEXT NOT NULL DEFAULT 'active' with no CHECK constraint,
-- so 'planned' is already a valid value. Just need the partial unique index.

-- Max one planned plan per client (mirrors idx_nutrition_plans_active_unique from 044)
CREATE UNIQUE INDEX idx_one_planned_nutrition_plan_per_client
  ON nutrition_plans (client_id) WHERE status = 'planned';
