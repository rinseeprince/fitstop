-- Drop training_plan_history: fully orphaned since builder P7.
--
-- The table stored AI-regeneration snapshots (plan JSONB + client-metrics /
-- check-in context) written by saveTrainingPlanHistory, which was deleted in
-- builder Phase 7 with the one-shot AI generation pipeline (commit 9b74439).
-- Its last reader — the Plans-tab history list → GET .../training/history →
-- getTrainingPlanHistory — was deleted in 0edaf9c, leaving zero code
-- references. Owner approved destroying the frozen pre-P7 snapshot rows.
--
-- No inbound FKs reference this table (verified against the migration tree);
-- its own indexes/policies (015, 026, 049) drop with it. IF EXISTS keeps a
-- half-failed push re-runnable.

DROP TABLE IF EXISTS public.training_plan_history;
