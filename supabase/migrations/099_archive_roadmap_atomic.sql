-- =============================================================================
-- Migration 099: Atomic roadmap archive (end-and-replace)
-- Archives a roadmap AND closes its active+planned phases in a single
-- transaction, so ending a roadmap can never leave an `active` phase stranded
-- under an `archived` roadmap (an invalid pair that would hijack phase-is-king
-- nutrition resolution on the next regenerate).
-- Pattern follows transition_phase_atomic from migration 067.
-- Uses SECURITY DEFINER to match 067 (service_role already bypasses RLS; the
-- transaction boundary is the actual reason this is an RPC, not two updates).
-- =============================================================================

CREATE OR REPLACE FUNCTION archive_roadmap_atomic(
  p_roadmap_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Close any active OR planned phases so no phase outlives its archived
  -- roadmap. 067's archive_roadmap branch only skipped 'planned'; the active
  -- phase was left dangling. We skip both here.
  UPDATE phases
  SET status = 'skipped',
      updated_at = NOW()
  WHERE roadmap_id = p_roadmap_id
    AND status IN ('active', 'planned');

  -- Archive the roadmap itself.
  UPDATE roadmaps
  SET status = 'archived',
      updated_at = NOW()
  WHERE id = p_roadmap_id;
END;
$$;
