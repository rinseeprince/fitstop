-- Add period columns to check_ins for fixed 7-day check-in week tracking
ALTER TABLE check_ins ADD COLUMN period_start date;
ALTER TABLE check_ins ADD COLUMN period_end date;

-- Add index for efficient period lookups
CREATE INDEX idx_check_ins_period ON check_ins (client_id, period_start, period_end);
