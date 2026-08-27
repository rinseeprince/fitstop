-- 151 — Drop the three check_ins columns (and their two indexes) that only the
-- dev project ever had.
--
-- `uses_daily_logs`, `daily_logs_start_date` and `daily_logs_end_date`, with the
-- partial indexes idx_check_ins_uses_daily_logs and idx_check_ins_daily_logs_period,
-- were added to the DEV project by hand in March 2026 (they first appear in the
-- generated types on 2026-03-20) and no migration ever carried them. So prod
-- never had them, the tree never described them, and `types/database.ts` —
-- generated from dev — advertised three columns that do not exist in the
-- product. Found by diffing types generated from prod against the repo right
-- after prod was brought up to migration 150.
--
-- Nothing reads them, and no app code ever wrote them: the only writer was the
-- scale seed (scripts/seed/generate.ts), which stops in this same commit, and
-- every row holding a value belongs to a seeded coach. What they encoded is
-- redundant in any case — the two dates duplicate period_start / period_end.
--
-- IF EXISTS on every statement: a no-op on prod and on any database built from
-- the tree, which is what lets this file record the removal everywhere so the
-- two projects and the generated types finally agree.

DROP INDEX IF EXISTS public.idx_check_ins_daily_logs_period;
DROP INDEX IF EXISTS public.idx_check_ins_uses_daily_logs;

ALTER TABLE public.check_ins
  DROP COLUMN IF EXISTS uses_daily_logs,
  DROP COLUMN IF EXISTS daily_logs_start_date,
  DROP COLUMN IF EXISTS daily_logs_end_date;
