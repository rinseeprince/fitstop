-- Enable RLS on nutrition_weekly_summaries
-- Writes go through supabaseAdmin (system-level upserts), so no INSERT/UPDATE policies needed.

ALTER TABLE nutrition_weekly_summaries ENABLE ROW LEVEL SECURITY;

-- Coaches can view weekly summaries for their own clients
CREATE POLICY "coaches_view_client_weekly_summaries"
  ON nutrition_weekly_summaries FOR SELECT
  USING (
    client_id IN (
      SELECT id FROM clients WHERE coach_id = auth.uid()
    )
  );

-- Clients can view their own weekly summaries
CREATE POLICY "clients_view_own_weekly_summaries"
  ON nutrition_weekly_summaries FOR SELECT
  USING (
    client_id IN (
      SELECT id FROM clients WHERE user_id = auth.uid()
    )
  );
