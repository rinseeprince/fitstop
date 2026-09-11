-- 173: the food log holds what the client ate and nothing else.
--
-- Owner decision 2026-09-11 (block-as-program R1 → R2 → R3): a day's nutrition
-- target is COMPUTED — the version covering the date, its weekday grid row, the
-- session on the date, the coach's edit — and the verdict (hit / partial /
-- missed, surplus or deficit) is derived at read time from what was eaten
-- against that target. The six snapshot columns on nutrition_logs were a copy of
-- that answer, taken at each save: R1 re-pointed every reader at the day lookup,
-- R2 stopped the writer, and this drops the copy. The check-in submit remains the
-- one freeze (check_ins.period_snapshot, nutrition_days_on_target).
--
-- Probed before writing (CONVENTIONS §8 — a destructive change re-probes PROD):
-- DEV holds 13,925 food-log rows on 231 test clients; PROD holds zero clients and
-- zero rows. The only view naming the columns is daily_logs_full (migration 056,
-- security_invoker pinned by 123, recreated by 131 and 133); no other view, index
-- or inbound FK depends on them. upsert_daily_log_atomic (057/059) names them in
-- its plpgsql body — it has had no caller since Session 5.1 and its removal is
-- separate schema work (docs/ARCHITECTURE.md → "Daily Logs"); after this it
-- cannot be called at all.
--
-- A view cannot lose a column through CREATE OR REPLACE, so daily_logs_full is
-- dropped and recreated WITHOUT the six, with security_invoker inline (the
-- migration-123 lesson: a plain CREATE would launder past the RLS on the
-- health-PII base tables) and the same explicit service_role grant migration 133
-- carries. Column order otherwise matches 133 (soreness stays last — readers map
-- by name). Then the six columns go.

DROP VIEW IF EXISTS public.daily_logs_full;

CREATE VIEW public.daily_logs_full WITH (security_invoker = on) AS
 SELECT dl.id, dl.client_id, dl.date, dl.notes,
    dl.created_at, dl.updated_at,
    wl.mood, wl.energy, wl.sleep, wl.stress,
    nl.calories_consumed, nl.protein_g, nl.carbs_g, nl.fat_g,
    tl.trained, tl.training_session_id, tl.training_data,
    wl.soreness
   FROM public.daily_logs dl
     LEFT JOIN public.wellness_logs wl ON wl.daily_log_id = dl.id
     LEFT JOIN public.nutrition_logs nl ON nl.daily_log_id = dl.id
     LEFT JOIN public.training_logs tl ON tl.daily_log_id = dl.id;

ALTER VIEW public.daily_logs_full SET (security_invoker = on);

-- Supabase default privileges re-grant on CREATE; this is the explicit belt
-- for the one consumer the app path actually has (supabaseAdmin).
GRANT ALL ON TABLE public.daily_logs_full TO service_role;

ALTER TABLE public.nutrition_logs
  DROP COLUMN IF EXISTS target_calories,
  DROP COLUMN IF EXISTS target_protein_g,
  DROP COLUMN IF EXISTS target_carbs_g,
  DROP COLUMN IF EXISTS target_fat_g,
  DROP COLUMN IF EXISTS nutrition_adherence,
  DROP COLUMN IF EXISTS calorie_surplus_deficit;
