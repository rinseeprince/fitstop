import { describe, it, expect } from 'vitest'
import {
  splitTypeSchema,
  planStatusSchema,
  dayOfWeekSchema,
  exerciseSchema,
  sessionSchema,
  generateTrainingPlanSchema,
  updateTrainingPlanSchema,
  reorderSessionsSchema,
  validateClientForTraining,
  parseGetPlanResponse,
  parseGeneratePlanResponse,
  parseSuggestionsResponse,
} from './training'

describe('Training Validation Schemas', () => {
  describe('splitTypeSchema', () => {
    it('validates all split types', () => {
      const validSplits = [
        'push_pull_legs',
        'upper_lower',
        'full_body',
        'bro_split',
        'push_pull',
        'custom',
      ]

      validSplits.forEach((split) => {
        const result = splitTypeSchema.safeParse(split)
        expect(result.success).toBe(true)
      })
    })

    it('rejects invalid split type', () => {
      const result = splitTypeSchema.safeParse('invalid_split')
      expect(result.success).toBe(false)
    })
  })

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

  describe('generateTrainingPlanSchema', () => {
    it('validates a minimal generation request', () => {
      const data = {
        coachPrompt: 'Create a push pull legs program',
      }

      const result = generateTrainingPlanSchema.safeParse(data)
      expect(result.success).toBe(true)
    })

    it('validates with pre-generation activities', () => {
      const data = {
        coachPrompt: 'Create a training plan around existing activities',
        preGenerationActivities: [
          {
            tempId: 'temp-1',
            activityName: 'Soccer',
            dayOfWeek: 'saturday',
            intensityLevel: 'moderate',
            durationMinutes: 90,
          },
        ],
        allowSameDayTraining: true,
      }

      const result = generateTrainingPlanSchema.safeParse(data)
      expect(result.success).toBe(true)
    })

    it('rejects prompt under 10 characters', () => {
      const data = { coachPrompt: 'Short' }
      const result = generateTrainingPlanSchema.safeParse(data)
      expect(result.success).toBe(false)
    })

    it('rejects prompt over 2000 characters', () => {
      const data = { coachPrompt: 'A'.repeat(2001) }
      const result = generateTrainingPlanSchema.safeParse(data)
      expect(result.success).toBe(false)
    })

    it('defaults allowSameDayTraining to false', () => {
      const data = { coachPrompt: 'Create a training plan' }
      const result = generateTrainingPlanSchema.safeParse(data)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.allowSameDayTraining).toBe(false)
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

  describe('reorderSessionsSchema', () => {
    it('validates a reorder request', () => {
      const data = [
        {
          sessionId: '550e8400-e29b-41d4-a716-446655440000',
          dayOfWeek: 'monday',
          orderIndex: 0,
        },
        {
          sessionId: '550e8400-e29b-41d4-a716-446655440001',
          dayOfWeek: 'wednesday',
          orderIndex: 1,
        },
      ]

      const result = reorderSessionsSchema.safeParse(data)
      expect(result.success).toBe(true)
    })

    it('allows null dayOfWeek', () => {
      const data = [
        {
          sessionId: '550e8400-e29b-41d4-a716-446655440000',
          dayOfWeek: null,
          orderIndex: 0,
        },
      ]

      const result = reorderSessionsSchema.safeParse(data)
      expect(result.success).toBe(true)
    })

    it('rejects invalid UUID', () => {
      const data = [
        {
          sessionId: 'not-a-uuid',
          orderIndex: 0,
        },
      ]

      const result = reorderSessionsSchema.safeParse(data)
      expect(result.success).toBe(false)
    })

    it('rejects negative orderIndex', () => {
      const data = [
        {
          sessionId: '550e8400-e29b-41d4-a716-446655440000',
          orderIndex: -1,
        },
      ]

      const result = reorderSessionsSchema.safeParse(data)
      expect(result.success).toBe(false)
    })
  })

  describe('validateClientForTraining', () => {
    it('returns valid for client with weight and goal', () => {
      const client = { currentWeight: 180, goalWeight: 170 }
      const result = validateClientForTraining(client)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('returns errors for missing current weight', () => {
      const client = { goalWeight: 170 }
      const result = validateClientForTraining(client)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Client must have a current weight recorded')
    })

    it('returns warning for missing goal weight', () => {
      const client = { currentWeight: 180 }
      const result = validateClientForTraining(client)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Client should have a goal weight set for better recommendations')
    })

    it('returns all errors for empty client', () => {
      const client = {}
      const result = validateClientForTraining(client)

      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(2)
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
    })

    describe('parseGeneratePlanResponse', () => {
      it('parses a successful generation response', () => {
        const data = {
          success: true,
          plan: {
            id: '123',
            clientId: '456',
            coachId: '789',
            name: 'Generated Plan',
            status: 'active',
            coachPrompt: 'Test prompt',
            splitType: 'upper_lower',
            frequencyPerWeek: 4,
            sessions: [
              {
                id: 'sess-1',
                planId: '123',
                name: 'Upper A',
                sessionType: 'training',
                exercises: [
                  { id: 'ex-1', name: 'Bench Press', sets: 4 },
                ],
              },
            ],
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        }

        const result = parseGeneratePlanResponse(data)
        expect(result).not.toBeNull()
        expect(result?.success).toBe(true)
        expect(result?.plan).toBeDefined()
      })

      it('parses an error response', () => {
        const data = {
          success: false,
          error: 'Generation failed',
          errorMessage: 'AI service unavailable',
        }

        const result = parseGeneratePlanResponse(data)
        expect(result).not.toBeNull()
        expect(result?.success).toBe(false)
      })
    })

    describe('parseSuggestionsResponse', () => {
      it('parses successful suggestions', () => {
        const data = {
          success: true,
          suggestions: [
            'Add more compound movements',
            'Include mobility work',
          ],
        }

        const result = parseSuggestionsResponse(data)
        expect(result).not.toBeNull()
        expect(result?.success).toBe(true)
        expect(result?.suggestions).toHaveLength(2)
      })

      it('parses error response', () => {
        const data = {
          success: false,
          error: 'Failed to generate suggestions',
        }

        const result = parseSuggestionsResponse(data)
        expect(result).not.toBeNull()
        expect(result?.success).toBe(false)
      })
    })
  })
})
