-- Measurement columns 2: the actuals (training upgrade, commit 11b).
--
-- Every column a coach can prescribe gets its actual on the logged set, as a
-- real column with a CHECK equal to its target's limit
-- (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md section 4.4). The one table of these
-- measures is utils/set-log-measures.ts: utils/set-log-measures.test.ts reads
-- this file and fails if a bound, a type or a scale differs from it. reps,
-- weight and rpe (migration 090) and set_type (migration 119) stay as they are.
--
-- Nullable, no backfill: a set logged before this carries reps, weight and RPE
-- and nothing else, which is what it recorded. Additive, so PROD needs no probe.
--
-- Units are canonical (CONVENTIONS section 20): metres, seconds, seconds per
-- km, seconds per 500 m. Scales are the owner's resolutions: duration and split
-- to a tenth of a second, distance to a hundredth of a metre, RIR, resistance
-- and % FTP to a tenth. The validator refuses a finer value rather than letting
-- Postgres round it. rest_seconds is the rest the client actually took, recorded
-- by the React Native app's timer; the web harness never writes it.

ALTER TABLE set_logs
  ADD COLUMN IF NOT EXISTS rir NUMERIC(3,1)
    CHECK (rir IS NULL OR (rir >= 0 AND rir <= 10)),
  ADD COLUMN IF NOT EXISTS tempo TEXT
    CHECK (tempo IS NULL OR tempo ~ '^(?:\d{1,2}|X)-(?:\d{1,2}|X)-(?:\d{1,2}|X)-(?:\d{1,2}|X)$'),
  ADD COLUMN IF NOT EXISTS distance_meters NUMERIC(9,2)
    CHECK (distance_meters IS NULL OR (distance_meters >= 1 AND distance_meters <= 1000000)),
  ADD COLUMN IF NOT EXISTS duration_seconds NUMERIC(6,1)
    CHECK (duration_seconds IS NULL OR (duration_seconds >= 0.1 AND duration_seconds <= 86400)),
  ADD COLUMN IF NOT EXISTS pace_seconds_per_km INTEGER
    CHECK (pace_seconds_per_km IS NULL OR (pace_seconds_per_km >= 60 AND pace_seconds_per_km <= 3600)),
  ADD COLUMN IF NOT EXISTS split_seconds_per_500m NUMERIC(4,1)
    CHECK (split_seconds_per_500m IS NULL OR (split_seconds_per_500m >= 30 AND split_seconds_per_500m <= 600)),
  ADD COLUMN IF NOT EXISTS calories INTEGER
    CHECK (calories IS NULL OR (calories >= 1 AND calories <= 5000)),
  ADD COLUMN IF NOT EXISTS cadence INTEGER
    CHECK (cadence IS NULL OR (cadence >= 1 AND cadence <= 300)),
  ADD COLUMN IF NOT EXISTS stroke_rate INTEGER
    CHECK (stroke_rate IS NULL OR (stroke_rate >= 1 AND stroke_rate <= 150)),
  ADD COLUMN IF NOT EXISTS resistance NUMERIC(4,1)
    CHECK (resistance IS NULL OR (resistance >= 0 AND resistance <= 100)),
  ADD COLUMN IF NOT EXISTS heart_rate_zone INTEGER
    CHECK (heart_rate_zone IS NULL OR (heart_rate_zone >= 1 AND heart_rate_zone <= 5)),
  ADD COLUMN IF NOT EXISTS heart_rate INTEGER
    CHECK (heart_rate IS NULL OR (heart_rate >= 30 AND heart_rate <= 250)),
  ADD COLUMN IF NOT EXISTS power INTEGER
    CHECK (power IS NULL OR (power >= 1 AND power <= 3000)),
  ADD COLUMN IF NOT EXISTS ftp_percent NUMERIC(4,1)
    CHECK (ftp_percent IS NULL OR (ftp_percent >= 1 AND ftp_percent <= 300)),
  ADD COLUMN IF NOT EXISTS rest_seconds INTEGER
    CHECK (rest_seconds IS NULL OR (rest_seconds >= 0 AND rest_seconds <= 3600));

COMMENT ON TABLE set_logs IS
  'Per-set actuals for a logged exercise: every measure the coach can prescribe, as a real column in its canonical unit (utils/set-log-measures.ts). session_log -> exercise_log -> set_log.';
COMMENT ON COLUMN set_logs.rir IS 'Reps in reserve, 0-10, to a tenth.';
COMMENT ON COLUMN set_logs.tempo IS 'One compound value: four phases, seconds or X, like 3-1-X-0.';
COMMENT ON COLUMN set_logs.distance_meters IS 'Metres, always (CONVENTIONS section 20); typed and read in km or miles by the viewer''s units.';
COMMENT ON COLUMN set_logs.duration_seconds IS 'Seconds to a tenth; typed and read as h:mm:ss or m:ss.';
COMMENT ON COLUMN set_logs.pace_seconds_per_km IS 'Seconds per kilometre, whole; read per km or per mile by the viewer''s units. Stored as typed, never worked out from distance and duration.';
COMMENT ON COLUMN set_logs.split_seconds_per_500m IS 'Seconds per 500 m to a tenth, for everyone.';
COMMENT ON COLUMN set_logs.calories IS 'kcal, as the machine shows.';
COMMENT ON COLUMN set_logs.cadence IS 'Bike rpm or running steps per minute.';
COMMENT ON COLUMN set_logs.stroke_rate IS 'Strokes per minute (row, ski, swim).';
COMMENT ON COLUMN set_logs.resistance IS 'Damper or resistance level, 0-100, to a tenth.';
COMMENT ON COLUMN set_logs.heart_rate_zone IS 'Z1-Z5.';
COMMENT ON COLUMN set_logs.heart_rate IS 'Beats per minute.';
COMMENT ON COLUMN set_logs.power IS 'Watts.';
COMMENT ON COLUMN set_logs.ftp_percent IS 'Percent of FTP, to a tenth.';
COMMENT ON COLUMN set_logs.rest_seconds IS 'The rest the client took before the next set, from the React Native app''s timer; the web harness never asks.';
