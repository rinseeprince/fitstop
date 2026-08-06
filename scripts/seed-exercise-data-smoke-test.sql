-- =============================================================================
-- Seed data for Exercise Data subtab smoke testing (Session 1.9)
-- Client: ed5cb82c-30ea-488d-96d8-eb34e8ae09fa
--
-- Creates:
--   3 exercises in the catalog (Bench Press, Squat, Barbell Row)
--   15 session_logs spanning ~14 weeks
--   ~30 exercise_logs (2 exercises per session on average)
--   ~90 set_logs (3 sets per exercise)
--
-- Covers:
--   - Weight/e1RM/Volume progression across 12+ sessions (Bench, Squat)
--   - RPE data on some sets (Bench), none on others (Row) to test RPE empty state
--   - Prescribed snapshots on some exercises (Bench) for compliance testing
--   - No prescribed data on others (Row) for "No prescribed data" fallback
--   - PR-worthy sets (heavy singles/triples)
--   - A recent PR within 28 days for "New" badge
--
-- To undo: DELETE FROM session_logs WHERE client_id = 'ed5cb82c-30ea-488d-96d8-eb34e8ae09fa' AND training_session_id IS NULL;
--          DELETE FROM exercises WHERE id IN ('<the 3 UUIDs below>');
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Exercises catalog
-- ---------------------------------------------------------------------------

INSERT INTO exercises (id, coach_id, name, muscle_group, equipment, category)
VALUES
  ('aaaaaaaa-0001-4000-8000-000000000001', NULL, 'Bench Press (Test)', 'Chest', 'Barbell', 'Compound'),
  ('aaaaaaaa-0001-4000-8000-000000000002', NULL, 'Back Squat (Test)', 'Quads', 'Barbell', 'Compound'),
  ('aaaaaaaa-0001-4000-8000-000000000003', NULL, 'Barbell Row (Test)', 'Back', 'Barbell', 'Compound')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Session logs (15 sessions over ~14 weeks)
-- ---------------------------------------------------------------------------

INSERT INTO session_logs (id, client_id, training_session_id, completed_at, completion_quality, week_start_date, prescribed_session_snapshot)
VALUES
  -- Week 1-5: foundation phase
  ('bbbbbbbb-0001-4000-8000-000000000001', 'ed5cb82c-30ea-488d-96d8-eb34e8ae09fa', NULL, '2026-02-02 08:00:00+00', 'full',    '2026-02-02', '{"name": "Push Day", "focus": "Upper Body"}'),
  ('bbbbbbbb-0001-4000-8000-000000000002', 'ed5cb82c-30ea-488d-96d8-eb34e8ae09fa', NULL, '2026-02-09 08:00:00+00', 'full',    '2026-02-09', '{"name": "Leg Day",  "focus": "Lower Body"}'),
  ('bbbbbbbb-0001-4000-8000-000000000003', 'ed5cb82c-30ea-488d-96d8-eb34e8ae09fa', NULL, '2026-02-16 08:00:00+00', 'full',    '2026-02-16', '{"name": "Push Day", "focus": "Upper Body"}'),
  ('bbbbbbbb-0001-4000-8000-000000000004', 'ed5cb82c-30ea-488d-96d8-eb34e8ae09fa', NULL, '2026-02-23 08:00:00+00', 'partial', '2026-02-23', '{"name": "Leg Day",  "focus": "Lower Body"}'),
  ('bbbbbbbb-0001-4000-8000-000000000005', 'ed5cb82c-30ea-488d-96d8-eb34e8ae09fa', NULL, '2026-03-02 08:00:00+00', 'full',    '2026-03-02', '{"name": "Pull Day", "focus": "Upper Body"}'),
  -- Week 6-10: building phase
  ('bbbbbbbb-0001-4000-8000-000000000006', 'ed5cb82c-30ea-488d-96d8-eb34e8ae09fa', NULL, '2026-03-09 08:00:00+00', 'full',    '2026-03-09', '{"name": "Push Day", "focus": "Upper Body"}'),
  ('bbbbbbbb-0001-4000-8000-000000000007', 'ed5cb82c-30ea-488d-96d8-eb34e8ae09fa', NULL, '2026-03-16 08:00:00+00', 'full',    '2026-03-16', '{"name": "Leg Day",  "focus": "Lower Body"}'),
  ('bbbbbbbb-0001-4000-8000-000000000008', 'ed5cb82c-30ea-488d-96d8-eb34e8ae09fa', NULL, '2026-03-23 08:00:00+00', 'full',    '2026-03-23', '{"name": "Push Day", "focus": "Upper Body"}'),
  ('bbbbbbbb-0001-4000-8000-000000000009', 'ed5cb82c-30ea-488d-96d8-eb34e8ae09fa', NULL, '2026-03-30 08:00:00+00', 'full',    '2026-03-30', '{"name": "Pull Day", "focus": "Upper Body"}'),
  ('bbbbbbbb-0001-4000-8000-000000000010', 'ed5cb82c-30ea-488d-96d8-eb34e8ae09fa', NULL, '2026-04-06 08:00:00+00', 'full',    '2026-04-06', '{"name": "Leg Day",  "focus": "Lower Body"}'),
  -- Week 11-15: peak phase (recent sessions for "New" PR badge)
  ('bbbbbbbb-0001-4000-8000-000000000011', 'ed5cb82c-30ea-488d-96d8-eb34e8ae09fa', NULL, '2026-04-13 08:00:00+00', 'full',    '2026-04-13', '{"name": "Push Day", "focus": "Upper Body"}'),
  ('bbbbbbbb-0001-4000-8000-000000000012', 'ed5cb82c-30ea-488d-96d8-eb34e8ae09fa', NULL, '2026-04-20 08:00:00+00', 'full',    '2026-04-20', '{"name": "Leg Day",  "focus": "Lower Body"}'),
  ('bbbbbbbb-0001-4000-8000-000000000013', 'ed5cb82c-30ea-488d-96d8-eb34e8ae09fa', NULL, '2026-04-27 08:00:00+00', 'full',    '2026-04-27', '{"name": "Push Day", "focus": "Upper Body"}'),
  ('bbbbbbbb-0001-4000-8000-000000000014', 'ed5cb82c-30ea-488d-96d8-eb34e8ae09fa', NULL, '2026-05-01 08:00:00+00', 'full',    '2026-05-01', '{"name": "Pull Day", "focus": "Upper Body"}'),
  ('bbbbbbbb-0001-4000-8000-000000000015', 'ed5cb82c-30ea-488d-96d8-eb34e8ae09fa', NULL, '2026-05-05 08:00:00+00', 'full',    '2026-05-05', '{"name": "Leg Day",  "focus": "Lower Body"}');

-- ---------------------------------------------------------------------------
-- 3. Exercise logs
--    - Bench Press: 10 sessions, with prescribed snapshots + RPE
--    - Back Squat:  8 sessions, with prescribed snapshots, no RPE
--    - Barbell Row: 5 sessions, NO prescribed snapshot (tests compliance empty state), no RPE
-- ---------------------------------------------------------------------------

INSERT INTO exercise_logs (id, session_log_id, training_exercise_id, exercise_id, performed_name, completed, prescribed_exercise_snapshot)
VALUES
  -- Bench Press (10 entries across push days)
  ('cccccccc-0001-4000-8000-000000000001', 'bbbbbbbb-0001-4000-8000-000000000001', NULL, 'aaaaaaaa-0001-4000-8000-000000000001', 'Bench Press (Test)', TRUE, '{"name": "Bench Press", "sets": 3, "reps_min": 8, "reps_max": 12, "rpe_target": 7}'),
  ('cccccccc-0001-4000-8000-000000000002', 'bbbbbbbb-0001-4000-8000-000000000003', NULL, 'aaaaaaaa-0001-4000-8000-000000000001', 'Bench Press (Test)', TRUE, '{"name": "Bench Press", "sets": 3, "reps_min": 8, "reps_max": 12, "rpe_target": 7}'),
  ('cccccccc-0001-4000-8000-000000000003', 'bbbbbbbb-0001-4000-8000-000000000006', NULL, 'aaaaaaaa-0001-4000-8000-000000000001', 'Bench Press (Test)', TRUE, '{"name": "Bench Press", "sets": 3, "reps_min": 6, "reps_max": 10, "rpe_target": 8}'),
  ('cccccccc-0001-4000-8000-000000000004', 'bbbbbbbb-0001-4000-8000-000000000008', NULL, 'aaaaaaaa-0001-4000-8000-000000000001', 'Bench Press (Test)', TRUE, '{"name": "Bench Press", "sets": 3, "reps_min": 6, "reps_max": 10, "rpe_target": 8}'),
  ('cccccccc-0001-4000-8000-000000000005', 'bbbbbbbb-0001-4000-8000-000000000011', NULL, 'aaaaaaaa-0001-4000-8000-000000000001', 'Bench Press (Test)', TRUE, '{"name": "Bench Press", "sets": 4, "reps_min": 4, "reps_max": 6,  "rpe_target": 8.5}'),
  ('cccccccc-0001-4000-8000-000000000006', 'bbbbbbbb-0001-4000-8000-000000000013', NULL, 'aaaaaaaa-0001-4000-8000-000000000001', 'Bench Press (Test)', TRUE, '{"name": "Bench Press", "sets": 4, "reps_min": 4, "reps_max": 6,  "rpe_target": 9}'),
  -- Extra bench sessions for volume
  ('cccccccc-0001-4000-8000-000000000007', 'bbbbbbbb-0001-4000-8000-000000000005', NULL, 'aaaaaaaa-0001-4000-8000-000000000001', 'Bench Press (Test)', TRUE, '{"name": "Bench Press", "sets": 3, "reps_min": 8, "reps_max": 12, "rpe_target": 7}'),
  ('cccccccc-0001-4000-8000-000000000008', 'bbbbbbbb-0001-4000-8000-000000000009', NULL, 'aaaaaaaa-0001-4000-8000-000000000001', 'Bench Press (Test)', TRUE, '{"name": "Bench Press", "sets": 3, "reps_min": 6, "reps_max": 10, "rpe_target": 8}'),
  ('cccccccc-0001-4000-8000-000000000009', 'bbbbbbbb-0001-4000-8000-000000000014', NULL, 'aaaaaaaa-0001-4000-8000-000000000001', 'Bench Press (Test)', TRUE, '{"name": "Bench Press", "sets": 4, "reps_min": 3, "reps_max": 5,  "rpe_target": 9}'),
  ('cccccccc-0001-4000-8000-000000000010', 'bbbbbbbb-0001-4000-8000-000000000015', NULL, 'aaaaaaaa-0001-4000-8000-000000000001', 'Bench Press (Test)', TRUE, '{"name": "Bench Press", "sets": 4, "reps_min": 1, "reps_max": 3,  "rpe_target": 9.5}'),

  -- Back Squat (8 entries across leg days)
  ('cccccccc-0001-4000-8000-000000000011', 'bbbbbbbb-0001-4000-8000-000000000002', NULL, 'aaaaaaaa-0001-4000-8000-000000000002', 'Back Squat (Test)',  TRUE, '{"name": "Back Squat", "sets": 3, "reps_min": 8, "reps_max": 12}'),
  ('cccccccc-0001-4000-8000-000000000012', 'bbbbbbbb-0001-4000-8000-000000000004', NULL, 'aaaaaaaa-0001-4000-8000-000000000002', 'Back Squat (Test)',  TRUE, '{"name": "Back Squat", "sets": 3, "reps_min": 8, "reps_max": 12}'),
  ('cccccccc-0001-4000-8000-000000000013', 'bbbbbbbb-0001-4000-8000-000000000007', NULL, 'aaaaaaaa-0001-4000-8000-000000000002', 'Back Squat (Test)',  TRUE, '{"name": "Back Squat", "sets": 3, "reps_min": 6, "reps_max": 10}'),
  ('cccccccc-0001-4000-8000-000000000014', 'bbbbbbbb-0001-4000-8000-000000000010', NULL, 'aaaaaaaa-0001-4000-8000-000000000002', 'Back Squat (Test)',  TRUE, '{"name": "Back Squat", "sets": 4, "reps_min": 4, "reps_max": 8}'),
  ('cccccccc-0001-4000-8000-000000000015', 'bbbbbbbb-0001-4000-8000-000000000012', NULL, 'aaaaaaaa-0001-4000-8000-000000000002', 'Back Squat (Test)',  TRUE, '{"name": "Back Squat", "sets": 4, "reps_min": 4, "reps_max": 6}'),
  ('cccccccc-0001-4000-8000-000000000016', 'bbbbbbbb-0001-4000-8000-000000000015', NULL, 'aaaaaaaa-0001-4000-8000-000000000002', 'Back Squat (Test)',  TRUE, '{"name": "Back Squat", "sets": 4, "reps_min": 1, "reps_max": 3}'),
  ('cccccccc-0001-4000-8000-000000000017', 'bbbbbbbb-0001-4000-8000-000000000005', NULL, 'aaaaaaaa-0001-4000-8000-000000000002', 'Back Squat (Test)',  TRUE, '{"name": "Back Squat", "sets": 3, "reps_min": 8, "reps_max": 12}'),
  ('cccccccc-0001-4000-8000-000000000018', 'bbbbbbbb-0001-4000-8000-000000000014', NULL, 'aaaaaaaa-0001-4000-8000-000000000002', 'Back Squat (Test)',  TRUE, '{"name": "Back Squat", "sets": 4, "reps_min": 3, "reps_max": 5}'),

  -- Barbell Row (5 entries, NO prescribed snapshot = tests "No prescribed data" in compliance)
  ('cccccccc-0001-4000-8000-000000000019', 'bbbbbbbb-0001-4000-8000-000000000005', NULL, 'aaaaaaaa-0001-4000-8000-000000000003', 'Barbell Row (Test)', TRUE, NULL),
  ('cccccccc-0001-4000-8000-000000000020', 'bbbbbbbb-0001-4000-8000-000000000009', NULL, 'aaaaaaaa-0001-4000-8000-000000000003', 'Barbell Row (Test)', TRUE, NULL),
  ('cccccccc-0001-4000-8000-000000000021', 'bbbbbbbb-0001-4000-8000-000000000011', NULL, 'aaaaaaaa-0001-4000-8000-000000000003', 'Barbell Row (Test)', TRUE, NULL),
  ('cccccccc-0001-4000-8000-000000000022', 'bbbbbbbb-0001-4000-8000-000000000013', NULL, 'aaaaaaaa-0001-4000-8000-000000000003', 'Barbell Row (Test)', TRUE, NULL),
  ('cccccccc-0001-4000-8000-000000000023', 'bbbbbbbb-0001-4000-8000-000000000014', NULL, 'aaaaaaaa-0001-4000-8000-000000000003', 'Barbell Row (Test)', TRUE, NULL);

-- ---------------------------------------------------------------------------
-- 4. Set logs
--    Bench Press: progressive overload 60kg -> 100kg, with RPE
--    Back Squat:  progressive overload 80kg -> 140kg, no RPE
--    Barbell Row: steady 60-70kg, no RPE (tests RPE empty state)
-- ---------------------------------------------------------------------------

INSERT INTO set_logs (exercise_log_id, set_number, reps, weight, rpe)
VALUES
  -- === BENCH PRESS (10 sessions x 3-4 sets, with RPE) ===

  -- Session 1 (Feb 2): 60kg x 12,10,8 @ RPE 6,6.5,7
  ('cccccccc-0001-4000-8000-000000000001', 1, 12, 60,  6),
  ('cccccccc-0001-4000-8000-000000000001', 2, 10, 60,  6.5),
  ('cccccccc-0001-4000-8000-000000000001', 3, 8,  60,  7),

  -- Session 2 (Feb 16): 62.5kg x 10,9,8 @ RPE 6.5,7,7.5
  ('cccccccc-0001-4000-8000-000000000002', 1, 10, 62.5, 6.5),
  ('cccccccc-0001-4000-8000-000000000002', 2, 9,  62.5, 7),
  ('cccccccc-0001-4000-8000-000000000002', 3, 8,  62.5, 7.5),

  -- Session 3 (Mar 2): 65kg x 10,8,8 @ RPE 7,7,7.5
  ('cccccccc-0001-4000-8000-000000000007', 1, 10, 65,  7),
  ('cccccccc-0001-4000-8000-000000000007', 2, 8,  65,  7),
  ('cccccccc-0001-4000-8000-000000000007', 3, 8,  65,  7.5),

  -- Session 4 (Mar 9): 70kg x 8,7,6 @ RPE 7.5,8,8
  ('cccccccc-0001-4000-8000-000000000003', 1, 8,  70,  7.5),
  ('cccccccc-0001-4000-8000-000000000003', 2, 7,  70,  8),
  ('cccccccc-0001-4000-8000-000000000003', 3, 6,  70,  8),

  -- Session 5 (Mar 23): 75kg x 8,6,6 @ RPE 8,8,8.5
  ('cccccccc-0001-4000-8000-000000000004', 1, 8,  75,  8),
  ('cccccccc-0001-4000-8000-000000000004', 2, 6,  75,  8),
  ('cccccccc-0001-4000-8000-000000000004', 3, 6,  75,  8.5),

  -- Session 6 (Mar 30): 77.5kg x 7,6,5 @ RPE 8,8.5,8.5
  ('cccccccc-0001-4000-8000-000000000008', 1, 7,  77.5, 8),
  ('cccccccc-0001-4000-8000-000000000008', 2, 6,  77.5, 8.5),
  ('cccccccc-0001-4000-8000-000000000008', 3, 5,  77.5, 8.5),

  -- Session 7 (Apr 13): 80kg x 6,5,5 @ RPE 8,8.5,9
  ('cccccccc-0001-4000-8000-000000000005', 1, 6,  80,  8),
  ('cccccccc-0001-4000-8000-000000000005', 2, 5,  80,  8.5),
  ('cccccccc-0001-4000-8000-000000000005', 3, 5,  80,  9),
  ('cccccccc-0001-4000-8000-000000000005', 4, 4,  82.5, 9),

  -- Session 8 (Apr 27): 85kg x 5,4,4 @ RPE 8.5,9,9
  ('cccccccc-0001-4000-8000-000000000006', 1, 5,  85,  8.5),
  ('cccccccc-0001-4000-8000-000000000006', 2, 4,  85,  9),
  ('cccccccc-0001-4000-8000-000000000006', 3, 4,  85,  9),
  ('cccccccc-0001-4000-8000-000000000006', 4, 3,  90,  9.5),

  -- Session 9 (May 1): 90kg x 3,3,2 @ RPE 9,9,9.5  + heavy single 95kg
  ('cccccccc-0001-4000-8000-000000000009', 1, 3,  90,  9),
  ('cccccccc-0001-4000-8000-000000000009', 2, 3,  90,  9),
  ('cccccccc-0001-4000-8000-000000000009', 3, 2,  90,  9.5),
  ('cccccccc-0001-4000-8000-000000000009', 4, 1,  95,  9.5),

  -- Session 10 (May 5): NEW PR session! 100kg x 1, 92.5kg x 3  @ RPE 10,9.5
  ('cccccccc-0001-4000-8000-000000000010', 1, 5,  80,  8),
  ('cccccccc-0001-4000-8000-000000000010', 2, 3,  92.5, 9.5),
  ('cccccccc-0001-4000-8000-000000000010', 3, 1,  100, 10),
  ('cccccccc-0001-4000-8000-000000000010', 4, 1,  95,  9.5),

  -- === BACK SQUAT (8 sessions x 3-4 sets, NO RPE) ===

  -- Session 1 (Feb 9): 80kg x 12,10,10
  ('cccccccc-0001-4000-8000-000000000011', 1, 12, 80,  NULL),
  ('cccccccc-0001-4000-8000-000000000011', 2, 10, 80,  NULL),
  ('cccccccc-0001-4000-8000-000000000011', 3, 10, 80,  NULL),

  -- Session 2 (Feb 23): 85kg x 10,8,8 (partial session)
  ('cccccccc-0001-4000-8000-000000000012', 1, 10, 85,  NULL),
  ('cccccccc-0001-4000-8000-000000000012', 2, 8,  85,  NULL),

  -- Session 3 (Mar 2): 85kg x 10,10,8
  ('cccccccc-0001-4000-8000-000000000017', 1, 10, 85,  NULL),
  ('cccccccc-0001-4000-8000-000000000017', 2, 10, 85,  NULL),
  ('cccccccc-0001-4000-8000-000000000017', 3, 8,  85,  NULL),

  -- Session 4 (Mar 16): 95kg x 8,8,6
  ('cccccccc-0001-4000-8000-000000000013', 1, 8,  95,  NULL),
  ('cccccccc-0001-4000-8000-000000000013', 2, 8,  95,  NULL),
  ('cccccccc-0001-4000-8000-000000000013', 3, 6,  95,  NULL),

  -- Session 5 (Apr 6): 105kg x 6,6,5
  ('cccccccc-0001-4000-8000-000000000014', 1, 6,  105, NULL),
  ('cccccccc-0001-4000-8000-000000000014', 2, 6,  105, NULL),
  ('cccccccc-0001-4000-8000-000000000014', 3, 5,  105, NULL),
  ('cccccccc-0001-4000-8000-000000000014', 4, 4,  110, NULL),

  -- Session 6 (Apr 20): 115kg x 5,4,4
  ('cccccccc-0001-4000-8000-000000000015', 1, 5,  115, NULL),
  ('cccccccc-0001-4000-8000-000000000015', 2, 4,  115, NULL),
  ('cccccccc-0001-4000-8000-000000000015', 3, 4,  115, NULL),
  ('cccccccc-0001-4000-8000-000000000015', 4, 3,  120, NULL),

  -- Session 7 (May 1): 125kg x 3,3,2
  ('cccccccc-0001-4000-8000-000000000018', 1, 3,  125, NULL),
  ('cccccccc-0001-4000-8000-000000000018', 2, 3,  125, NULL),
  ('cccccccc-0001-4000-8000-000000000018', 3, 2,  125, NULL),
  ('cccccccc-0001-4000-8000-000000000018', 4, 1,  135, NULL),

  -- Session 8 (May 5): NEW PR! 140kg x 1, 130kg x 3
  ('cccccccc-0001-4000-8000-000000000016', 1, 5,  110, NULL),
  ('cccccccc-0001-4000-8000-000000000016', 2, 3,  130, NULL),
  ('cccccccc-0001-4000-8000-000000000016', 3, 1,  140, NULL),
  ('cccccccc-0001-4000-8000-000000000016', 4, 1,  135, NULL),

  -- === BARBELL ROW (5 sessions x 3 sets, NO RPE => tests RPE empty state) ===

  -- Session 1 (Mar 2): 60kg x 10,10,8
  ('cccccccc-0001-4000-8000-000000000019', 1, 10, 60,  NULL),
  ('cccccccc-0001-4000-8000-000000000019', 2, 10, 60,  NULL),
  ('cccccccc-0001-4000-8000-000000000019', 3, 8,  60,  NULL),

  -- Session 2 (Mar 30): 62.5kg x 10,8,8
  ('cccccccc-0001-4000-8000-000000000020', 1, 10, 62.5, NULL),
  ('cccccccc-0001-4000-8000-000000000020', 2, 8,  62.5, NULL),
  ('cccccccc-0001-4000-8000-000000000020', 3, 8,  62.5, NULL),

  -- Session 3 (Apr 13): 65kg x 10,8,7
  ('cccccccc-0001-4000-8000-000000000021', 1, 10, 65,  NULL),
  ('cccccccc-0001-4000-8000-000000000021', 2, 8,  65,  NULL),
  ('cccccccc-0001-4000-8000-000000000021', 3, 7,  65,  NULL),

  -- Session 4 (Apr 27): 67.5kg x 8,8,6
  ('cccccccc-0001-4000-8000-000000000022', 1, 8,  67.5, NULL),
  ('cccccccc-0001-4000-8000-000000000022', 2, 8,  67.5, NULL),
  ('cccccccc-0001-4000-8000-000000000022', 3, 6,  67.5, NULL),

  -- Session 5 (May 1): 70kg x 8,7,6
  ('cccccccc-0001-4000-8000-000000000023', 1, 8,  70,  NULL),
  ('cccccccc-0001-4000-8000-000000000023', 2, 7,  70,  NULL),
  ('cccccccc-0001-4000-8000-000000000023', 3, 6,  70,  NULL);

COMMIT;

-- =============================================================================
-- What this covers for smoke testing:
--
-- Bench Press (Test) - 10 sessions:
--   Weight:     60 -> 100 kg (clear upward trend on AreaChart)
--   e1RM:       ~80 -> ~100 (computed from top sets)
--   Volume:     varies (tests BarChart)
--   RPE:        6 -> 10 (visible trend)
--   Compliance: prescribed 3-4 sets, actual 3-4 (tests grouped bars + summary)
--   PRs:        1RM=100, 3RM=92.5, 5RM=85 (May 5 has "New" badge)
--
-- Back Squat (Test) - 8 sessions:
--   Same progression, but NO RPE => RPE view shows "No RPE data recorded"
--   PRs: 1RM=140, 3RM=130, 5RM=115 (recent "New" badges)
--
-- Barbell Row (Test) - 5 sessions:
--   Steady progression 60-70 kg
--   NO prescribed snapshot => Compliance shows "No prescribed data available"
--   NO RPE => RPE empty state
--   Fewer sessions (tests session-count picker behavior with limited data)
-- =============================================================================
