-- =============================================================================
-- Migration 187: a set to failure has one type (owner, 2026-09-19).
--
-- "AMRAP" names a group format and nothing else. A set taken to failure and an
-- "AMRAP" set were the same thing under two words, so the set type goes and
-- every stored one becomes a failure set — its reps, load and place untouched —
-- in the four stores that hold a set type: set_logs.set_type,
-- coach_saved_exercises.set_specs, training_exercises.set_specs and the
-- set_specs inside exercise_logs.prescribed_exercise_snapshot. set_logs' CHECK
-- (migration 119) shrinks to the four types SET_TYPES names in
-- utils/exercise-set-specs.ts; utils/exercise-set-specs.test.ts reads this file
-- so the two cannot drift. The JSONB stores carry no CHECK (as migration 183
-- left them): the zod schemas refuse the word on every write path.
--
-- No function reads the word: migration 120's analytics functions exclude
-- 'warmup' alone. Re-runnable — the rewrites are no-ops the second time and the
-- CHECK is dropped by name before it is added.
-- =============================================================================

-- 1. Logged sets.
UPDATE set_logs
SET set_type = 'failure'
WHERE set_type = 'amrap';

-- 2. Library prescriptions: rewrite only the rows holding an amrap element, in
--    element order.
UPDATE coach_saved_exercises AS e
SET set_specs = (
  SELECT jsonb_agg(
    CASE WHEN s->>'set_type' = 'amrap' THEN s || '{"set_type":"failure"}'::jsonb ELSE s END
    ORDER BY o
  )
  FROM jsonb_array_elements(e.set_specs) WITH ORDINALITY AS t(s, o)
)
WHERE jsonb_typeof(e.set_specs) = 'array'
  AND e.set_specs @> '[{"set_type":"amrap"}]'::jsonb;

-- 3. Client prescriptions, retired rows included.
UPDATE training_exercises AS e
SET set_specs = (
  SELECT jsonb_agg(
    CASE WHEN s->>'set_type' = 'amrap' THEN s || '{"set_type":"failure"}'::jsonb ELSE s END
    ORDER BY o
  )
  FROM jsonb_array_elements(e.set_specs) WITH ORDINALITY AS t(s, o)
)
WHERE jsonb_typeof(e.set_specs) = 'array'
  AND e.set_specs @> '[{"set_type":"amrap"}]'::jsonb;

-- 4. The prescription each logged exercise was logged against.
UPDATE exercise_logs AS l
SET prescribed_exercise_snapshot = jsonb_set(
  l.prescribed_exercise_snapshot,
  '{set_specs}',
  (
    SELECT jsonb_agg(
      CASE WHEN s->>'set_type' = 'amrap' THEN s || '{"set_type":"failure"}'::jsonb ELSE s END
      ORDER BY o
    )
    FROM jsonb_array_elements(l.prescribed_exercise_snapshot->'set_specs') WITH ORDINALITY AS t(s, o)
  )
)
WHERE jsonb_typeof(l.prescribed_exercise_snapshot->'set_specs') = 'array'
  AND l.prescribed_exercise_snapshot->'set_specs' @> '[{"set_type":"amrap"}]'::jsonb;

-- 5. The CHECK: four types, and 'amrap' can never be stored again.
ALTER TABLE set_logs DROP CONSTRAINT IF EXISTS set_logs_set_type_check;
ALTER TABLE set_logs
  ADD CONSTRAINT set_logs_set_type_check
  CHECK (set_type IN ('warmup', 'working', 'drop', 'failure'));
