-- =============================================================================
-- Migration 060: Create client_goals table
-- Versioned goal tracking with superseding pattern (never update, create new).
-- Backfills existing goal data from clients table.
-- =============================================================================

-- =============================================================================
-- 1. Create client_goals table
-- =============================================================================

CREATE TABLE client_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  goal_weight NUMERIC,
  goal_body_fat_percentage NUMERIC,
  goal_deadline DATE,
  primary_goal TEXT,
  set_by TEXT NOT NULL DEFAULT 'coach',
  notes TEXT,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one active (non-superseded) goal record per client
CREATE UNIQUE INDEX idx_client_goals_active_unique
  ON client_goals(client_id) WHERE superseded_at IS NULL;

CREATE INDEX idx_client_goals_client_effective
  ON client_goals(client_id, effective_from DESC);

-- =============================================================================
-- 2. Trigger for updated_at
-- =============================================================================

CREATE TRIGGER update_client_goals_updated_at
  BEFORE UPDATE ON client_goals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 3. Enable RLS (policies added in migration 064)
-- =============================================================================

ALTER TABLE client_goals ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 4. Backfill from clients table
-- =============================================================================

INSERT INTO client_goals (
  client_id,
  goal_weight,
  goal_body_fat_percentage,
  goal_deadline,
  set_by,
  notes,
  effective_from
)
SELECT
  id,
  goal_weight,
  goal_body_fat_percentage,
  goal_deadline,
  'coach',
  'Backfilled from clients table',
  created_at
FROM clients
WHERE goal_weight IS NOT NULL
   OR goal_body_fat_percentage IS NOT NULL
   OR goal_deadline IS NOT NULL;
