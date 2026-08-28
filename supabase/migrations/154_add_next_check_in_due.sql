-- Migration 154: store the check-in due date
--
-- `expected_check_in_day` answers three unrelated questions at once — when the
-- next check-in is due, which seven days a submitted check-in reports on, and
-- where the client's reporting week starts and ends. Changing the day moved the
-- schedule while silently re-cutting every window downstream of it, and because
-- "when is it next due" was DERIVED from the weekday rather than stored, setting
-- a client to Sunday on a Thursday produced a due date of LAST Sunday, "4 days
-- overdue", beside "Last submitted today".
--
-- This adds the one stored fact the schedule should have been all along. It is
-- written by exactly two things once the swap lands: the coach's date picker,
-- and a submitted check-in advancing it by the frequency. The reporting week
-- becomes a calculation from it rather than a second stored copy — a copy has to
-- be kept in step, a calculation cannot be out of step.
--
-- NOTHING READS THIS COLUMN YET. The swap and the drop of expected_check_in_day
-- are the next migration and the next commit.
--
-- No index: nothing filters on this column. getOverdueClients loads a coach's
-- clients and filters in TypeScript. Index with the query, not ahead of it.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS next_check_in_due DATE;

COMMENT ON COLUMN public.clients.next_check_in_due IS
  'The date this client''s next check-in is due. The single stored fact behind the check-in schedule: overdue is next_check_in_due < today, and the reporting week is the 7 days ending on the most recent occurrence of its weekday. NULL means no schedule. Written only by the coach''s date picker and by a submitted check-in advancing it by the frequency.';

-- ---------------------------------------------------------------------------
-- Backfill: run today's derivation once, so nobody's date moves.
--
-- This reproduces calculateNextExpectedCheckIn (lib/check-in-schedule.ts) as it
-- behaves for the callers that drive the coach's overdue surfaces — i.e. with
-- the client's last check-in period attached, the way getClientsForCoach builds
-- them. A verification script diffs every row against the real TypeScript
-- before anything is pointed at this column.
--
-- Deliberately left NULL:
--   * frequency 'none'      — the TS returns null for these.
--   * no expected_check_in_day — the TS falls back to a loop off the client's
--     last check-in, whose result lands on an arbitrary weekday. Storing that
--     would make the week anchor read that arbitrary weekday and undo the
--     Mon-Sun default just established for exactly these clients. NULL is what
--     "no schedule" means here, and it is what the picker will write when the
--     coach leaves the date empty.
-- ---------------------------------------------------------------------------

WITH last_check_in AS (
  -- The client's most recent check-in, ordered the same way getClientsForCoach
  -- sorts them. A NULL period_end reads as "no last period", matching the TS,
  -- which only takes the branch when the value is truthy.
  SELECT DISTINCT ON (client_id) client_id, period_end
  FROM public.check_ins
  ORDER BY client_id, created_at DESC
),
anchored AS (
  SELECT
    c.id,
    c.created_at,
    l.period_end AS last_period_end,
    -- getTodayInTimezone: the client's own local calendar day, with the same
    -- fallback to UTC that safeTimeZone applies to an unknown zone.
    (
      now() AT TIME ZONE (
        CASE
          WHEN EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = c.timezone)
            THEN c.timezone
          ELSE 'UTC'
        END
      )
    )::date AS today,
    CASE c.expected_check_in_day
      WHEN 'sunday' THEN 0
      WHEN 'monday' THEN 1
      WHEN 'tuesday' THEN 2
      WHEN 'wednesday' THEN 3
      WHEN 'thursday' THEN 4
      WHEN 'friday' THEN 5
      WHEN 'saturday' THEN 6
    END AS target_dow
  FROM public.clients c
  LEFT JOIN last_check_in l ON l.client_id = c.id
  WHERE c.expected_check_in_day IS NOT NULL
    AND COALESCE(c.check_in_frequency, 'weekly') <> 'none'
),
period AS (
  -- calculateCheckInPeriod: the period ends on the most recent occurrence of
  -- the check-in day on or before today.
  SELECT
    a.*,
    a.today - ((EXTRACT(DOW FROM a.today)::int - a.target_dow + 7) % 7) AS period_end
  FROM anchored a
)
UPDATE public.clients c
SET next_check_in_due = CASE
  -- Already checked in for the current period: the next one is a week out.
  WHEN p.last_period_end IS NOT NULL AND p.last_period_end = p.period_end
    THEN p.period_end + 7
  -- No prior check-in, and this period ended before the client existed: don't
  -- expect a check-in for a window that predates them. The TS compares a
  -- server-local midnight against the created_at instant, and the server runs
  -- UTC — hence the explicit UTC interpretation here rather than a bare cast,
  -- which would use the session timezone.
  WHEN p.last_period_end IS NULL
       AND (p.period_end::timestamp AT TIME ZONE 'UTC') < p.created_at
    THEN p.period_end + 7
  -- Not checked in for the current period: this period's end IS the due date,
  -- and a past one is exactly how overdue is defined.
  ELSE p.period_end
END
FROM period p
WHERE c.id = p.id;
