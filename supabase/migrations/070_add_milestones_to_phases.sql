-- =============================================================================
-- 070: Add milestones JSONB column to phases
-- =============================================================================
-- Stores an array of milestone objects scoped to each phase.
-- Each milestone: {id, text, completed, completed_at}
-- =============================================================================

ALTER TABLE phases ADD COLUMN milestones JSONB NOT NULL DEFAULT '[]';

COMMENT ON COLUMN phases.milestones IS 'Array of {id, text, completed, completed_at} milestone objects';
