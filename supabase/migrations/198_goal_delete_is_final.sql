-- Migration 198: a goal delete is final.
--
-- delete_client_goal deletes the goal and its deadlines and returns nothing;
-- restore_client_goal goes.

DROP FUNCTION public.restore_client_goal(UUID, JSONB);
DROP FUNCTION public.delete_client_goal(UUID, UUID);

-- A goal hard-deleted, with its deadlines; the goal before it covers its days
-- again.
CREATE FUNCTION public.delete_client_goal(
  p_goal_id UUID,
  p_client_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_goal_id IS NULL OR p_client_id IS NULL THEN
    RAISE EXCEPTION 'invalid_args: a goal and a client are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('client_goals:' || p_client_id::text, 0));

  DELETE FROM client_goals WHERE id = p_goal_id AND client_id = p_client_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: goal % is not this client''s', p_goal_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_client_goal(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_client_goal(UUID, UUID)
  TO service_role;

COMMENT ON TABLE public.client_goals IS
  'One row per goal. A goal runs from starts_on until the next goal starts; no end is stored. A row dated ahead is a planned goal. Written only by the goal functions; hard-deleted by delete_client_goal.';
