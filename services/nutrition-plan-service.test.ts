import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

vi.mock('@/utils/nutrition-helpers', () => ({
  calculateDailyMacros: vi.fn().mockReturnValue({ proteinG: 180, carbsG: 220, fatG: 70 }),
  DAYS_OF_WEEK: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
  getTrainingDays: vi.fn().mockReturnValue(new Set()),
}))

vi.mock('./weekly-nutrition-service', () => ({
  upsertWeeklySummary: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/date-helpers', () => ({
  getWeekStart: vi.fn().mockReturnValue('2024-01-15'),
  getTodayDateString: vi.fn().mockReturnValue('2024-01-17'),
}))

vi.mock('./body-metrics-service', () => ({
  recordBodyMetrics: vi.fn().mockResolvedValue({}),
}))

import { supabaseAdmin } from './supabase-admin'
import { recordBodyMetrics } from './body-metrics-service'
import { createNutritionPlan } from './nutrition-plan-service'

describe('Nutrition Plan Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createNutritionPlan', () => {
    const baseParams = {
      clientId: 'client-123',
      coachId: 'coach-456',
      workActivityLevel: 'moderate',
      trainingVolumeHours: '5-7',
      proteinTargetGPerKg: 2.0,
      dietType: 'balanced' as const,
      goalWeightKg: 75,
      goalDeadline: '2025-06-01',
      baselineCalories: 2000,
      proteinTargetG: 180,
      carbTargetG: 220,
      fatTargetG: 70,
      baseWeightKg: 80,
      bmr: 1800,
      tdee: 2400,
      customMacrosEnabled: false,
      customCalories: null,
      customProteinG: null,
      customCarbG: null,
      customFatG: null,
      regenerationReason: 'initial',
      trainingPlan: null,
    }

    it('dual-writes TDEE to body_metrics after plan creation', async () => {
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 'plan-123', error: null } as any)

      const updateQuery = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      }
      vi.mocked(supabaseAdmin.from).mockReturnValue(updateQuery as any)

      await createNutritionPlan(baseParams)

      expect(recordBodyMetrics).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'client-123',
          tdee: 2400,
          bmr: 1800,
          source: 'nutrition_plan',
          sourceId: 'plan-123',
        })
      )
    })

    it('does not dual-write when tdee is null', async () => {
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 'plan-123', error: null } as any)

      const updateQuery = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      }
      vi.mocked(supabaseAdmin.from).mockReturnValue(updateQuery as any)

      await createNutritionPlan({ ...baseParams, tdee: null })

      expect(recordBodyMetrics).not.toHaveBeenCalled()
    })
  })
})
