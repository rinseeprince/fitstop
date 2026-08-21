-- 148 — Backfill the client origin (start date + start measurements).
--
-- `clients.start_date` is the day coaching began, and three denominators
-- already measure from it: the check-in period clamp, the weekly-nutrition
-- partial first week, and the no-engagement grace — which returns null (the
-- alert SILENTLY OFF) without one. Activation now always sets it; this gives
-- the clients activated before that a value.
--
-- Non-destructive: both statements only fill gaps. Nothing is overwritten and
-- re-running is a no-op, so this is safe to apply to a database that has
-- already had it.
--
-- TWO NUMBERS WILL MOVE for a backfilled client, and that is the point: their
-- oldest check-in period and their first nutrition week become partial rather
-- than counting days before they were a client.

-- 1) The date. The client's EARLIEST chart point, so nothing on the Physique
--    chart moves — that chart plots check-ins and coach entries, and anchoring
--    the origin anywhere earlier would only add dead space in front of it.
--    Falls back to when the row was created, which is always present.
--    Both timestamps are read on the CLIENT's calendar; a start date sits on
--    their calendar, not the server's.
UPDATE public.clients c
SET start_date = COALESCE(
      LEAST(
        (SELECT MIN((ci.created_at AT TIME ZONE COALESCE(c.timezone, 'UTC'))::date)
           FROM public.check_ins ci WHERE ci.client_id = c.id),
        (SELECT MIN(e.entry_date)
           FROM public.client_metric_entries e WHERE e.client_id = c.id)
      ),
      (c.created_at AT TIME ZONE COALESCE(c.timezone, 'UTC'))::date
    ),
    updated_at = NOW()
WHERE c.onboarding_status = 'active'
  AND c.start_date IS NULL;

-- 2) The start measurements, ONLY for clients who have no measurements at all.
--    Everyone else already has a first point on their chart — the one the date
--    above was derived from — and adding a second on the same day would draw a
--    duplicate. This inserts the missing first point and nothing else.
--
--    No body_metrics event is written to match: these clients have none, and
--    every reader of a starting value prefers the cached column anyway
--    (comparison-service reads `startingWeight ?? earliest event`).
INSERT INTO public.client_metric_entries (client_id, metric_key, value, entry_date)
SELECT c.id, m.metric_key, m.value, c.start_date
FROM public.clients c
CROSS JOIN LATERAL (
  VALUES ('weight', c.starting_weight),
         ('bodyFat', c.starting_body_fat_percentage)
) AS m(metric_key, value)
WHERE c.onboarding_status = 'active'
  AND c.start_date IS NOT NULL
  AND m.value IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.client_metric_entries e WHERE e.client_id = c.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.check_ins ci WHERE ci.client_id = c.id
  )
ON CONFLICT (client_id, metric_key, entry_date) DO NOTHING;
