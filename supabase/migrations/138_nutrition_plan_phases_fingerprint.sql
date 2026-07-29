-- Blocks staleness marker on the durable nutrition plan.
--
-- phases_fingerprint records the block set whose per-block grids are materialized
-- in client_phases.daily_targets AND reflected in this plan's nutrition_events.
-- Stale is simply: current fingerprint <> stored fingerprint. Renaming a block
-- does not change the hash (name is not an input), so there are no false
-- positives from an edit that changed nothing numeric.
--
-- NULL means NO BLOCK SET DROVE THIS GENERATION. That covers three cases
-- identically and deliberately: rows that predate this column, clients with no
-- blocks, and custom-macros saves (custom macros ARE the targets, so the
-- calculator never runs and no per-block grid is materialized). Reading NULL as
-- "no blocks" is what stops every existing client from rendering a spurious
-- "Nutrition is out of date" row the day the coach UI ships.
--
-- DELIBERATELY NOT WRITTEN BY create_nutrition_plan_atomic.
--
-- The stamp is the LAST write of a generation - after the plan upsert AND after
-- event regeneration (nutrition-plan-orchestrator.ts:263 and :389 both call
-- regenerateEventsOrThrow after createNutritionPlan). That ordering is the whole
-- correctness argument: the fingerprint can then only mean "every write in this
-- generation succeeded". A fingerprint stamped inside the RPC would assert
-- freshness while a failed event regeneration left the client eating the old
-- targets, and the coach Overview would affirmatively say the plan is current.
-- Reordering inside the RPC cannot fix that, because event generation needs the
-- plan id the RPC returns.
--
-- Every failure direction therefore lands on "stale", which self-heals on the
-- next regenerate:
--   grids fail  -> nothing else runs      -> old fingerprint -> stale
--   RPC fails   -> events not regenerated -> old fingerprint -> stale
--   events fail -> stamp not reached      -> old fingerprint -> stale
--   stamp fails -> everything else landed -> old fingerprint -> stale (false alarm)
-- There is no path to a false "up to date".
--
-- Keeping it out of the RPC also means NO ARITY CHANGE: no DROP/CREATE by
-- explicit signature, no REVOKE/GRANT replay at a new arity (the landmine
-- 115:152 warns about), and preserve-on-omit for free - an upsert whose insert
-- list and DO UPDATE bucket omit the column cannot touch it.

ALTER TABLE IF EXISTS public.nutrition_plans
  ADD COLUMN IF NOT EXISTS phases_fingerprint TEXT;

COMMENT ON COLUMN public.nutrition_plans.phases_fingerprint IS
  'sha256/base64url over each blocks (starts_on, ends_on, rate_per_week_kg), ordered by starts_on. Name is not an input, so a rename is never stale. NULL = no block set drove this generation (pre-column rows, block-less clients, custom-macros saves). Written by stampPhasesFingerprint as the LAST write of a generation, never by create_nutrition_plan_atomic.';
