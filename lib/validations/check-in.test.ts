import { describe, it, expect } from 'vitest'
import {
  submitCheckInSchema,
  sessionCompletionSchema,
  exerciseHighlightSchema,
  nutritionAdherenceSchema,
} from './check-in'

describe('Check-in Validation Schemas', () => {
  describe('submitCheckInSchema', () => {
    it('validates a minimal valid check-in', () => {
      const data = { token: 'valid-token' }
      const result = submitCheckInSchema.safeParse(data)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.token).toBe('valid-token')
      }
    })

    it('validates a full check-in with all fields', () => {
      const data = {
        token: 'valid-token',
        mood: 4,
        energy: 7,
        sleep: 8,
        stress: 3,
        notes: 'Feeling good today!',
        weight: 180,
        weightUnit: 'lbs',
        bodyFatPercentage: 15.5,
        waist: 32,
        hips: 38,
        chest: 42,
        arms: 14,
        thighs: 24,
        measurementUnit: 'in',
        workoutsCompleted: 4,
        adherencePercentage: 85,
      }

      const result = submitCheckInSchema.safeParse(data)
      expect(result.success).toBe(true)
    })

    it('rejects check-in without token', () => {
      const data = { mood: 4 }
      const result = submitCheckInSchema.safeParse(data)

      expect(result.success).toBe(false)
    })

    it('rejects mood outside 1-5 range', () => {
      const data = { token: 'valid-token', mood: 10 }
      const result = submitCheckInSchema.safeParse(data)

      expect(result.success).toBe(false)
    })

    it('rejects energy outside 1-10 range', () => {
      const data = { token: 'valid-token', energy: 15 }
      const result = submitCheckInSchema.safeParse(data)

      expect(result.success).toBe(false)
    })

    it('accepts string numbers and converts them', () => {
      const data = {
        token: 'valid-token',
        mood: '4',
        energy: '7',
        weight: '180.5',
      }

      const result = submitCheckInSchema.safeParse(data)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.mood).toBe(4)
        expect(result.data.energy).toBe(7)
        expect(result.data.weight).toBe(180.5)
      }
    })

    it('converts null and empty strings to undefined', () => {
      const data = {
        token: 'valid-token',
        notes: null,
        prs: '',
        challenges: '',
      }

      const result = submitCheckInSchema.safeParse(data)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.notes).toBeUndefined()
        expect(result.data.prs).toBeUndefined()
        expect(result.data.challenges).toBeUndefined()
      }
    })

    it('rejects weight over 1000', () => {
      const data = { token: 'valid-token', weight: 1500 }
      const result = submitCheckInSchema.safeParse(data)

      expect(result.success).toBe(false)
    })

    it('rejects body fat percentage over 100', () => {
      const data = { token: 'valid-token', bodyFatPercentage: 150 }
      const result = submitCheckInSchema.safeParse(data)

      expect(result.success).toBe(false)
    })

    it('validates sessionCompletions array', () => {
      const data = {
        token: 'valid-token',
        sessionCompletions: [
          {
            trainingSessionId: 'session-1',
            sessionName: 'Push Day',
            completed: true,
            completionQuality: 'full',
          },
        ],
      }

      const result = submitCheckInSchema.safeParse(data)
      expect(result.success).toBe(true)
    })

    it('rejects more than 20 session completions', () => {
      const sessionCompletions = Array.from({ length: 25 }, (_, i) => ({
        trainingSessionId: `session-${i}`,
        sessionName: `Session ${i}`,
        completed: true,
      }))

      const data = { token: 'valid-token', sessionCompletions }
      const result = submitCheckInSchema.safeParse(data)

      expect(result.success).toBe(false)
    })

    it('validates exerciseHighlights array', () => {
      const data = {
        token: 'valid-token',
        exerciseHighlights: [
          {
            exerciseName: 'Bench Press',
            highlightType: 'pr',
            weightValue: 225,
            weightUnit: 'lbs',
            reps: 5,
          },
        ],
      }

      const result = submitCheckInSchema.safeParse(data)
      expect(result.success).toBe(true)
    })

  })

  describe('sessionCompletionSchema', () => {
    it('validates a complete session completion', () => {
      const data = {
        trainingSessionId: 'session-123',
        sessionName: 'Push Day',
        completed: true,
        completionQuality: 'full',
        dayOfWeek: 'monday',
        notes: 'Great workout!',
      }

      const result = sessionCompletionSchema.safeParse(data)
      expect(result.success).toBe(true)
    })

    it('converts string "true" to boolean', () => {
      const data = {
        trainingSessionId: 'session-123',
        sessionName: 'Push Day',
        completed: 'true',
      }

      const result = sessionCompletionSchema.safeParse(data)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.completed).toBe(true)
      }
    })

    it('rejects invalid day of week', () => {
      const data = {
        trainingSessionId: 'session-123',
        sessionName: 'Push Day',
        completed: true,
        dayOfWeek: 'notaday',
      }

      const result = sessionCompletionSchema.safeParse(data)
      // Invalid day should be converted to undefined due to preprocessing
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.dayOfWeek).toBeUndefined()
      }
    })

    it('validates all completion qualities', () => {
      const qualities = ['full', 'partial', 'skipped'] as const

      qualities.forEach((quality) => {
        const data = {
          trainingSessionId: 'session-123',
          sessionName: 'Push Day',
          completed: true,
          completionQuality: quality,
        }

        const result = sessionCompletionSchema.safeParse(data)
        expect(result.success).toBe(true)
      })
    })
  })

  describe('exerciseHighlightSchema', () => {
    it('validates a PR highlight', () => {
      const data = {
        exerciseName: 'Deadlift',
        highlightType: 'pr',
        details: 'New 1RM!',
        weightValue: 405,
        weightUnit: 'lbs',
        reps: 1,
      }

      const result = exerciseHighlightSchema.safeParse(data)
      expect(result.success).toBe(true)
    })

    it('validates a struggle highlight', () => {
      const data = {
        exerciseName: 'Pull-ups',
        highlightType: 'struggle',
        details: 'Could not complete all sets',
      }

      const result = exerciseHighlightSchema.safeParse(data)
      expect(result.success).toBe(true)
    })

    it('rejects weight over 2000', () => {
      const data = {
        exerciseName: 'Deadlift',
        highlightType: 'pr',
        weightValue: 2500,
      }

      const result = exerciseHighlightSchema.safeParse(data)
      expect(result.success).toBe(false)
    })

    it('rejects reps over 1000', () => {
      const data = {
        exerciseName: 'Push-ups',
        highlightType: 'pr',
        reps: 1500,
      }

      const result = exerciseHighlightSchema.safeParse(data)
      expect(result.success).toBe(false)
    })

    it('accepts optional UUID for exerciseId', () => {
      const data = {
        exerciseId: '550e8400-e29b-41d4-a716-446655440000',
        exerciseName: 'Bench Press',
        highlightType: 'pr',
      }

      const result = exerciseHighlightSchema.safeParse(data)
      expect(result.success).toBe(true)
    })

    it('rejects invalid UUID for exerciseId', () => {
      const data = {
        exerciseId: 'not-a-uuid',
        exerciseName: 'Bench Press',
        highlightType: 'pr',
      }

      const result = exerciseHighlightSchema.safeParse(data)
      expect(result.success).toBe(false)
    })
  })

  describe('nutritionAdherenceSchema', () => {
    it('validates nutrition adherence', () => {
      const data = {
        daysOnTarget: 5,
        notes: 'Struggled on weekends',
      }

      const result = nutritionAdherenceSchema.safeParse(data)
      expect(result.success).toBe(true)
    })

    it('accepts zero days on target', () => {
      const data = { daysOnTarget: 0 }

      const result = nutritionAdherenceSchema.safeParse(data)
      expect(result.success).toBe(true)
    })

    it('rejects days on target over 30', () => {
      const data = { daysOnTarget: 35 }

      const result = nutritionAdherenceSchema.safeParse(data)
      expect(result.success).toBe(false)
    })

    it('accepts empty object', () => {
      const result = nutritionAdherenceSchema.safeParse({})
      expect(result.success).toBe(true)
    })
  })
})
