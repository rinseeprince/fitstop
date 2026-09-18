-- Measurement columns 1: the prescription (training upgrade, commit 11a).
--
-- Every exercise names its columns, from the one list of nineteen
-- (utils/prescribed-fields.ts mirrors the CHECK below; a test fails if the two
-- differ), and every numeric per-set target is a min/max pair.
--
-- 1. prescribed_fields: a null or empty list gets today's five, then the column
--    is NOT NULL with no default and a CHECK that the list is non-empty and a
--    subset of the nineteen. No default on purpose: a writer that forgot the
--    column would silently get the strength columns; it fails instead.
--    cardinality() rather than array_length(): migration 149's check let '{}'
--    through, because array_length of an empty array is NULL, not 0.
-- 2. set_specs: `rpe_target` becomes `rpe_min` + `rpe_max`, `load_value`
--    becomes `load_min` + `load_max`, in every stored set spec — library and
--    client exercises and the log snapshots — so nothing reads two spellings.
--    Spec-level keys only: a drop keeps its one `load_value`. A key that was
--    present with a null value becomes two present null keys; an absent key
--    stays absent. Idempotent: only specs still carrying an old key are
--    rewritten.
-- 3. coach_saved_exercises.rpe_target gets the 1–10 CHECK training_exercises
--    has had since migration 015, so an exercise the library accepts can
--    always be placed.
--
-- Probed on DEV 2026-09-18 before this ran: no tempo value anywhere, no RPE
-- outside 1–10, no non-numeric rpe_target or load_value, no spec already
-- carrying a range key. PROD needs the same probe before it is pushed.

-- ---------------------------------------------------------------------------
-- 1. The column list
-- ---------------------------------------------------------------------------

UPDATE coach_saved_exercises
SET prescribed_fields = ARRAY['set_type', 'reps', 'load', 'rpe', 'rest']::TEXT[]
WHERE prescribed_fields IS NULL OR cardinality(prescribed_fields) = 0;

UPDATE training_exercises
SET prescribed_fields = ARRAY['set_type', 'reps', 'load', 'rpe', 'rest']::TEXT[]
WHERE prescribed_fields IS NULL OR cardinality(prescribed_fields) = 0;

ALTER TABLE coach_saved_exercises
  ALTER COLUMN prescribed_fields SET NOT NULL;
ALTER TABLE training_exercises
  ALTER COLUMN prescribed_fields SET NOT NULL;

ALTER TABLE coach_saved_exercises
  DROP CONSTRAINT IF EXISTS coach_saved_exercises_prescribed_fields_valid;
ALTER TABLE coach_saved_exercises
  ADD CONSTRAINT coach_saved_exercises_prescribed_fields_valid
  CHECK (
    cardinality(prescribed_fields) >= 1
    AND prescribed_fields <@ ARRAY[
      'set_type', 'load', 'reps', 'rpe', 'rir', 'tempo',
      'distance', 'duration', 'pace', 'split', 'calories', 'cadence', 'stroke_rate',
      'resistance', 'heart_rate_zone', 'heart_rate', 'power', 'ftp_percent',
      'rest'
    ]::TEXT[]
  );

ALTER TABLE training_exercises
  DROP CONSTRAINT IF EXISTS training_exercises_prescribed_fields_valid;
ALTER TABLE training_exercises
  ADD CONSTRAINT training_exercises_prescribed_fields_valid
  CHECK (
    cardinality(prescribed_fields) >= 1
    AND prescribed_fields <@ ARRAY[
      'set_type', 'load', 'reps', 'rpe', 'rir', 'tempo',
      'distance', 'duration', 'pace', 'split', 'calories', 'cadence', 'stroke_rate',
      'resistance', 'heart_rate_zone', 'heart_rate', 'power', 'ftp_percent',
      'rest'
    ]::TEXT[]
  );

COMMENT ON COLUMN coach_saved_exercises.prescribed_fields IS
  'The measurement columns the coach prescribes for this exercise, a non-empty subset of the nineteen in utils/prescribed-fields.ts. Decides what the client app renders.';
COMMENT ON COLUMN training_exercises.prescribed_fields IS
  'The measurement columns the coach prescribes for this exercise, a non-empty subset of the nineteen in utils/prescribed-fields.ts. Decides what the client app renders.';

-- ---------------------------------------------------------------------------
-- 2. RPE and Load become pairs in every stored set spec
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pg_temp.range_set_specs(specs JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_agg(
    (s - 'rpe_target' - 'load_value')
    || CASE WHEN s ? 'rpe_target'
         THEN jsonb_build_object('rpe_min', s -> 'rpe_target', 'rpe_max', s -> 'rpe_target')
         ELSE '{}'::jsonb END
    || CASE WHEN s ? 'load_value'
         THEN jsonb_build_object('load_min', s -> 'load_value', 'load_max', s -> 'load_value')
         ELSE '{}'::jsonb END
    ORDER BY ord
  )
  FROM jsonb_array_elements(specs) WITH ORDINALITY AS e(s, ord);
$$;

CREATE OR REPLACE FUNCTION pg_temp.has_old_spec_keys(specs JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_typeof(specs) = 'array'
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(specs) x
       WHERE x ? 'rpe_target' OR x ? 'load_value'
     );
$$;

UPDATE coach_saved_exercises
SET set_specs = pg_temp.range_set_specs(set_specs)
WHERE pg_temp.has_old_spec_keys(set_specs);

UPDATE training_exercises
SET set_specs = pg_temp.range_set_specs(set_specs)
WHERE pg_temp.has_old_spec_keys(set_specs);

UPDATE exercise_logs
SET prescribed_exercise_snapshot = jsonb_set(
  prescribed_exercise_snapshot,
  '{set_specs}',
  pg_temp.range_set_specs(prescribed_exercise_snapshot -> 'set_specs')
)
WHERE pg_temp.has_old_spec_keys(prescribed_exercise_snapshot -> 'set_specs');

DROP FUNCTION IF EXISTS pg_temp.range_set_specs(JSONB);
DROP FUNCTION IF EXISTS pg_temp.has_old_spec_keys(JSONB);

-- ---------------------------------------------------------------------------
-- 3. RPE is 1–10 on every path
-- ---------------------------------------------------------------------------

ALTER TABLE coach_saved_exercises
  DROP CONSTRAINT IF EXISTS coach_saved_exercises_rpe_target_check;
ALTER TABLE coach_saved_exercises
  ADD CONSTRAINT coach_saved_exercises_rpe_target_check
  CHECK (rpe_target IS NULL OR (rpe_target >= 1 AND rpe_target <= 10));
