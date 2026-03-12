-- Drop the old boolean column replaced by walkthrough_completed_at
ALTER TABLE clients DROP COLUMN IF EXISTS has_seen_walkthrough;
