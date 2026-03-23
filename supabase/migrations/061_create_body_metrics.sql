-- =============================================================================
-- Migration 061: Create body_metrics table
-- Immutable event log for weight, body fat, BMR, TDEE measurements.
-- Backfills from check_ins and clients tables.
-- =============================================================================

-- =============================================================================
-- 1. Create body_metrics table
-- =============================================================================

CREATE TABLE body_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  weight NUMERIC,
  weight_unit TEXT,
  body_fat_percentage NUMERIC,
  bmr INTEGER,
  tdee INTEGER,
  source TEXT NOT NULL,
  source_id UUID,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- No updated_at: these are immutable event records
);

CREATE INDEX idx_body_metrics_client_recorded
  ON body_metrics(client_id, recorded_at DESC);

CREATE INDEX idx_body_metrics_client_source
  ON body_metrics(client_id, source);

-- =============================================================================
-- 2. Enable RLS (policies added in migration 064)
-- =============================================================================

ALTER TABLE body_metrics ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 3. Backfill from check_ins
-- =============================================================================

INSERT INTO body_metrics (
  client_id,
  weight,
  weight_unit,
  body_fat_percentage,
  source,
  source_id,
  recorded_at,
  created_at
)
SELECT
  client_id,
  weight,
  weight_unit,  -- nullable on older rows (pre-migration 017), passed through as-is
  body_fat_percentage,
  'check_in',
  id,
  created_at,
  created_at
FROM check_ins
WHERE weight IS NOT NULL
   OR body_fat_percentage IS NOT NULL;

-- =============================================================================
-- 4. Backfill from clients (only for clients with no check-in data)
-- =============================================================================

INSERT INTO body_metrics (
  client_id,
  weight,
  weight_unit,
  body_fat_percentage,
  bmr,
  tdee,
  source,
  recorded_at,
  created_at
)
SELECT
  id,
  current_weight,
  weight_unit,
  current_body_fat_percentage,
  ROUND(bmr)::INTEGER,   -- clients.bmr is NUMERIC(6,1); round before integer cast
  ROUND(tdee)::INTEGER,   -- clients.tdee is NUMERIC(6,1); round before integer cast
  'intake_sync',
  updated_at,
  updated_at
FROM clients
WHERE current_weight IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM body_metrics bm WHERE bm.client_id = clients.id
  );
