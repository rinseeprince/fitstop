import { describe, it, expect } from 'vitest'
import {
  planStatusSchema,
  dayOfWeekSchema,
  exerciseSchema,
  sessionSchema,
  updateTrainingPlanSchema,
  parseGetPlanResponse,
  logTrainingEventSchema,
} from './training'

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

  describe('dayOfWeekSchema', () => {
    it('validates all days of the week', () => {
      const days = [
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
      ]

      days.forEach((day) => {
        const result = dayOfWeekSchema.safeParse(day)
        expect(result.success).toBe(true)
      })
    })

    it('rejects invalid day', () => {
      const result = dayOfWeekSchema.safeParse('funday')
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
        supersetGroup: 'A',
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

    it('rejects reps below 1', () => {
      const data = { name: 'Bench Press', sets: 4, repsMin: 0 }
      const result = exerciseSchema.safeParse(data)
      expect(result.success).toBe(false)
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

  describe('sessionSchema', () => {
    it('validates a minimal session', () => {
      const data = { name: 'Push Day' }
      const result = sessionSchema.safeParse(data)
      expect(result.success).toBe(true)
    })

    it('validates a complete session', () => {
      const data = {
        name: 'Push Day A',
        dayOfWeek: 'monday',
        orderIndex: 0,
        focus: 'Chest, Shoulders, Triceps',
        notes: 'Start with compound movements',
        estimatedDurationMinutes: 60,
      }

      const result = sessionSchema.safeParse(data)
      expect(result.success).toBe(true)
    })

    it('rejects session without name', () => {
      const data = { dayOfWeek: 'monday' }
      const result = sessionSchema.safeParse(data)
      expect(result.success).toBe(false)
    })

    it('rejects session name over 100 characters', () => {
      const data = { name: 'A'.repeat(101) }
      const result = sessionSchema.safeParse(data)
      expect(result.success).toBe(false)
    })

    it('rejects duration under 10 minutes', () => {
      const data = { name: 'Quick Session', estimatedDurationMinutes: 5 }
      const result = sessionSchema.safeParse(data)
      expect(result.success).toBe(false)
    })

    it('rejects duration over 180 minutes (3 hours)', () => {
      const data = { name: 'Marathon Session', estimatedDurationMinutes: 200 }
      const result = sessionSchema.safeParse(data)
      expect(result.success).toBe(false)
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
        }

        const result = parseGetPlanResponse(data)
        expect(result).not.toBeNull()
        expect(result?.success).toBe(true)
      })

      it('parses a successful response with null plan', () => {
        const data = { success: true, plan: null }
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

      it('passes through scheduledFor and clientTimezone', () => {
        const data = {
          success: true,
          plan: {
            id: '123',
            clientId: '456',
            coachId: '789',
            name: 'Scheduled Plan',
            status: 'planned',
            coachPrompt: 'Test prompt',
            splitType: 'push_pull_legs',
            frequencyPerWeek: 4,
            sessions: [],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
          upcomingPlan: null,
          scheduledFor: '2026-01-19',
          clientTimezone: 'Europe/London',
        }

        const result = parseGetPlanResponse(data)
        expect(result).not.toBeNull()
        expect(result?.scheduledFor).toBe('2026-01-19')
        expect(result?.clientTimezone).toBe('Europe/London')
      })
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
            sets: [{ reps: 5, weight: 140, rpe: 8 }],
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
            sets: [{ reps: 10, weight: 50 }],
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
            sets: [{ reps: 5, weight: 100 }],
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
            sets: [{ reps: 5, weight: 100, rpe: 11 }],
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
            sets: [{ reps: 5, weight: 100 }],
            weightUnit: 'stone',
          },
        ],
      })
      expect(result.success).toBe(false)
    })
  })
})
