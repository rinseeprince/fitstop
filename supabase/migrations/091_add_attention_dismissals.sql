CREATE TABLE attention_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  dismissed_at DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(coach_id, client_id, alert_type)
);

ALTER TABLE attention_dismissals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can access attention_dismissals"
  ON attention_dismissals FOR ALL TO authenticated USING (true) WITH CHECK (true);
