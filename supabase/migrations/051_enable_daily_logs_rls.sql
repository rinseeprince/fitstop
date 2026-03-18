-- Enable RLS on daily_logs table
-- All existing code paths use supabaseAdmin (service role, bypasses RLS).
-- These policies provide defense-in-depth for any future code using the anon/server client.
--
-- Audited code paths (all supabaseAdmin):
--   services/daily-logs-service.ts: upsertDailyLog, getDailyLogs, getWeeklyLogs, getTodayLog
--   services/attention-feed-service.ts: evaluateAllClientTriggers
--   services/check-in-service.ts: enrichWithDailyLogCounts
--   services/weekly-nutrition-service.ts: upsertWeeklySummary
--   services/weekly-nutrition-backfill-service.ts: backfillWeeklySummariesForClient

ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;

-- Coaches can view daily logs for their clients
CREATE POLICY "coaches_select_client_daily_logs"
  ON daily_logs FOR SELECT
  USING (
    client_id IN (
      SELECT c.id FROM clients c
      JOIN coaches co ON co.id = c.coach_id
      WHERE co.user_id = auth.uid()
    )
  );

-- Clients can view their own daily logs
CREATE POLICY "clients_select_own_daily_logs"
  ON daily_logs FOR SELECT
  USING (
    client_id IN (
      SELECT id FROM clients WHERE user_id = auth.uid()
    )
  );

-- Clients can insert their own daily logs
CREATE POLICY "clients_insert_own_daily_logs"
  ON daily_logs FOR INSERT
  WITH CHECK (
    client_id IN (
      SELECT id FROM clients WHERE user_id = auth.uid()
    )
  );

-- Clients can update their own daily logs
CREATE POLICY "clients_update_own_daily_logs"
  ON daily_logs FOR UPDATE
  USING (
    client_id IN (
      SELECT id FROM clients WHERE user_id = auth.uid()
    )
  );
