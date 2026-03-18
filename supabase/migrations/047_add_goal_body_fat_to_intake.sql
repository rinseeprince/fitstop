-- Add goal body fat percentage to client intake (Step 2: Goals)
-- Optional field that syncs to clients.goal_body_fat_percentage via "Sync Metrics to Profile"

ALTER TABLE client_intake
  ADD COLUMN IF NOT EXISTS goal_body_fat_percentage NUMERIC(4, 2);
