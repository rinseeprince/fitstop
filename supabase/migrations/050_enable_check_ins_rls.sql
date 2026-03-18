-- Enable RLS on check_ins table
-- Policies already exist (migrations 005 + 026) but RLS was never enabled,
-- meaning the policies were created but not enforced.
-- Coach policies: SELECT, INSERT, UPDATE (migration 005)
-- Client policies: SELECT, INSERT (migration 026)

ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;
