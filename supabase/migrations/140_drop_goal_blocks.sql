-- =============================================================================
-- Migration 140: drop the client goals + blocks feature at the schema level.
--
-- Owner decision 2026-07-30: the workstream is removed entirely (code removal
-- shipped in the commit preceding this one; the pre-removal state is tagged
-- goals-blocks-pre-removal). Migrations 137, 138 and 139 stay on disk on purpose
-- -- supabase_migrations.schema_migrations on the live database already records
-- all three as applied, so deleting the files would desync the local directory
-- from remote history and break the next `db push`. This is the same forward-drop
-- shape migration 133 used to remove the previous roadmaps/phases feature.
--
-- EVERY DROP BELOW IS DATA-SAFE, verified against the live database 2026-07-30:
--   client_phases                      -> 0 rows
--   nutrition_plans.phases_fingerprint -> 0 non-null rows
-- No view, foreign key, RPC or generated column references either object. (A
-- grep hit in 064_rls_policies_new_tables.sql is a POLICY NAME on the old
-- roadmap-era `phases` table, which migration 133 already dropped.)
--
-- Ordering is load-bearing, outermost dependency first:
--   1. The function, before anything it touches. update_client_goals_atomic
--      writes client_goals and the clients mirror; neither is dropped here, but
--      dropping the function first keeps the sequence honest if this migration
--      is ever extended.
--   2. The column, which only nutrition_plans owns.
--   3. The table, last. No CASCADE: nothing references it, and a CASCADE here
--      would silently destroy an unexpected dependent instead of failing loudly
--      -- the trap 133's own header calls out.
--
-- DEPLOY ORDER MATTERS. The code that calls update_client_goals_atomic is gone as
-- of the preceding commit, and updateGoals is back on its three-write TypeScript
-- path. Ship that code BEFORE running this migration: dropping the function while
-- the RPC-calling build is still live 500s every goal write.
--
-- WHAT REVERTING 139 GIVES BACK, recorded so it is a known cost and not a
-- surprise. 139 made updateGoals transactional. Without it, supersede-then-insert
-- is two unsynchronised writes: if the insert fails after the supersede commits,
-- the client is left with ZERO non-superseded goal rows. getCurrentGoals uses
-- maybeSingle(), so that reads as null, and a null goal weight means MAINTENANCE
-- to the calorie calculator -- a silent, plausible wrong answer rather than a
-- visible failure. Four of the five call paths swallow the error entirely. That
-- path is open again from the moment this runs. Live state at the time of writing:
-- 6 active goal rows, 0 diverged from the clients mirror. To keep the fix instead,
-- delete the DROP FUNCTION statement below before pushing -- the function is
-- self-contained and harmless to leave in place, just unreferenced.
--
-- Re-runnable: every statement is IF EXISTS, and the function is dropped by
-- explicit signature (a wrong-arity DROP silently leaves the real function).
-- Pure ASCII throughout (the CLI statement splitter is byte-fragile).
-- =============================================================================

-- 1. The transactional goal writer (migration 139).
DROP FUNCTION IF EXISTS update_client_goals_atomic(UUID, TEXT, NUMERIC, NUMERIC, DATE, DATE, TEXT);

-- 2. The blocks staleness marker on the durable nutrition plan (migration 138).
ALTER TABLE IF EXISTS public.nutrition_plans
  DROP COLUMN IF EXISTS phases_fingerprint;

-- 3. The blocks table itself (migration 137). Its index, CHECK constraints, RLS
--    enablement and service_role grant all drop with it.
DROP TABLE IF EXISTS public.client_phases;
