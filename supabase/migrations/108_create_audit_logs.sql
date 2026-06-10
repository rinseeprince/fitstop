-- Audit log: an immutable trail of security-relevant actions on client-owned data.
--
-- WHY: there was no record of who changed what (coach mutations on a client's
-- plans/goals/metrics/lifecycle, invitation + activation events). An audit trail is
-- needed for incident investigation (e.g. detecting an account-takeover attempt or
-- a rogue coach) and basic accountability.
--
-- Immutable by design: rows are append-only, written only via service_role from
-- services/audit-log-service.ts. No updated_at (mirrors the body_metrics event-log
-- precedent — see ARCHITECTURE.md "body_metrics table").

CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who performed the action. Plain UUID (no FK): holds a coaches.id for trainer
  -- actions, a clients.id for client actions, NULL for system actions — disambiguated
  -- by actor_role. Avoids an extra auth.users lookup on every instrumented write.
  actor_id UUID,
  actor_role TEXT,                       -- 'trainer' | 'client' | 'system'
  action TEXT NOT NULL,                  -- e.g. 'client.activate', 'goal.create'
  target_table TEXT,                     -- the primary entity touched
  target_id UUID,                        -- id of that entity
  client_id UUID,                        -- tenant the action pertains to (nullable)
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_hash TEXT,                          -- SHA-256(ip) prefix; never the raw IP
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Query patterns: "everything that happened to this client" and "everything this
-- actor did", both newest-first.
CREATE INDEX idx_audit_logs_client_created ON public.audit_logs (client_id, created_at DESC);
CREATE INDEX idx_audit_logs_actor_created ON public.audit_logs (actor_id, created_at DESC);

-- RLS: deny-all for anon/authenticated. Audit data must never be reachable via the
-- public anon-key PostgREST endpoint; it is written and read only through
-- service_role (which bypasses RLS). This intentionally omits the usual
-- authenticated-allow policy (CONVENTIONS §8) because no end user may read the log.
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
