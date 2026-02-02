-- Migration to convert client_id from TEXT to UUID and add foreign key constraints
-- NOTE: This migration will clear existing test data in check_ins and check_in_tokens
-- If you have production data you want to preserve, see the commented alternative approach below

-- Step 1: Clear existing test data
TRUNCATE TABLE check_in_tokens CASCADE;
TRUNCATE TABLE check_ins CASCADE;

-- Step 2: Alter check_ins.client_id to UUID with foreign key
ALTER TABLE check_ins
  DROP COLUMN client_id;

ALTER TABLE check_ins
  ADD COLUMN client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE;

-- Recreate the index
CREATE INDEX idx_check_ins_client_id ON check_ins(client_id);

-- Step 3: Alter check_in_tokens.client_id to UUID with foreign key
ALTER TABLE check_in_tokens
  DROP COLUMN client_id;

ALTER TABLE check_in_tokens
  ADD COLUMN client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE;

-- Recreate the index
CREATE INDEX idx_check_in_tokens_client_id ON check_in_tokens(client_id);

-- Step 4: Update RLS policies for check_ins to work with new foreign key relationship
DROP POLICY IF EXISTS "Users can view check-ins for their assigned clients" ON check_ins;
DROP POLICY IF EXISTS "Users can create check-ins" ON check_ins;
DROP POLICY IF EXISTS "Users can update their own check-ins" ON check_ins;

-- Coaches can view check-ins for their clients
CREATE POLICY "Coaches can view their clients check-ins"
  ON check_ins
  FOR SELECT
  USING (
    client_id IN (
      SELECT id FROM clients WHERE coach_id IN (
        SELECT id FROM coaches WHERE user_id = auth.uid()
      )
    )
  );

-- Coaches can create check-ins for their clients
CREATE POLICY "Coaches can create check-ins for their clients"
  ON check_ins
  FOR INSERT
  WITH CHECK (
    client_id IN (
      SELECT id FROM clients WHERE coach_id IN (
        SELECT id FROM coaches WHERE user_id = auth.uid()
      )
    )
  );

-- Coaches can update check-ins for their clients
CREATE POLICY "Coaches can update their clients check-ins"
  ON check_ins
  FOR UPDATE
  USING (
    client_id IN (
      SELECT id FROM clients WHERE coach_id IN (
        SELECT id FROM coaches WHERE user_id = auth.uid()
      )
    )
  );

-- Update RLS policies for check_in_tokens
DROP POLICY IF EXISTS "Anyone can view valid unused tokens" ON check_in_tokens;
DROP POLICY IF EXISTS "Authenticated users can create tokens" ON check_in_tokens;
DROP POLICY IF EXISTS "System can update tokens" ON check_in_tokens;

-- Coaches can create tokens for their clients
CREATE POLICY "Coaches can create tokens for their clients"
  ON check_in_tokens
  FOR INSERT
  WITH CHECK (
    client_id IN (
      SELECT id FROM clients WHERE coach_id IN (
        SELECT id FROM coaches WHERE user_id = auth.uid()
      )
    )
  );

-- Coaches can view tokens for their clients
CREATE POLICY "Coaches can view their clients tokens"
  ON check_in_tokens
  FOR SELECT
  USING (
    client_id IN (
      SELECT id FROM clients WHERE coach_id IN (
        SELECT id FROM coaches WHERE user_id = auth.uid()
      )
    )
  );

-- Coaches can update tokens for their clients
CREATE POLICY "Coaches can update their clients tokens"
  ON check_in_tokens
  FOR UPDATE
  USING (
    client_id IN (
      SELECT id FROM clients WHERE coach_id IN (
        SELECT id FROM coaches WHERE user_id = auth.uid()
      )
    )
  );

/*
ALTERNATIVE APPROACH (if you need to preserve existing data):

-- Step 1: Add new UUID column
ALTER TABLE check_ins ADD COLUMN client_id_new UUID;

-- Step 2: Manually map existing TEXT client_ids to UUID client_ids
-- You would need to first insert corresponding records in the clients table
-- INSERT INTO clients (id, coach_id, name, email) VALUES (...);
-- Then update: UPDATE check_ins SET client_id_new = 'uuid-value' WHERE client_id = 'text-value';

-- Step 3: Once all data is migrated, drop old column and rename new one
ALTER TABLE check_ins DROP COLUMN client_id;
ALTER TABLE check_ins RENAME COLUMN client_id_new TO client_id;
ALTER TABLE check_ins ALTER COLUMN client_id SET NOT NULL;
ALTER TABLE check_ins ADD CONSTRAINT fk_check_ins_client_id
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
*/
