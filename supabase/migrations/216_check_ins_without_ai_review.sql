-- =============================================================================
-- 216_check_ins_without_ai_review.sql -- a check-in is pending until the
-- coach replies, then reviewed; the AI review's columns go
-- (docs/SUNSET-PLAN.md section 2.1, SD1 and SD8; commit S1, owner 2026-10-10).
--
-- The check-in AI review and its draft reply are removed from the product.
-- Nothing writes or reads the five columns the review kept on check_ins, and
-- the status 'ai_processed' meant only that the review had been written.
--
-- 1. Every 'ai_processed' check-in becomes 'pending', so it stays in the
--    coach's queue until a reply is sent (SD8). 592 of 3,050 on DEV on
--    2026-10-10.
-- 2. The status CHECK is dropped and added again as check_ins_status_check,
--    allowing 'pending' and 'reviewed' only. It is dropped by the column it
--    constrains, not by its name: migration 001 declared it inline, so both
--    projects should name it check_ins_status_check, and this way a project
--    whose name drifted still ends with the one CHECK.
-- 3. The five AI columns go: ai_summary, ai_insights, ai_recommendations,
--    ai_response_draft, ai_processed_at (SD1). No index, view, function or
--    publication reads them (live catalog, DEV, 2026-10-10).
--    idx_check_ins_status and idx_check_ins_client_status stay.
-- 4. A closing check: no AI column, and one CHECK on status, named
--    check_ins_status_check, naming the two statuses and not 'ai_processed'.
--    It prints how many check-ins are pending and how many reviewed.
--
-- Re-runnable. Pure ASCII.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The rows.
-- ---------------------------------------------------------------------------
UPDATE public.check_ins SET status = 'pending' WHERE status = 'ai_processed';

-- ---------------------------------------------------------------------------
-- 2. The status CHECK.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  status_check record;
BEGIN
  FOR status_check IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public.check_ins'::regclass
       AND c.contype = 'c'
       AND c.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a
                              WHERE a.attrelid = 'public.check_ins'::regclass AND a.attname = 'status')]::int2[]
  LOOP
    EXECUTE format('ALTER TABLE public.check_ins DROP CONSTRAINT %I', status_check.conname);
  END LOOP;
END $$;

ALTER TABLE public.check_ins
  ADD CONSTRAINT check_ins_status_check CHECK (status IN ('pending', 'reviewed'));

-- ---------------------------------------------------------------------------
-- 3. The AI columns.
-- ---------------------------------------------------------------------------
ALTER TABLE public.check_ins
  DROP COLUMN IF EXISTS ai_summary,
  DROP COLUMN IF EXISTS ai_insights,
  DROP COLUMN IF EXISTS ai_recommendations,
  DROP COLUMN IF EXISTS ai_response_draft,
  DROP COLUMN IF EXISTS ai_processed_at;

-- ---------------------------------------------------------------------------
-- 4. The closing check.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  ai_columns    text[];
  status_checks text[];
  pending       integer;
  reviewed      integer;
BEGIN
  SELECT array_agg(a.attname::text ORDER BY a.attname)
    INTO ai_columns
    FROM pg_attribute a
   WHERE a.attrelid = 'public.check_ins'::regclass
     AND NOT a.attisdropped
     AND a.attname IN ('ai_summary', 'ai_insights', 'ai_recommendations', 'ai_response_draft', 'ai_processed_at');
  IF ai_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 216: check_ins still has %', ai_columns;
  END IF;

  SELECT array_agg(c.conname || ': ' || pg_get_constraintdef(c.oid))
    INTO status_checks
    FROM pg_constraint c
   WHERE c.conrelid = 'public.check_ins'::regclass
     AND c.contype = 'c'
     AND c.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a
                            WHERE a.attrelid = 'public.check_ins'::regclass AND a.attname = 'status')]::int2[];
  IF coalesce(array_length(status_checks, 1), 0) <> 1
     OR status_checks[1] NOT LIKE 'check_ins_status_check: %'
     OR status_checks[1] NOT LIKE '%''pending''%'
     OR status_checks[1] NOT LIKE '%''reviewed''%'
     OR status_checks[1] LIKE '%ai_processed%' THEN
    RAISE EXCEPTION 'Migration 216: the status CHECK is not the two statuses: %', status_checks;
  END IF;

  SELECT count(*) FILTER (WHERE status = 'pending'),
         count(*) FILTER (WHERE status = 'reviewed')
    INTO pending, reviewed
    FROM public.check_ins;
  RAISE NOTICE 'Migration 216: % check-ins pending, % reviewed', pending, reviewed;
END $$;
