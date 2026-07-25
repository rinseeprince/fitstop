-- 131: Add muscle soreness as the fifth wellness metric.
--
-- soreness is a 1-10 integer, HIGHER = MORE SORE (lower-is-better, like stress).
--
-- Three changes:
--   1. wellness_logs.soreness  - nullable, NO CHECK (parity with mood/energy/sleep/stress,
--      which are bare nullable integers; scales are enforced by zod at the route layer).
--   2. check_ins.soreness      - nullable snapshot column WITH a CHECK (parity with that
--      table's existing per-metric CHECKs; derived server-side at check-in submit).
--   3. daily_logs_full         - re-issued with wl.soreness appended.
--
-- View landmine (see 123_daily_logs_full_security_invoker.sql): 056 created this view
-- owner-rights; a CREATE OR REPLACE from 056's source without the WITH clause silently
-- reverts it to owner-rights and launders past the RLS on the health-PII base tables.
-- The WITH (security_invoker = on) below is therefore mandatory, and the ALTER VIEW
-- after it is belt-and-braces. CREATE OR REPLACE (not DROP+CREATE) preserves the
-- existing owner and grants.
--
-- Column order: CREATE OR REPLACE VIEW can only append at the END of the select list,
-- so wl.soreness sits after tl.training_data rather than beside its wellness siblings.
-- Do not "tidy" this - reordering requires DROP+CREATE, which discards grants.
--
-- upsert_daily_log_atomic (latest definition 059, service_role-locked by 106) is
-- deliberately NOT extended: it has zero app callers, and touching it risks the
-- wrong-arity-REVOKE landmine across its two live overloads. It does not carry soreness.

ALTER TABLE wellness_logs ADD COLUMN IF NOT EXISTS soreness INTEGER;

ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS soreness INTEGER CHECK (soreness BETWEEN 1 AND 10);

CREATE OR REPLACE VIEW public.daily_logs_full WITH (security_invoker = on) AS
 SELECT dl.id,
    dl.client_id,
    dl.date,
    dl.notes,
    dl.phase_id,
    dl.created_at,
    dl.updated_at,
    wl.mood,
    wl.energy,
    wl.sleep,
    wl.stress,
    nl.calories_consumed,
    nl.protein_g,
    nl.carbs_g,
    nl.fat_g,
    nl.target_calories,
    nl.target_protein_g,
    nl.target_carbs_g,
    nl.target_fat_g,
    nl.nutrition_adherence,
    nl.calorie_surplus_deficit,
    tl.trained,
    tl.training_session_id,
    tl.training_data,
    wl.soreness
   FROM public.daily_logs dl
     LEFT JOIN public.wellness_logs wl ON wl.daily_log_id = dl.id
     LEFT JOIN public.nutrition_logs nl ON nl.daily_log_id = dl.id
     LEFT JOIN public.training_logs tl ON tl.daily_log_id = dl.id;

ALTER VIEW public.daily_logs_full SET (security_invoker = on);
