-- Session 6.4: daily logs become the single source of truth for training completion.
-- check_in_session_completions is no longer read or written; detail readers derive from
-- training_events.status + session_logs. CASCADE drops the RLS policies created in 017/026/052
-- and the table's own FKs (check_in_id, training_session_id) defined in migration 017.
DROP TABLE IF EXISTS check_in_session_completions CASCADE;
