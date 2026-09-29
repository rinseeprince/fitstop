-- =============================================================================
-- 204_client_habits_catalog_comments.sql -- three of migration 203's catalog
-- comments said more than the habit functions do (docs/HABITS-REBUILD-PLAN.md
-- §6 commit 1, the independent review). No rule changes; the comments now say
-- what holds:
--
-- - A version, once its first day has passed, keeps its start, target and
--   days. Only its end moves, and only from today on: a change or a stop from
--   today or later ends it the day before, and a change back to the same
--   target and days runs it on. No day before today changes.
-- - An entry is made on a day a version covers; a stop from today leaves an
--   entry the client already made that day, which counts in no figure.
-- - delete_client_habit deletes a habit only while it has no entries; a
--   client's removal takes their habits and entries together.
--
-- 203's header also overstates three things the functions do correctly:
-- rename, order and delete take no today, having no date rule; the reuse read
-- leaves out a habit this client has planned as well as one running; and a
-- number habit's unit is optional. The reuse read's defaults are those of the
-- most recently CREATED version: a version a change back extends keeps the
-- time it was created.
-- =============================================================================

COMMENT ON TABLE public.client_habits IS
  'A client''s habit: what it is. Its prescription is its versions. Written only by the habit functions; delete_client_habit deletes one only while it has no entries, and a client''s removal takes their habits and entries together.';

COMMENT ON TABLE public.client_habit_versions IS
  'A habit''s prescription: a run of days with its target and its days. A habit''s versions never overlap and may leave gaps. Once its first day has passed a version keeps its start, target and days; only its end moves, and only from today on, so no day before today changes.';

COMMENT ON TABLE public.client_habit_logs IS
  'The client''s entry: one per habit per day, made on a day a version covers; a stop from today leaves an entry already made that day, counted in no figure. Carries no target -- met is worked out against the day''s target when asked. A habit with entries cannot be deleted (NO ACTION), while a client''s removal takes both in one statement.';
