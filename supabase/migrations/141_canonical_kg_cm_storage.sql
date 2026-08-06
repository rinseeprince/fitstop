-- =============================================================================
-- Canonical storage: every weight is kilograms, every length is centimetres.
--
-- WHY: units were stored in whatever the user happened to be looking at, tagged
-- by per-row/per-client columns that are unreliable or absent. Values are
-- converted here using those tags and the tags are then dropped, so nothing
-- between the database and the render layer knows about lbs or inches. Phase 3
-- converts at the presentation boundary; until then the UI prints kg numbers
-- under whatever label it hardcoded, which is expected.
-- Full model: docs/UNITS-CANONICALIZATION-PLAN.md.
--
-- WHY THIS FILE IS THE FIRST OF 141 TO USE AN EXPLICIT TRANSACTION: the drops
-- below are idempotent (IF EXISTS) but the conversions are not. A half-applied
-- push would leave the tags in place, and a re-run would multiply an
-- already-converted value by 0.45359237 a SECOND time -- silently, with no way
-- to detect it afterwards. 139_nutrition_event_coach_note.sql:26-27 records that
-- partial application is real here (the CLI's statement splitter is byte-
-- fragile), so IF EXISTS alone is not enough. All-or-nothing is.
--
-- CONVERSION FACTORS: 0.45359237 kg per lb and 2.54 cm per inch, both exact by
-- definition. They replace four conflicting constants that were in the tree
-- (2.205, 2.20462, 0.453592, and /2.205 in SQL at 044:234,243).
--
-- ON CHOOSING A SIGNAL PER COLUMN: the tags are not uniformly trustworthy, so
-- each conversion below uses the strongest signal that column actually has --
-- the row tag where it was written deliberately, the owning client's tag where
-- the row has none, and the VALUE itself where both tags are known-unreliable
-- but the unit ranges separate. Each step states which and why. Applying one
-- rule everywhere would corrupt data; the per-step notes are the record of that.
--
-- SCOPE NOTE: no view, function, index or policy references any dropped column.
-- Verified against the LIVE catalog, not the tree (this repo has recorded prod
-- drift): a pg_proc.prosrc text search across all schemas returned zero rows,
-- with a positive control confirming the search matches plpgsql bodies. A text
-- search rather than a dependency check on purpose -- plpgsql bodies are not
-- dependency-tracked, so a DROP would succeed and the function would fail at
-- runtime instead (139_nutrition_event_coach_note.sql:20-23).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- STEP 1 -- clients. Row tag is the signal; it is written deliberately by the
-- create/update paths. No-op on Dev (the only lbs-tagged clients carry NULL
-- weights, and every in-tagged client carries a NULL height), but correct by
-- rule wherever that is not true.
-- -----------------------------------------------------------------------------
UPDATE public.clients
   SET current_weight  = current_weight  * 0.45359237,
       starting_weight = starting_weight * 0.45359237,
       goal_weight     = goal_weight     * 0.45359237
 WHERE weight_unit = 'lbs';

UPDATE public.clients
   SET height = height * 2.54
 WHERE height_unit = 'in';

-- -----------------------------------------------------------------------------
-- STEP 2 -- client_goals.goal_weight. The row has NO tag of its own, so the
-- owning client's is the only signal. Runs before the tag columns are dropped.
-- -----------------------------------------------------------------------------
UPDATE public.client_goals g
   SET goal_weight = g.goal_weight * 0.45359237
  FROM public.clients c
 WHERE c.id = g.client_id
   AND g.goal_weight IS NOT NULL
   AND c.weight_unit = 'lbs';

-- -----------------------------------------------------------------------------
-- STEP 3 -- check_ins.weight. The row tag alone CANNOT be trusted: the column
-- defaults to 'lbs' (001_create_check_ins_table.sql:16) and
-- app/api/client/check-ins/route.ts:214 stores `body.weightUnit ?? "lbs"`, while
-- components/check-in/step-metrics.tsx:81 highlights **kg** when the toggle is
-- untouched. An unset form therefore persists a kg value under an lbs tag.
--
-- The corroboration below does NOT resolve that case, and no available signal
-- does: clients.weight_unit also defaults to 'lbs' (009_add_client_goal_fields.sql:4,
-- and lib/validations/client.ts:26 defaults the create payload to 'lbs'), and
-- clients.unit_preference defaults to 'imperial' (011_add_nutrition_fields.sql:4).
-- A coach-created client who never touched either control is indistinguishable
-- from a genuinely imperial one.
--
-- What the predicate DOES reject is a row whose client is affirmatively
-- kg-tagged. That covers every seeded fixture -- scripts/seed-scale-client.ts:838
-- hardcodes weight_unit 'lbs' onto a kg/metric client and is the source of all 51
-- lbs-tagged rows on Dev -- and every client explicitly set to metric.
--
-- Residual exposure is the untouched-form coach-created client. Accepted
-- deliberately: leaving a real lbs value reads as an obvious outlier later,
-- whereas converting a real kg value produces a plausible number that nobody
-- can ever detect, and the tag is dropped in this same transaction.
-- -----------------------------------------------------------------------------
UPDATE public.check_ins ci
   SET weight = ci.weight * 0.45359237
  FROM public.clients c
 WHERE c.id = ci.client_id
   AND ci.weight IS NOT NULL
   AND ci.weight_unit = 'lbs'
   AND COALESCE(c.weight_unit, 'kg') = 'lbs';

-- -----------------------------------------------------------------------------
-- STEP 4 -- check_ins girths. Guarded on the VALUE, not on the tag: 8 of the 111
-- 'in'-tagged rows carrying a waist are centimetres wearing an 'in' tag (waist
-- 88.5-92.0, hips 97.2-100.0, chest 104.0-104.7, arms 38-39, thighs 58-60 -- a
-- coherent human in cm, an impossibility in inches, since a 92 inch waist is
-- 7.7 feet). A blind x2.54 would make that waist 233.7 cm, irreversibly.
--
-- 60 sits in an empty band for all three guard columns. Legitimate inches reach
-- waist 36.1 / hips 40.0 / chest 42.0; centimetres start at waist 62.0 / hips
-- 70.0 / chest 75.0.
--
-- COALESCE across waist, hips and chest rather than keying on waist alone,
-- because components/check-in/step-metrics.tsx renders each girth independently
-- -- a row may carry hips without a waist, and keying on waist would silently
-- skip it and leave it in inches. arms and thighs are deliberately EXCLUDED from
-- the COALESCE: their inch and centimetre ranges straddle 60 (arms are 14 in vs
-- 38 cm), so they cannot share this threshold. A row carrying only arms or only
-- thighs is therefore skipped -- accepted, and better than inventing a second
-- constant to guess with.
--
-- Client corroboration is deliberately NOT used here: it would be wrong. The
-- perf fixture client is kg-tagged, yet its girths are genuinely inches.
-- -----------------------------------------------------------------------------
UPDATE public.check_ins
   SET waist  = waist  * 2.54,
       hips   = hips   * 2.54,
       chest  = chest  * 2.54,
       arms   = arms   * 2.54,
       thighs = thighs * 2.54
 WHERE measurement_unit = 'in'
   AND COALESCE(waist, hips, chest) < 60;

-- -----------------------------------------------------------------------------
-- STEP 5 -- body_metrics.weight. The row tag is explicit when present (this
-- column has no DEFAULT), so it wins. A NULL tag does NOT mean kilograms -- it
-- means the caller dropped the tag: 5 of recordBodyMetrics' 7 call sites omit
-- weightUnit, and 4 of those demonstrably held a tag and wrote it to a sibling
-- table (services/client-service.ts:86 and :255, client-check-in-service.ts:193,
-- app/api/clients/[id]/metrics/route.ts:202). So NULL falls back to the owning
-- client, which is exactly how the live read path already recovers it
-- (services/nutrition-calc-inputs.ts:90).
-- -----------------------------------------------------------------------------
UPDATE public.body_metrics bm
   SET weight = bm.weight * 0.45359237
  FROM public.clients c
 WHERE c.id = bm.client_id
   AND bm.weight IS NOT NULL
   AND COALESCE(bm.weight_unit, c.weight_unit) = 'lbs';

-- -----------------------------------------------------------------------------
-- STEP 6 -- client_metric_entries. Rows carry no unit tag at all (migration 132).
-- Weight entries resolve via the owning client. Girth entries are inches
-- unconditionally: the coach surface that writes them hardcodes inches
-- (lib/metrics/metric-entry-definitions.ts:61 returns "in" for every girth key),
-- so there is no imperial/metric branch to interrogate. Zero girth rows exist on
-- Dev; the statement is here because the write path can produce them.
-- -----------------------------------------------------------------------------
UPDATE public.client_metric_entries e
   SET value = e.value * 0.45359237
  FROM public.clients c
 WHERE c.id = e.client_id
   AND e.metric_key = 'weight'
   AND c.weight_unit = 'lbs';

UPDATE public.client_metric_entries
   SET value = value * 2.54
 WHERE metric_key IN ('waist', 'hips', 'chest', 'arms', 'thighs');

-- -----------------------------------------------------------------------------
-- STEP 7 -- set_logs.weight. Resolved via the owning client, NOT via
-- exercise_logs.weight_unit, even though that column looks like a per-row tag
-- for exactly these rows.
--
-- exercise_logs.weight_unit is noise, not measurement. It defaults to 'lbs'
-- (027_add_session_completion_tracking.sql:35) and the value it once described
-- was moved to set_logs in migration 090, orphaning it. Its 'lbs' rows are
-- hardcoded seed literals (scripts/seed-scale-client.ts:235,
-- scripts/perf-correctness.ts:206 both write "lbs" beside kg-magnitude values),
-- and components/client-portal/training/set-tracker.tsx:163 falls back to "lbs"
-- when the client's unit is absent.
--
-- The two candidate rules disagree by 450x: keying on exercise_logs would
-- convert 9,630 rows, keying on the client converts 21. The kg-tagged rows are
-- provably synthetic -- their median is 42.3 for EVERY exercise, from Archer
-- Pull Up to Axle Press -- which is scale-seed noise carrying no unit meaning.
-- -----------------------------------------------------------------------------
UPDATE public.set_logs sl
   SET weight = sl.weight * 0.45359237
  FROM public.exercise_logs el
  JOIN public.session_logs s ON s.id = el.session_log_id
  JOIN public.clients c      ON c.id = s.client_id
 WHERE el.id = sl.exercise_log_id
   AND sl.weight IS NOT NULL
   AND c.weight_unit = 'lbs';

-- -----------------------------------------------------------------------------
-- STEP 8 -- check_in_exercise_highlights.weight_value. Row tag is the signal
-- (no DEFAULT on this column, so it is explicit when set).
-- -----------------------------------------------------------------------------
UPDATE public.check_in_exercise_highlights
   SET weight_value = weight_value * 0.45359237
 WHERE weight_value IS NOT NULL
   AND weight_unit = 'lbs';

-- -----------------------------------------------------------------------------
-- client_intake.current_weight / target_weight / height are ALREADY kg and cm --
-- components/client/onboarding/intake-step-1.tsx converts before persisting, and
-- the columns default to 'kg'/'cm' (034:28,30). Its unit columns were never
-- written by any request path. No conversion; the dead tags drop below.
--
-- nutrition_plans.base_weight_kg / goal_weight_kg were verified kg on the live
-- DB (209 rows, 52.0-170.0, avg 84.0) and are left alone.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- DROP THE TAGS. Every CHECK constraint on these columns drops with its column,
-- so none is named here -- which is just as well for exercise_logs: that table
-- was renamed from client_exercise_completions (055:11) and Postgres does not
-- rename constraints, so its constraint is still called
-- client_exercise_completions_weight_unit_check. An explicit DROP CONSTRAINT
-- using the table's current name would error on a name that does not exist.
--
-- IF EXISTS throughout so a re-run after a failed push is clean (the whole file
-- is transactional, so a failure rolls the conversions back with it).
-- -----------------------------------------------------------------------------
ALTER TABLE public.clients
  DROP COLUMN IF EXISTS weight_unit,
  DROP COLUMN IF EXISTS height_unit;

ALTER TABLE public.check_ins
  DROP COLUMN IF EXISTS weight_unit,
  DROP COLUMN IF EXISTS measurement_unit;

ALTER TABLE public.body_metrics
  DROP COLUMN IF EXISTS weight_unit;

ALTER TABLE public.exercise_logs
  DROP COLUMN IF EXISTS weight_unit;

ALTER TABLE public.check_in_exercise_highlights
  DROP COLUMN IF EXISTS weight_unit;

ALTER TABLE public.client_intake
  DROP COLUMN IF EXISTS weight_unit,
  DROP COLUMN IF EXISTS height_unit;

-- -----------------------------------------------------------------------------
-- clients.unit_preference SURVIVES -- it is the client's viewer preference from
-- here on, no longer doing double duty as a storage tag. Only its DEFAULT
-- changes: 'imperial' (011_add_nutrition_fields.sql:4) is backwards for this
-- platform's users, so every new account started in the wrong system. Matches
-- coaches.unit_preference (migration 140). Existing row values are untouched.
-- -----------------------------------------------------------------------------
ALTER TABLE public.clients
  ALTER COLUMN unit_preference SET DEFAULT 'metric';

-- -----------------------------------------------------------------------------
-- Record the invariant on the columns themselves, so it is discoverable from
-- \d+ rather than only from a doc.
-- -----------------------------------------------------------------------------
COMMENT ON COLUMN public.clients.current_weight IS
  'Kilograms, always (migration 141). Convert at the render boundary via utils/unit-conversions.ts; never store a display unit.';
COMMENT ON COLUMN public.clients.starting_weight IS
  'Kilograms, always (migration 141).';
COMMENT ON COLUMN public.clients.goal_weight IS
  'Kilograms, always (migration 141).';
COMMENT ON COLUMN public.clients.height IS
  'Centimetres, always (migration 141).';
COMMENT ON COLUMN public.clients.unit_preference IS
  'This CLIENT''s own display unit system: metric (kg, cm) or imperial (lbs, in). Presentation only -- storage is canonical kg/cm regardless. Never read it to interpret a stored value.';

COMMENT ON COLUMN public.client_goals.goal_weight IS
  'Kilograms, always (migration 141).';

COMMENT ON COLUMN public.check_ins.weight IS
  'Kilograms, always (migration 141).';
COMMENT ON COLUMN public.check_ins.waist IS
  'Centimetres, always (migration 141). Same for hips, chest, arms, thighs.';

COMMENT ON COLUMN public.body_metrics.weight IS
  'Kilograms, always (migration 141).';

COMMENT ON COLUMN public.client_metric_entries.value IS
  'Unit is implied by metric_key and is canonical: weight is kilograms, girths (waist/hips/chest/arms/thighs) are centimetres, bodyFat is a percentage, wellness keys are their own scale (migration 141).';

COMMENT ON COLUMN public.set_logs.weight IS
  'Kilograms, always (migration 141). Render prescribed and logged loads through formatLoad (utils/unit-conversions.ts), which snaps to a loadable increment -- a faithful conversion of 100 kg is 220.5 lbs, which cannot be put on a bar.';

COMMENT ON COLUMN public.check_in_exercise_highlights.weight_value IS
  'Kilograms, always (migration 141).';

COMMENT ON COLUMN public.training_exercises.set_specs IS
  'Prescription JSONB. load_value is KILOGRAMS -- canonical since migration 141, previously kg only by UI convention. There is no per-spec unit key and none should be added; the viewer''s preference decides display, via formatLoad.';

COMMIT;
