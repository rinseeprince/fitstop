-- =============================================================================
-- 207_client_habits_deleted_comment.sql -- one of migration 206's catalog
-- comments said more than the delete does (docs/HABITS-REBUILD-PLAN.md section
-- 6, commit 3, the independent review). No rule changes.
--
-- client_habits.deleted_at said a deleted habit's versions stay. The delete
-- stops the habit from today first, which removes the versions and one-date
-- edits from today on, so its PAST versions stay, with its entries.
-- Pure ASCII.
-- =============================================================================

COMMENT ON COLUMN public.client_habits.deleted_at IS
  'When the coach deleted a habit the client has logged: it runs no day from its delete, it leaves the coach''s list, the order and the choices, and no write but the client''s entry reaches it. Its past versions and its entries stay. NULL: not deleted.';
