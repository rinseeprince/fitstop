-- Which prescription columns a coach actually fills in for an exercise.
--
-- Heavy compounds want set type, reps, load, RPE and rest. A high-rep accessory
-- may want reps and rest and nothing else. This is not an editor preference: it
-- decides what the CLIENT app renders and therefore what they can enter, so it
-- travels with the prescription rather than living beside it.
--
-- NULL means all five, which is why there is no backfill and no NOT NULL. Every
-- existing row is already correct, and a write path that forgets to carry the
-- column produces NULL — a client seeing the full prescription. The failure has
-- to point that way: too much is a bad day, an empty prescription they are meant
-- to train from is a broken session.
--
-- Both tiers carry it because placement copies a library exercise into a client
-- one (see docs/ARCHITECTURE.md -> Coach Library) and the shape must survive.

ALTER TABLE coach_saved_exercises
  ADD COLUMN IF NOT EXISTS prescribed_fields TEXT[];

ALTER TABLE training_exercises
  ADD COLUMN IF NOT EXISTS prescribed_fields TEXT[];

-- Only the five known names, and never an empty list: an exercise prescribing
-- nothing at all is not a state the coach UI can author (the last remaining
-- column cannot be unticked) and would render a client an empty grid.
ALTER TABLE coach_saved_exercises
  DROP CONSTRAINT IF EXISTS coach_saved_exercises_prescribed_fields_valid;
ALTER TABLE coach_saved_exercises
  ADD CONSTRAINT coach_saved_exercises_prescribed_fields_valid
  CHECK (
    prescribed_fields IS NULL
    OR (
      array_length(prescribed_fields, 1) >= 1
      AND prescribed_fields <@ ARRAY['set_type', 'reps', 'load', 'rpe', 'rest']::TEXT[]
    )
  );

ALTER TABLE training_exercises
  DROP CONSTRAINT IF EXISTS training_exercises_prescribed_fields_valid;
ALTER TABLE training_exercises
  ADD CONSTRAINT training_exercises_prescribed_fields_valid
  CHECK (
    prescribed_fields IS NULL
    OR (
      array_length(prescribed_fields, 1) >= 1
      AND prescribed_fields <@ ARRAY['set_type', 'reps', 'load', 'rpe', 'rest']::TEXT[]
    )
  );

COMMENT ON COLUMN coach_saved_exercises.prescribed_fields IS
  'Prescription columns the coach fills in. NULL = all five. Decides what the client app renders.';
COMMENT ON COLUMN training_exercises.prescribed_fields IS
  'Prescription columns the coach fills in. NULL = all five. Decides what the client app renders.';
