-- =============================================================================
-- Migration 062: Create roadmaps and phases tables
-- Roadmaps group phases; phases group plans. One active roadmap per client,
-- one active phase per roadmap.
-- =============================================================================

-- =============================================================================
-- 1. Create roadmaps table
-- =============================================================================

CREATE TABLE roadmaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  coach_id UUID NOT NULL REFERENCES coaches(id),
  name TEXT NOT NULL DEFAULT 'Training Roadmap',
  long_term_goal TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'draft')),
  started_at DATE,
  target_end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one active roadmap per client
CREATE UNIQUE INDEX idx_roadmaps_active_unique
  ON roadmaps(client_id) WHERE status = 'active';

CREATE INDEX idx_roadmaps_client_created
  ON roadmaps(client_id, created_at DESC);

CREATE TRIGGER update_roadmaps_updated_at
  BEFORE UPDATE ON roadmaps
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE roadmaps ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 2. Create phases table
-- =============================================================================

CREATE TABLE phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_id UUID NOT NULL REFERENCES roadmaps(id) ON DELETE RESTRICT,
  -- RESTRICT: roadmaps must be archived, never hard-deleted while phases exist.
  -- deleteRoadmap service handles phase cleanup manually with guards.
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  objectives TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed', 'skipped')),
  start_date DATE,
  end_date DATE,
  duration_weeks INTEGER,
  phase_goals_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one active phase per roadmap
CREATE UNIQUE INDEX idx_phases_active_unique
  ON phases(roadmap_id) WHERE status = 'active';

CREATE INDEX idx_phases_roadmap_order
  ON phases(roadmap_id, order_index);

CREATE INDEX idx_phases_client_start
  ON phases(client_id, start_date DESC);

CREATE TRIGGER update_phases_updated_at
  BEFORE UPDATE ON phases
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE phases ENABLE ROW LEVEL SECURITY;
