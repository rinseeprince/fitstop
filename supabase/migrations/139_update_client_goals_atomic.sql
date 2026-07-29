-- Make updateGoals transactional (execution-plan task 2.8a).
--
-- WHY: services/client-goals-service.ts performs three unsynchronised writes -
-- supersede the active row (:60-64), insert the new row (:105-114), mirror onto
-- clients (:122-134). If the insert fails after the supersede commits, the client
-- is left with ZERO non-superseded goal rows. getCurrentGoals uses maybeSingle(),
-- so that state reads as null, and a null goal weight means MAINTENANCE to the
-- calorie calculator and (since task 1.3) to the coach Overview. A silent,
-- plausible wrong answer rather than a visible failure.
--
-- The blast radius is the same on all five call paths, but only one of them shows
-- anything: the goals PUT catches and returns 500 (goals/route.ts:109-115). The
-- four dual-write callers - metrics/route.ts:215-225, client-service.ts:97-107
-- and :266-276, intake-review-service.ts:212-223 - each wrap the call in their own
-- try/catch that only console.errors, and each has ALREADY written the clients
-- mirror by then. So the justification here is DATA INTEGRITY, not silence: the
-- two stores diverge with no signal on four of five paths.
--
-- WHY AN RPC AND NOT AN APP-SIDE COMPENSATING RESTORE: a restore would be a
-- second non-atomic write that can itself fail, leaving the same hole one step
-- further along. This is the only shape that actually closes it.
--
-- THE MIRROR UPDATE IS INSIDE THE TRANSACTION, deliberately. It is not a new
-- write - it is the one client-goals-service.ts already performs at :122-134,
-- moved under the transaction. Today its error is swallowed (console.error, then
-- the request returns 200), which is how client_goals and the clients mirror came
-- to hold 90 kg / 9 % and 77 kg / 33 % for the same fixture client. Inside the
-- transaction a mirror failure now rolls the whole thing back and surfaces.
-- All three mirror columns are written, including goal_deadline: although
-- mapClientRow (lib/mappers.ts:72-73) never maps it - so client.goalDeadline is
-- always undefined and the three "?? client.goalDeadline" fallbacks are dead code
-- - the COLUMN is read raw by intake-review-service.ts:114 and used as a backfill
-- guard at :156-163. Dropping the write would cause spurious re-backfills.
--
-- NO "DEFAULT NULL" PARAMS. The repo convention is that optional RPC args get a
-- SQL DEFAULT NULL and the service omits them, but that assumes omitted means
-- "not supplied". Here NULL is a MEANINGFUL VALUE - it clears a goal field - so
-- omitted and null must stay distinguishable. The presence-merge (task 1.1s
-- hasOwnProperty AND !== undefined rule) therefore stays in TypeScript, where it
-- is unit-tested, and this function receives an already-merged complete row.
--
-- WHAT THIS DOES NOT FIX: the read-modify-write race. getCurrentGoals still runs
-- outside the transaction, so two concurrent PUTs can merge against the same
-- snapshot and the later write wins. What changes is that the loser now hits
-- idx_client_goals_active_unique (partial: client_id WHERE superseded_at IS NULL)
-- INSIDE the transaction and rolls back cleanly, instead of leaving the client
-- with zero goals. Out of scope here; recorded in the execution plan STATUS.
--
-- No table grants are touched: client_goals carries stock GRANT ALL to
-- anon/authenticated and CONVENTIONS 8:367 says not to retrofit those.
-- Re-runnable: DROP FUNCTION IF EXISTS by explicit signature, then CREATE.
-- Pure ASCII throughout (the CLI statement splitter is byte-fragile inside $$).

DROP FUNCTION IF EXISTS update_client_goals_atomic(UUID, TEXT, NUMERIC, NUMERIC, DATE, DATE, TEXT);

CREATE OR REPLACE FUNCTION update_client_goals_atomic(
  p_client_id                UUID,
  p_set_by                   TEXT,
  p_goal_weight              NUMERIC,
  p_goal_body_fat_percentage NUMERIC,
  p_goal_deadline            DATE,
  p_goal_start_date          DATE,
  p_primary_goal             TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- One clock for the whole operation, so superseded_at on the outgoing row and
  -- effective_from on the incoming row are exactly equal and the history has no
  -- gap. The BEFORE UPDATE trigger on client_goals re-stamps updated_at anyway.
  v_now TIMESTAMPTZ := NOW();
  v_new_goal_id UUID;
BEGIN
  -- Supersede first, then insert: idx_client_goals_active_unique is a PARTIAL
  -- unique index on (client_id) WHERE superseded_at IS NULL, so inserting before
  -- superseding would collide. Order is load-bearing, not stylistic.
  UPDATE client_goals
     SET superseded_at = v_now,
         updated_at    = v_now
   WHERE client_id = p_client_id
     AND superseded_at IS NULL;

  INSERT INTO client_goals (
    client_id,
    goal_weight,
    goal_body_fat_percentage,
    goal_deadline,
    goal_start_date,
    primary_goal,
    set_by,
    effective_from
  ) VALUES (
    p_client_id,
    p_goal_weight,
    p_goal_body_fat_percentage,
    p_goal_deadline,
    p_goal_start_date,
    p_primary_goal,
    p_set_by,
    v_now
  )
  RETURNING id INTO v_new_goal_id;

  -- The denormalized mirror. Only three of the five goal fields have a column on
  -- clients; goal_start_date and primary_goal have nowhere to go, exactly as in
  -- the TypeScript this replaces.
  UPDATE clients
     SET goal_weight              = p_goal_weight,
         goal_body_fat_percentage = p_goal_body_fat_percentage,
         goal_deadline            = p_goal_deadline,
         updated_at               = v_now
   WHERE id = p_client_id;

  RETURN v_new_goal_id;
END;
$$;

-- Migration 106 lockdown at this exact signature. A REVOKE at the wrong arity
-- silently leaves PUBLIC execute open on the real function.
REVOKE EXECUTE ON FUNCTION update_client_goals_atomic(UUID, TEXT, NUMERIC, NUMERIC, DATE, DATE, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION update_client_goals_atomic(UUID, TEXT, NUMERIC, NUMERIC, DATE, DATE, TEXT) TO service_role;
