-- Add walkthrough_completed_at and start_date columns to clients table
ALTER TABLE clients ADD COLUMN walkthrough_completed_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE clients ADD COLUMN start_date DATE DEFAULT NULL;
