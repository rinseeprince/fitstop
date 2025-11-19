-- Migration 008: Add Check-In Tracking and Reminder System
-- This migration adds functionality to track client check-in schedules,
-- detect overdue clients, and manage reminder history

-- ============================================================================
-- PART 1: Extend clients table with check-in tracking fields
-- ============================================================================

-- Add check-in configuration fields to clients table
ALTER TABLE clients
ADD COLUMN check_in_frequency TEXT DEFAULT 'weekly'
  CHECK (check_in_frequency IN ('weekly', 'biweekly', 'monthly', 'custom', 'none')),
ADD COLUMN check_in_frequency_days INTEGER,
ADD COLUMN expected_check_in_day TEXT
  CHECK (expected_check_in_day IS NULL OR expected_check_in_day IN
    ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
ADD COLUMN last_reminder_sent_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN reminder_preferences JSONB DEFAULT
  '{"enabled": true, "auto_send": false, "send_before_hours": 24}';

-- Add adherence tracking fields
ALTER TABLE clients
ADD COLUMN total_check_ins_expected INTEGER DEFAULT 0,
ADD COLUMN total_check_ins_completed INTEGER DEFAULT 0,
ADD COLUMN check_in_adherence_rate DECIMAL(5,2) DEFAULT 0,
ADD COLUMN current_streak INTEGER DEFAULT 0,
ADD COLUMN longest_streak INTEGER DEFAULT 0;

-- Create indexes for performance
CREATE INDEX idx_clients_check_in_frequency ON clients(check_in_frequency);
CREATE INDEX idx_clients_last_reminder_sent_at ON clients(last_reminder_sent_at);
CREATE INDEX idx_clients_adherence_rate ON clients(check_in_adherence_rate);

-- Add comments for documentation
COMMENT ON COLUMN clients.check_in_frequency IS
  'Expected check-in frequency: weekly, biweekly, monthly, custom, none';
COMMENT ON COLUMN clients.check_in_frequency_days IS
  'Number of days between check-ins when frequency is set to custom';
COMMENT ON COLUMN clients.expected_check_in_day IS
  'Optional specific day of week when check-in is expected';
COMMENT ON COLUMN clients.last_reminder_sent_at IS
  'Timestamp of the last reminder sent to this client';
COMMENT ON COLUMN clients.reminder_preferences IS
  'JSON object with reminder settings: {enabled, auto_send, send_before_hours}';
COMMENT ON COLUMN clients.check_in_adherence_rate IS
  'Percentage of expected check-ins completed (0-100)';
COMMENT ON COLUMN clients.current_streak IS
  'Number of consecutive on-time check-ins';
COMMENT ON COLUMN clients.longest_streak IS
  'Highest consecutive on-time check-ins achieved';

-- ============================================================================
-- PART 2: Create check_in_reminders table
-- ============================================================================

CREATE TABLE check_in_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  reminder_type TEXT NOT NULL
    CHECK (reminder_type IN ('upcoming', 'overdue', 'follow_up')),
  days_overdue INTEGER,
  responded BOOLEAN DEFAULT false,
  responded_at TIMESTAMP WITH TIME ZONE,
  check_in_id UUID REFERENCES check_ins(id) ON DELETE SET NULL,
  sent_via TEXT DEFAULT 'system'
    CHECK (sent_via IN ('system', 'manual')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX idx_check_in_reminders_client_id ON check_in_reminders(client_id);
CREATE INDEX idx_check_in_reminders_sent_at ON check_in_reminders(sent_at DESC);
CREATE INDEX idx_check_in_reminders_responded ON check_in_reminders(responded, client_id);
CREATE INDEX idx_check_in_reminders_type ON check_in_reminders(reminder_type);

-- Add comments
COMMENT ON TABLE check_in_reminders IS
  'Tracks all check-in reminders sent to clients and their responses';
COMMENT ON COLUMN check_in_reminders.reminder_type IS
  'Type of reminder: upcoming (before due), overdue (past due), follow_up (multiple days overdue)';
COMMENT ON COLUMN check_in_reminders.days_overdue IS
  'Number of days overdue when reminder was sent (NULL if not overdue yet)';
COMMENT ON COLUMN check_in_reminders.responded IS
  'Whether client submitted a check-in after this reminder';
COMMENT ON COLUMN check_in_reminders.sent_via IS
  'How reminder was sent: system (automated) or manual (coach-initiated)';

-- ============================================================================
-- PART 3: Row Level Security (RLS) Policies for check_in_reminders
-- ============================================================================

ALTER TABLE check_in_reminders ENABLE ROW LEVEL SECURITY;

-- Coaches can view reminders for their clients
CREATE POLICY "Coaches can view reminders for their clients"
  ON check_in_reminders
  FOR SELECT
  USING (
    client_id IN (
      SELECT id FROM clients
      WHERE coach_id IN (
        SELECT id FROM coaches WHERE user_id = auth.uid()
      )
    )
  );

-- Coaches can create reminders for their clients
CREATE POLICY "Coaches can create reminders for their clients"
  ON check_in_reminders
  FOR INSERT
  WITH CHECK (
    client_id IN (
      SELECT id FROM clients
      WHERE coach_id IN (
        SELECT id FROM coaches WHERE user_id = auth.uid()
      )
    )
  );

-- Coaches can update reminders for their clients
CREATE POLICY "Coaches can update reminders for their clients"
  ON check_in_reminders
  FOR UPDATE
  USING (
    client_id IN (
      SELECT id FROM clients
      WHERE coach_id IN (
        SELECT id FROM coaches WHERE user_id = auth.uid()
      )
    )
  );

-- ============================================================================
-- PART 4: Database Functions
-- ============================================================================

-- Function to calculate client adherence stats
CREATE OR REPLACE FUNCTION calculate_client_adherence_stats(client_uuid UUID)
RETURNS TABLE(
  expected_count INTEGER,
  actual_count INTEGER,
  adherence_rate DECIMAL(5,2)
) AS $$
DECLARE
  account_age_days INTEGER;
  frequency_days INTEGER;
  v_expected_count INTEGER;
  v_actual_count INTEGER;
  v_adherence_rate DECIMAL(5,2);
BEGIN
  -- Get client's account age in days
  SELECT EXTRACT(DAY FROM NOW() - created_at)::INTEGER
  INTO account_age_days
  FROM clients
  WHERE id = client_uuid;

  -- Get frequency in days based on client's settings
  SELECT
    CASE check_in_frequency
      WHEN 'weekly' THEN 7
      WHEN 'biweekly' THEN 14
      WHEN 'monthly' THEN 30
      WHEN 'custom' THEN COALESCE(check_in_frequency_days, 7)
      ELSE 0
    END
  INTO frequency_days
  FROM clients
  WHERE id = client_uuid;

  -- Calculate expected count
  IF frequency_days > 0 AND account_age_days > 0 THEN
    v_expected_count := FLOOR(account_age_days::DECIMAL / frequency_days::DECIMAL)::INTEGER;
  ELSE
    v_expected_count := 0;
  END IF;

  -- Get actual count of completed check-ins
  SELECT COUNT(*)::INTEGER
  INTO v_actual_count
  FROM check_ins
  WHERE client_id = client_uuid;

  -- Calculate adherence rate (cap at 100%)
  IF v_expected_count > 0 THEN
    v_adherence_rate := LEAST((v_actual_count::DECIMAL / v_expected_count::DECIMAL) * 100, 100);
  ELSE
    v_adherence_rate := 100; -- No expectation = 100% adherence
  END IF;

  RETURN QUERY SELECT v_expected_count, v_actual_count, v_adherence_rate;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_client_adherence_stats IS
  'Calculates expected vs actual check-in counts and adherence rate for a client';

-- Function to update client adherence stats
CREATE OR REPLACE FUNCTION update_client_adherence_stats(client_uuid UUID)
RETURNS void AS $$
DECLARE
  stats RECORD;
BEGIN
  -- Get calculated stats
  SELECT * INTO stats
  FROM calculate_client_adherence_stats(client_uuid);

  -- Update client record
  UPDATE clients
  SET
    total_check_ins_expected = stats.expected_count,
    total_check_ins_completed = stats.actual_count,
    check_in_adherence_rate = stats.adherence_rate,
    updated_at = NOW()
  WHERE id = client_uuid;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_client_adherence_stats IS
  'Updates adherence statistics for a client based on their check-in history';

-- ============================================================================
-- PART 5: Triggers
-- ============================================================================

-- Trigger to mark reminder as responded when check-in is created
CREATE OR REPLACE FUNCTION mark_reminder_responded()
RETURNS TRIGGER AS $$
BEGIN
  -- Find the most recent unanswered reminder for this client and mark it as responded
  UPDATE check_in_reminders
  SET
    responded = true,
    responded_at = NOW(),
    check_in_id = NEW.id
  WHERE id = (
    SELECT id FROM check_in_reminders
    WHERE client_id = NEW.client_id
      AND responded = false
    ORDER BY sent_at DESC
    LIMIT 1
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_mark_reminder_responded
  AFTER INSERT ON check_ins
  FOR EACH ROW
  EXECUTE FUNCTION mark_reminder_responded();

COMMENT ON FUNCTION mark_reminder_responded IS
  'Automatically marks the most recent reminder as responded when client submits a check-in';

-- Trigger to update adherence stats when check-in is created
CREATE OR REPLACE FUNCTION update_adherence_on_check_in()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM update_client_adherence_stats(NEW.client_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_adherence_on_check_in
  AFTER INSERT ON check_ins
  FOR EACH ROW
  EXECUTE FUNCTION update_adherence_on_check_in();

COMMENT ON FUNCTION update_adherence_on_check_in IS
  'Automatically updates client adherence stats when a new check-in is submitted';
