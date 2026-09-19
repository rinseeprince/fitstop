-- =============================================================================
-- Migration 185: exercise types
-- (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md §4.4, commit 13)
--
-- Every catalog exercise knows its type — strength, bodyweight, endurance, erg,
-- carry_sled or holds — so a new exercise in the builder starts on its type's
-- column preset (utils/column-presets.ts) and, from commit 16, its progress is
-- charted by its type's markers. The type is a fact about the CATALOG
-- exercise: it lives here only, never copied onto coach_saved_exercises,
-- training_exercises or a log snapshot, which reference the catalog by
-- exercise_id. The keys are the presets' keys (utils/exercise-types.ts, whose
-- list the CHECK mirrors — utils/exercise-types.test.ts reads this file).
--
-- Every row starts as strength: the coach-made rows (a coach-made exercise
-- starts as Strength and is edited in the exercise form) and, by §4.4's rule,
-- every global compound and isolation exercise except the carries, sleds and
-- holds picked out by name below. The cardio and plyometric exercises are
-- classified by hand (owner review, 2026-09-19). The name lists below mirror
-- the Type column of scripts/data/exercises.csv row for row (the same test
-- proves it), so a catalog seeded from the CSV and a live one classified here
-- agree. "Burpee Broad Jump", the HYROX station the catalog lacked, is added.
--
-- Re-runnable: the column and the constraint use IF NOT EXISTS / IF EXISTS,
-- the updates are idempotent, and the insert is skipped when the row exists.
-- =============================================================================

ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS exercise_type TEXT NOT NULL DEFAULT 'strength';

ALTER TABLE public.exercises DROP CONSTRAINT IF EXISTS exercises_exercise_type_check;
ALTER TABLE public.exercises ADD CONSTRAINT exercises_exercise_type_check
  CHECK (exercise_type = ANY (ARRAY['strength', 'bodyweight', 'endurance', 'erg', 'carry_sled', 'holds']::TEXT[]));

COMMENT ON COLUMN public.exercises.exercise_type IS
  'The exercise''s type: strength, bodyweight, endurance, erg, carry_sled or holds (utils/exercise-types.ts). Decides the column preset a new exercise starts on and, from commit 16, its progress chart. A fact about the catalog row only — never copied onto a prescription or a log.';

-- The global classification. Coach-made rows keep the default. ---------------

UPDATE public.exercises SET exercise_type = 'erg'
WHERE coach_id IS NULL AND lower(name) = ANY (ARRAY[
  'airdyne sprint',
  'assault bike',
  'assault bike sprint',
  'bike erg sprint',
  'bike intervals',
  'rower intervals',
  'rowing machine',
  'rowing machine sprint',
  'rowing sprint',
  'ski erg',
  'skierg sprint',
  'stationary bike'
]::TEXT[]);

UPDATE public.exercises SET exercise_type = 'endurance'
WHERE coach_id IS NULL AND lower(name) = ANY (ARRAY[
  'a skip',
  'b skip',
  'butt kicks',
  'high knees',
  'karaoke run',
  'band resisted sprint',
  'band sprint',
  'parachute sprint',
  'hill sprint',
  'sprint',
  'tabata sprints',
  'shuttle run',
  'pro agility shuttle',
  't-drill',
  'cone drill',
  'ladder drill',
  'running',
  'treadmill run',
  'treadmill sprint',
  'incline treadmill run',
  'treadmill incline walk',
  'weighted vest run',
  'weighted vest walk',
  'hiking',
  'cycling',
  'swimming',
  'swimming intervals',
  'elliptical',
  'stair climber',
  'stairmaster intervals',
  'versaclimber',
  'versa climber intervals',
  'jacob''s ladder',
  'cross country skiing machine',
  'jump rope'
]::TEXT[]);

UPDATE public.exercises SET exercise_type = 'bodyweight'
WHERE coach_id IS NULL AND lower(name) = ANY (ARRAY[
  'double under',
  'jumping jack',
  'ankle hop',
  'bounding',
  'box jump',
  'box jump over',
  'broad jump',
  'burpee box jump',
  'clap pull up',
  'clap push up',
  'explosive push up',
  'depth drop',
  'depth jump',
  'drop jump',
  'hurdle hop',
  'lateral bound',
  'lateral box jump',
  'lateral hurdle hop',
  'lunge jump',
  'plyo lunge',
  'pogo jump',
  'power skip',
  'seated box jump',
  'single leg bound',
  'single leg box jump',
  'single leg hop',
  'skater jump',
  'squat jump',
  'star jump',
  'tuck jump',
  'vertical jump',
  'burpee broad jump'
]::TEXT[]);

UPDATE public.exercises SET exercise_type = 'carry_sled'
WHERE coach_id IS NULL AND lower(name) = ANY (ARRAY[
  'farmer carry',
  'farmer walk',
  'farmers walk heavy',
  'farmer walk pause',
  'suitcase carry',
  'single arm farmer carry',
  'trap bar carry',
  'trap bar farmers walk',
  'front rack carry',
  'double kb front rack carry',
  'racked carry',
  'overhead carry',
  'overhead carry barbell',
  'single arm overhead carry',
  'single arm overhead walk',
  'dumbbell waiter walk',
  'bottoms up carry',
  'kettlebell bottoms up walk',
  'kettlebell horn walk',
  'offset carry',
  'mixed implement carry',
  'zercher carry',
  'barbell zercher walk',
  'yoke walk',
  'yoke walk heavy',
  'frame carry',
  'keg carry',
  'sandbag carry',
  'sandbag bear hug carry',
  'husafell stone carry',
  'conan''s wheel',
  'sled push',
  'sled push sprint',
  'sled push sprint short',
  'prowler push heavy',
  'sled pull',
  'sled drag',
  'reverse sled drag walk',
  'sled march',
  'sled row',
  'arm over arm sled pull',
  'hand over hand sled pull'
]::TEXT[]);

UPDATE public.exercises SET exercise_type = 'holds'
WHERE coach_id IS NULL AND lower(name) = ANY (ARRAY[
  'plank',
  'long lever plank',
  'rkc plank',
  'decline plank',
  'reverse plank',
  'single arm plank',
  'single leg plank',
  'star plank',
  'swiss ball plank',
  'trx plank',
  'weighted plank',
  'side plank',
  'side plank star',
  'weighted side plank',
  'trx side plank',
  'copenhagen plank',
  'copenhagen side plank',
  'l-sit',
  'l-sit on parallettes',
  'ring l-sit',
  'hanging l-sit',
  'hollow body hold',
  'hanging tuck',
  'wall sit',
  'deep squat hold',
  'cable goblet squat hold',
  'dead hang',
  'plate pinch hold',
  'handstand hold',
  'iron cross hold',
  'ring support hold',
  'ring dip to support hold',
  'tuck planche',
  'back lever hold',
  'front lever hold',
  'tuck front lever',
  'iso hold pull up',
  'iso hold dumbbell bench press',
  'isometric push up hold',
  'iso hold leg curl',
  'iso hold leg extension',
  'machine adduction pause hold',
  'cable pallof press hold',
  'superman'
]::TEXT[]);

-- The one HYROX station the catalog lacked ------------------------------------

INSERT INTO public.exercises (coach_id, name, muscle_group, equipment, category, aliases, exercise_type)
SELECT NULL, 'Burpee Broad Jump', 'full_body', 'bodyweight', 'plyometric',
       ARRAY['Burpee Broad Jumps', 'Burpee Long Jump']::TEXT[], 'bodyweight'
WHERE NOT EXISTS (
  SELECT 1 FROM public.exercises WHERE coach_id IS NULL AND lower(name) = 'burpee broad jump'
);
