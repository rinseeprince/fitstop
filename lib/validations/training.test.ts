import { describe, it, expect } from 'vitest'
import {
  planStatusSchema,
  exerciseSchema,
  updateTrainingPlanSchema,
  parseGetPlanResponse,
  logTrainingEventSchema,
  bulkExerciseInputSchema,
  overwriteSavedPlanSchema,
  inlinePlanBodySchema,
  createSavedPlanSchema,
  savedSessionInputSchema,
  replaceSessionSchema,
  createStandaloneSessionSchema,
  planEditSaveSchema,
  moveTrainingPlanSchema,
} from './training'
import { MAX_PRESCRIBED_ROWS } from '@/utils/set-spec-rows'
import { STRAIGHT_SETS, sessionExercises } from '@/utils/exercise-groups'

// A lone exercise on the wire: a straight-sets group of one.
const lone = <E>(exercise: E) => ({ ...STRAIGHT_SETS, exercises: [exercise] })

describe('Training Validation Schemas', () => {
  describe('planStatusSchema', () => {
    it('validates all plan statuses', () => {
      const validStatuses = ['active', 'archived', 'draft']

      validStatuses.forEach((status) => {
        const result = planStatusSchema.safeParse(status)
        expect(result.success).toBe(true)
      })
    })

    it('rejects invalid status', () => {
      const result = planStatusSchema.safeParse('pending')
      expect(result.success).toBe(false)
    })
  })

  describe('exerciseSchema', () => {
    it('validates a minimal exercise', () => {
      const data = {
        name: 'Bench Press',
        sets: 4,
      }

      const result = exerciseSchema.safeParse(data)
      expect(result.success).toBe(true)
    })

    it('validates a complete exercise', () => {
      const data = {
        name: 'Bench Press',
        sets: 4,
        repsMin: 8,
        repsMax: 12,
        repsTarget: '8-12',
        rpeTarget: 8,
        percentage1rm: 75,
        tempo: '3-1-1-0',
        restSeconds: 90,
        notes: 'Focus on chest contraction',
        isWarmup: false,
      }

      const result = exerciseSchema.safeParse(data)
      expect(result.success).toBe(true)
    })

    it('rejects exercise without name', () => {
      const data = { sets: 4 }
      const result = exerciseSchema.safeParse(data)
      expect(result.success).toBe(false)
    })

    it('rejects exercise without sets', () => {
      const data = { name: 'Bench Press' }
      const result = exerciseSchema.safeParse(data)
      expect(result.success).toBe(false)
    })

    it('rejects sets below 1', () => {
      const data = { name: 'Bench Press', sets: 0 }
      const result = exerciseSchema.safeParse(data)
      expect(result.success).toBe(false)
    })

    it('rejects sets above 20', () => {
      const data = { name: 'Bench Press', sets: 25 }
      const result = exerciseSchema.safeParse(data)
      expect(result.success).toBe(false)
    })

    it('accepts 0 reps (timed/AMRAP holds; no reps DB CHECK) but rejects negative', () => {
      expect(exerciseSchema.safeParse({ name: 'Plank', sets: 4, repsMin: 0 }).success).toBe(true)
      expect(exerciseSchema.safeParse({ name: 'Bench Press', sets: 4, repsMin: -1 }).success).toBe(false)
    })

    it('rejects reps above 100', () => {
      const data = { name: 'Bench Press', sets: 4, repsMax: 150 }
      const result = exerciseSchema.safeParse(data)
      expect(result.success).toBe(false)
    })

    it('rejects RPE below 1', () => {
      const data = { name: 'Bench Press', sets: 4, rpeTarget: 0 }
      const result = exerciseSchema.safeParse(data)
      expect(result.success).toBe(false)
    })

    it('rejects RPE above 10', () => {
      const data = { name: 'Bench Press', sets: 4, rpeTarget: 11 }
      const result = exerciseSchema.safeParse(data)
      expect(result.success).toBe(false)
    })

    it('rejects percentage1rm above 100', () => {
      const data = { name: 'Bench Press', sets: 4, percentage1rm: 110 }
      const result = exerciseSchema.safeParse(data)
      expect(result.success).toBe(false)
    })

    it('rejects rest above 600 seconds (10 minutes)', () => {
      const data = { name: 'Bench Press', sets: 4, restSeconds: 700 }
      const result = exerciseSchema.safeParse(data)
      expect(result.success).toBe(false)
    })

    it('defaults isWarmup to false', () => {
      const data = { name: 'Bench Press', sets: 4 }
      const result = exerciseSchema.safeParse(data)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.isWarmup).toBe(false)
      }
    })
  })

  describe('updateTrainingPlanSchema', () => {
    it('validates an empty update (all optional)', () => {
      const result = updateTrainingPlanSchema.safeParse({})
      expect(result.success).toBe(true)
    })

    it('validates a full update', () => {
      const data = {
        name: 'Updated Plan Name',
        description: 'New description',
        status: 'active',
        frequencyPerWeek: 5,
        programDurationWeeks: 8,
      }

      const result = updateTrainingPlanSchema.safeParse(data)
      expect(result.success).toBe(true)
    })

    it('rejects frequency below 1', () => {
      const data = { frequencyPerWeek: 0 }
      const result = updateTrainingPlanSchema.safeParse(data)
      expect(result.success).toBe(false)
    })

    it('rejects frequency above 7', () => {
      const data = { frequencyPerWeek: 8 }
      const result = updateTrainingPlanSchema.safeParse(data)
      expect(result.success).toBe(false)
    })

    it('rejects duration above 52 weeks', () => {
      const data = { programDurationWeeks: 60 }
      const result = updateTrainingPlanSchema.safeParse(data)
      expect(result.success).toBe(false)
    })
  })

  describe('API Response Parsers', () => {
    describe('parseGetPlanResponse', () => {
      // What every answer carries besides the plan: the hero reads the day the
      // client is on and the first day a program may start.
      const days = { nextPlan: null, clientToday: '2026-01-15', planStartFloor: '2026-01-15' }

      it('parses a successful response with plan', () => {
        const data = {
          success: true,
          plan: {
            id: '123',
            clientId: '456',
            coachId: '789',
            name: 'Test Plan',
            status: 'active',
            coachPrompt: 'Test prompt',
            splitType: 'push_pull_legs',
            frequencyPerWeek: 4,
            sessions: [],
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
          ...days,
        }

        const result = parseGetPlanResponse(data)
        expect(result).not.toBeNull()
        expect(result?.success).toBe(true)
      })

      it('parses a successful response with null plan', () => {
        const data = { success: true, plan: null, ...days }
        const result = parseGetPlanResponse(data)

        expect(result).not.toBeNull()
        expect(result?.success).toBe(true)
        expect(result?.plan).toBeNull()
      })

      it('returns null for invalid data', () => {
        const data = { invalid: 'data' }
        const result = parseGetPlanResponse(data)
        expect(result).toBeNull()
      })

      it('passes through the next program, the client\'s today, the floor and the timezone', () => {
        const data = {
          success: true,
          plan: null,
          nextPlan: { id: 'plan-2', name: 'Strength', effectiveFrom: '2026-01-26', effectiveUntil: '2026-02-08' },
          clientToday: '2026-01-15',
          planStartFloor: '2026-01-16',
          clientTimezone: 'Europe/London',
        }

        const result = parseGetPlanResponse(data)
        expect(result).not.toBeNull()
        expect(result?.nextPlan).toEqual({
          id: 'plan-2',
          name: 'Strength',
          effectiveFrom: '2026-01-26',
          effectiveUntil: '2026-02-08',
        })
        expect(result?.clientToday).toBe('2026-01-15')
        expect(result?.planStartFloor).toBe('2026-01-16')
        expect(result?.clientTimezone).toBe('Europe/London')
      })

      it('refuses a next program without its end', () => {
        expect(
          parseGetPlanResponse({
            success: true,
            plan: null,
            nextPlan: { id: 'plan-2', name: 'Strength', effectiveFrom: '2026-01-26' },
            clientToday: '2026-01-15',
            planStartFloor: '2026-01-15',
          })
        ).toBeNull()
      })

      it('refuses an answer without the days the hero reads', () => {
        expect(parseGetPlanResponse({ success: true, plan: null, nextPlan: null })).toBeNull()
        expect(
          parseGetPlanResponse({ success: true, plan: null, nextPlan: null, clientToday: '2026-01-15' })
        ).toBeNull()
      })
    })

  })

  describe('moveTrainingPlanSchema', () => {
    it('accepts a calendar date', () => {
      expect(moveTrainingPlanSchema.safeParse({ startsOn: '2026-09-23' }).success).toBe(true)
      expect(moveTrainingPlanSchema.safeParse({ startsOn: '2028-02-29' }).success).toBe(true)
    })

    it('refuses a date that is not on the calendar', () => {
      expect(moveTrainingPlanSchema.safeParse({ startsOn: '2026-02-31' }).success).toBe(false)
      expect(moveTrainingPlanSchema.safeParse({ startsOn: '2026-13-01' }).success).toBe(false)
      expect(moveTrainingPlanSchema.safeParse({ startsOn: '2027-02-29' }).success).toBe(false)
    })

    it('refuses anything but YYYY-MM-DD', () => {
      expect(moveTrainingPlanSchema.safeParse({ startsOn: '23/09/2026' }).success).toBe(false)
      expect(moveTrainingPlanSchema.safeParse({ startsOn: '2026-9-23' }).success).toBe(false)
      expect(moveTrainingPlanSchema.safeParse({ startsOn: '2026-09-23T00:00:00Z' }).success).toBe(false)
      expect(moveTrainingPlanSchema.safeParse({}).success).toBe(false)
    })
  })

  describe('logTrainingEventSchema', () => {
    it('accepts a quick log without notes', () => {
      const result = logTrainingEventSchema.safeParse({ completionQuality: 'full' })
      expect(result.success).toBe(true)
    })

    it('accepts a quick log with notes', () => {
      const result = logTrainingEventSchema.safeParse({
        completionQuality: 'partial',
        notes: 'Lower back tight, capped weights.',
      })
      expect(result.success).toBe(true)
    })

    it('accepts a detailed log with one logged exercise', () => {
      const result = logTrainingEventSchema.safeParse({
        completionQuality: 'full',
        exercises: [
          {
            trainingExerciseId: '00000000-0000-0000-0000-000000000001',
            exerciseName: 'Back Squat',
            sets: [{ setNumber: 1, reps: 5, weight: 140, rpe: 8 }],
            weightUnit: 'kg',
          },
        ],
      })
      expect(result.success).toBe(true)
    })

    it('accepts a detailed log with skipped:true and empty sets', () => {
      const result = logTrainingEventSchema.safeParse({
        completionQuality: 'partial',
        exercises: [
          {
            exerciseName: 'Romanian Deadlift',
            sets: [],
            weightUnit: 'lbs',
            skipped: true,
          },
        ],
      })
      expect(result.success).toBe(true)
    })

    it('accepts an unplanned exercise (no trainingExerciseId)', () => {
      const result = logTrainingEventSchema.safeParse({
        completionQuality: 'full',
        exercises: [
          {
            exerciseName: 'Walking Lunges',
            sets: [{ setNumber: 1, reps: 10, weight: 50 }],
            weightUnit: 'lbs',
          },
        ],
      })
      expect(result.success).toBe(true)
    })

    it('rejects when completionQuality is missing', () => {
      const result = logTrainingEventSchema.safeParse({})
      expect(result.success).toBe(false)
    })

    it('rejects an invalid completionQuality enum value', () => {
      const result = logTrainingEventSchema.safeParse({ completionQuality: 'almost' })
      expect(result.success).toBe(false)
    })

    it('rejects a detailed-log exercise missing exerciseName', () => {
      const result = logTrainingEventSchema.safeParse({
        completionQuality: 'full',
        exercises: [
          {
            trainingExerciseId: '00000000-0000-0000-0000-000000000001',
            sets: [{ setNumber: 1, reps: 5, weight: 100 }],
            weightUnit: 'lbs',
          },
        ],
      })
      expect(result.success).toBe(false)
    })

    it('rejects a non-skipped exercise with empty sets', () => {
      const result = logTrainingEventSchema.safeParse({
        completionQuality: 'full',
        exercises: [
          {
            exerciseName: 'Bench Press',
            sets: [],
            weightUnit: 'lbs',
          },
        ],
      })
      expect(result.success).toBe(false)
    })

    it('rejects an RPE outside 1-10', () => {
      const result = logTrainingEventSchema.safeParse({
        completionQuality: 'full',
        exercises: [
          {
            exerciseName: 'Bench Press',
            sets: [{ setNumber: 1, reps: 5, weight: 100, rpe: 11 }],
            weightUnit: 'lbs',
          },
        ],
      })
      expect(result.success).toBe(false)
    })

    it('rejects an invalid weightUnit value', () => {
      const result = logTrainingEventSchema.safeParse({
        completionQuality: 'full',
        exercises: [
          {
            exerciseName: 'Bench Press',
            sets: [{ setNumber: 1, reps: 5, weight: 100 }],
            weightUnit: 'stone',
          },
        ],
      })
      expect(result.success).toBe(false)
    })

    // setNumber is the set's IDENTITY — the server writes it straight into
    // set_logs.set_number and reads prescribedRows[setNumber - 1] to stamp the
    // coach-prescribed set_type. It is required precisely so a client cannot
    // send an anonymous set and have its position guessed.
    const oneSet = (set: unknown) => ({
      completionQuality: 'full' as const,
      exercises: [
        { exerciseName: 'Bench Press', sets: [set], weightUnit: 'kg' as const },
      ],
    })

    it('rejects a set with no setNumber', () => {
      expect(logTrainingEventSchema.safeParse(oneSet({ reps: 5 })).success).toBe(false)
    })

    it('rejects a setNumber below 1, fractional, or past the flattening ceiling', () => {
      expect(logTrainingEventSchema.safeParse(oneSet({ setNumber: 0 })).success).toBe(false)
      expect(logTrainingEventSchema.safeParse(oneSet({ setNumber: -1 })).success).toBe(false)
      expect(logTrainingEventSchema.safeParse(oneSet({ setNumber: 1.5 })).success).toBe(false)
      expect(
        logTrainingEventSchema.safeParse(oneSet({ setNumber: MAX_PRESCRIBED_ROWS + 1 })).success,
      ).toBe(false)
    })

    it('accepts a setNumber at the flattening ceiling', () => {
      expect(
        logTrainingEventSchema.safeParse(oneSet({ setNumber: MAX_PRESCRIBED_ROWS })).success,
      ).toBe(true)
    })

    // set_logs carries UNIQUE (exercise_log_id, set_number) (migration 090), so
    // a duplicate would surface to the client as a raw 23505 rendered as a 500.
    it('rejects duplicate setNumbers within one exercise', () => {
      const result = logTrainingEventSchema.safeParse({
        completionQuality: 'full',
        exercises: [
          {
            exerciseName: 'Bench Press',
            sets: [
              { setNumber: 2, reps: 5 },
              { setNumber: 2, reps: 6 },
            ],
            weightUnit: 'kg',
          },
        ],
      })
      expect(result.success).toBe(false)
    })

    // The constraint is per exercise_log, so two exercises may each have a set 1.
    it('accepts the same setNumber on two different exercises', () => {
      const result = logTrainingEventSchema.safeParse({
        completionQuality: 'full',
        exercises: [
          { exerciseName: 'Bench Press', sets: [{ setNumber: 1, reps: 5 }], weightUnit: 'kg' },
          { exerciseName: 'Row', sets: [{ setNumber: 1, reps: 8 }], weightUnit: 'kg' },
        ],
      })
      expect(result.success).toBe(true)
    })
  })

  describe('bulkExerciseInputSchema (PUT exercise item)', () => {
    const base = { name: 'Squat', sets: 5 }

    it('accepts a 0-rep exercise (reps floor relaxed to match authoring + absent DB CHECK)', () => {
      const r = bulkExerciseInputSchema.safeParse({ ...base, repsMin: 0, repsMax: 0 })
      expect(r.success).toBe(true)
    })

    it('rejects rpeTarget: 0 (training_exercises has CHECK rpe_target >= 1)', () => {
      const r = bulkExerciseInputSchema.safeParse({ ...base, rpeTarget: 0 })
      expect(r.success).toBe(false)
    })

    it('accepts rpeTarget within [1, 10]', () => {
      expect(bulkExerciseInputSchema.safeParse({ ...base, rpeTarget: 1 }).success).toBe(true)
      expect(bulkExerciseInputSchema.safeParse({ ...base, rpeTarget: 10 }).success).toBe(true)
    })

    it('bounds sets to the DB CHECK [1, 20] and carries no orderIndex, not even a negative one (a position is the array place)', () => {
      expect(bulkExerciseInputSchema.safeParse({ ...base, sets: 21 }).success).toBe(false)
      expect(bulkExerciseInputSchema.safeParse({ ...base, sets: 0 }).success).toBe(false)
      const r = bulkExerciseInputSchema.safeParse({ ...base, orderIndex: -1 })
      expect(r.success).toBe(true)
      if (r.success) {
        expect(r.data).not.toHaveProperty('orderIndex')
      }
    })

    it('carries setSpecs + videoUrl so an edit does not NULL per-set programming', () => {
      const r = bulkExerciseInputSchema.safeParse({
        ...base,
        videoUrl: 'https://x.test/v.mp4',
        setSpecs: [{ set_number: 1, set_type: 'working', reps_min: 8 }],
      })
      expect(r.success).toBe(true)
      if (r.success) {
        expect(r.data.videoUrl).toBe('https://x.test/v.mp4')
        expect(r.data.setSpecs?.length).toBe(1)
      }
    })

    it('rejects a non-http(s) videoUrl (L3 javascript: sink)', () => {
      expect(bulkExerciseInputSchema.safeParse({ ...base, videoUrl: 'javascript:alert(1)' }).success).toBe(false)
    })
  })

  describe('placement/create session + exercise caps (H5)', () => {
    const savedSession = { name: 'Day', orderIndex: 0, isRest: false, groups: [] }

    it('overwriteSavedPlanSchema bounds sessions to [1, 364]', () => {
      expect(overwriteSavedPlanSchema.safeParse({ sessions: Array(365).fill(savedSession) }).success).toBe(false)
      expect(overwriteSavedPlanSchema.safeParse({ sessions: [] }).success).toBe(false)
      expect(overwriteSavedPlanSchema.safeParse({ sessions: [savedSession] }).success).toBe(true)
    })

    it('inlinePlanBodySchema bounds sessions to [1, 364]', () => {
      expect(inlinePlanBodySchema.safeParse({ name: 'P', sessions: Array(365).fill(savedSession) }).success).toBe(false)
      expect(inlinePlanBodySchema.safeParse({ name: 'P', sessions: [] }).success).toBe(false)
    })

    it('createSavedPlanSchema caps sessions at 364 (the type:"plan" placement source)', () => {
      const s = { name: 'Day', groups: [] }
      expect(createSavedPlanSchema.safeParse({ name: 'P', sessions: Array(365).fill(s) }).success).toBe(false)
      expect(createSavedPlanSchema.safeParse({ name: 'P', sessions: [s] }).success).toBe(true)
    })

    it('savedSessionInputSchema caps exercises at 50 per session', () => {
      const ex = { name: 'E', sets: 3 }
      const mk = (n: number) => ({ name: 'Day', orderIndex: 0, isRest: false, groups: Array(n).fill(lone(ex)) })
      expect(savedSessionInputSchema.safeParse(mk(51)).success).toBe(false)
      expect(savedSessionInputSchema.safeParse(mk(50)).success).toBe(true)
    })
  })

  describe('replaceSessionSchema (placed-session full edit)', () => {
    const exercise = {
      name: 'Bench Press',
      sets: 3,
      setSpecs: [{ set_number: 1, set_type: 'working', reps_min: 5, reps_max: 8 }],
      videoUrl: 'https://example.com/bench.mp4',
    }
    const base = {
      name: 'Push Day',
      focus: 'Chest',
      estimatedDurationMinutes: 45,
      calorieSurplusPercentage: 15,
      notes: null,
      groups: [lone(exercise)],
    }

    it('accepts a full body and preserves per-set fields', () => {
      const result = replaceSessionSchema.safeParse(base)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(sessionExercises(result.data)[0].setSpecs).toEqual(exercise.setSpecs)
        expect(sessionExercises(result.data)[0].videoUrl).toBe(exercise.videoUrl)
      }
    })

    it('uses the authoring duration bounds (0..480), not legacy 10..180', () => {
      expect(replaceSessionSchema.safeParse({ ...base, estimatedDurationMinutes: 0 }).success).toBe(true)
      expect(replaceSessionSchema.safeParse({ ...base, estimatedDurationMinutes: 480 }).success).toBe(true)
      expect(replaceSessionSchema.safeParse({ ...base, estimatedDurationMinutes: 481 }).success).toBe(false)
    })

    it('requires a name and caps exercises at 50', () => {
      expect(replaceSessionSchema.safeParse({ ...base, name: '' }).success).toBe(false)
      expect(
        replaceSessionSchema.safeParse({ ...base, groups: Array(51).fill(lone(exercise)) }).success,
      ).toBe(false)
      expect(replaceSessionSchema.safeParse({ ...base, groups: [] }).success).toBe(true)
    })
  })

  describe('session groups (migration 178)', () => {
    // A superset/circuit group with every setting set. Zod strips any key its
    // schema does not know, so a setting that survives parsing is a known one.
    const CIRCUIT = {
      format: 'circuit',
      rounds: 3,
      timeCapSeconds: 600,
      intervalSeconds: 60,
      restBetweenExercisesSeconds: 15,
      restBetweenRoundsSeconds: 90,
      notes: 'A',
    }
    // Each exercise names its isWarmup (the PUT item defaults it), so a
    // parsed group is exactly the group sent.
    const squat = { name: 'Squat', sets: 3, isWarmup: false }
    const row = { name: 'Row', sets: 3, repsMin: 8, repsMax: 10, isWarmup: false }
    const bench = { name: 'Bench Press', sets: 4, restSeconds: 120, isWarmup: false }
    const circuitOf = (count: number) => ({
      ...CIRCUIT,
      exercises: Array.from({ length: count }, (_, i) => ({ name: `E${i + 1}`, sets: 3 })),
    })

    // Every session write schema asked the same question: parse a session
    // holding these groups, and hand back the groups it parsed — null when the
    // session is refused.
    const sessionSchemas: Array<[string, (groups: unknown) => unknown[] | null]> = [
      [
        'savedSessionInputSchema',
        (groups) => {
          const r = savedSessionInputSchema.safeParse({ name: 'Day', orderIndex: 0, isRest: false, groups })
          return r.success ? r.data.groups : null
        },
      ],
      [
        'replaceSessionSchema',
        (groups) => {
          const r = replaceSessionSchema.safeParse({ name: 'Day', groups })
          return r.success ? r.data.groups : null
        },
      ],
      [
        'createStandaloneSessionSchema',
        (groups) => {
          const r = createStandaloneSessionSchema.safeParse({ name: 'Day', groups })
          return r.success ? r.data.groups : null
        },
      ],
      [
        'planEditSaveSchema',
        (groups) => {
          const r = planEditSaveSchema.safeParse({
            sessions: Array.from({ length: 7 }, (_, i) => ({
              name: i === 0 ? 'Day' : 'Rest',
              orderIndex: i,
              weekIndex: 0,
              isRest: i !== 0,
              groups: i === 0 ? groups : [],
            })),
            plan: { name: 'Block A' },
            version: 'v1',
          })
          return r.success ? r.data.sessions[0].groups : null
        },
      ],
    ]

    describe.each(sessionSchemas)('%s', (_schema, parseGroups) => {
      it('accepts a circuit group beside a lone exercise and keeps every setting and exercise, in order', () => {
        const groups = [lone(bench), { ...CIRCUIT, exercises: [squat, row] }]

        expect(parseGroups(groups)).toStrictEqual(groups)
      })

      it('refuses a group with no exercises', () => {
        expect(parseGroups([{ ...CIRCUIT, exercises: [squat] }])).not.toBeNull()
        expect(parseGroups([{ ...CIRCUIT, exercises: [] }])).toBeNull()
      })

      it('refuses a group with an unknown format', () => {
        expect(parseGroups([{ ...CIRCUIT, format: 'tabata', exercises: [squat] }])).toBeNull()
      })

      it('refuses a group missing its format', () => {
        const { format: _format, ...noFormat } = CIRCUIT
        expect(parseGroups([{ ...noFormat, exercises: [squat] }])).toBeNull()
      })

      // Migration 178's CHECKs: the edge itself is accepted, one past it refused.
      it.each<[string, number, number]>([
        ['rounds', 1, 100],
        ['timeCapSeconds', 1, 14_400],
        ['intervalSeconds', 1, 3_600],
        ['restBetweenExercisesSeconds', 0, 3_600],
        ['restBetweenRoundsSeconds', 0, 3_600],
      ])('bounds %s to [%i, %i] at both edges', (setting, min, max) => {
        const withSetting = (value: number) =>
          parseGroups([{ ...CIRCUIT, [setting]: value, exercises: [squat] }])

        expect(withSetting(min)).not.toBeNull()
        expect(withSetting(min - 1)).toBeNull()
        expect(withSetting(max)).not.toBeNull()
        expect(withSetting(max + 1)).toBeNull()
      })

      it("caps a group's notes at 1000 characters", () => {
        const withNotes = (notes: string) => parseGroups([{ ...CIRCUIT, notes, exercises: [squat] }])

        expect(withNotes('x'.repeat(1000))).not.toBeNull()
        expect(withNotes('x'.repeat(1001))).toBeNull()
      })

      it('refuses more than 50 exercises across the groups, though no one group holds 50', () => {
        expect(parseGroups([circuitOf(25), circuitOf(25)])).not.toBeNull()
        expect(parseGroups([circuitOf(25), circuitOf(26)])).toBeNull()
      })
    })

    it("savedSessionInputSchema carries no exercise orderIndex or supersetGroup (a position is the array place), while the session keeps its own orderIndex", () => {
      const r = savedSessionInputSchema.safeParse({
        name: 'Day',
        orderIndex: 2,
        isRest: false,
        groups: [lone({ name: 'Squat', sets: 3, orderIndex: 4, supersetGroup: 'A' })],
      })

      expect(r.success).toBe(true)
      if (r.success) {
        expect(r.data.orderIndex).toBe(2)
        const [exercise] = sessionExercises(r.data)
        expect(exercise).not.toHaveProperty('orderIndex')
        expect(exercise).not.toHaveProperty('supersetGroup')
        expect(exercise).toStrictEqual({ name: 'Squat', sets: 3 })
      }
    })
  })
})
