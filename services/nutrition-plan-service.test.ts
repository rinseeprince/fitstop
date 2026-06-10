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

vi.mock('./body-metrics-service', () => ({
  recordBodyMetrics: vi.fn().mockResolvedValue({}),
}))

vi.mock('./today-service', () => ({
  getClientTodayString: vi.fn().mockResolvedValue('2024-01-17'),
}))

vi.mock('./nutrition-event-service', () => ({
  deleteFutureNutritionEventsForPlan: vi.fn().mockResolvedValue(undefined),
  regenerateFutureNutritionEvents: vi.fn().mockResolvedValue(undefined),
}))

import { supabaseAdmin } from './supabase-admin'
import { recordBodyMetrics } from './body-metrics-service'
import { getClientTodayString } from './today-service'
import { deleteFutureNutritionEventsForPlan, regenerateFutureNutritionEvents } from './nutrition-event-service'
import { createNutritionPlan, promoteNutritionPlanIfReady } from './nutrition-plan-service'

describe('Nutrition Plan Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getClientTodayString).mockResolvedValue('2024-01-17')
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

    it('passes the client-local today to the RPC as p_today', async () => {
      // London client at 00:30 BST: server UTC day is still 2026-06-09, but
      // the client-local today (and thus the active/planned anchor) is 06-10.
      vi.mocked(getClientTodayString).mockResolvedValue('2026-06-10')
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 'plan-123', error: null } as any)

      const updateQuery = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      }
      vi.mocked(supabaseAdmin.from).mockReturnValue(updateQuery as any)

      await createNutritionPlan({ ...baseParams, effectiveFrom: '2026-06-10' })

      expect(getClientTodayString).toHaveBeenCalledWith('client-123')
      expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
        'create_nutrition_plan_atomic',
        expect.objectContaining({
          p_effective_from: '2026-06-10',
          p_today: '2026-06-10',
        })
      )
    })
  })

  describe('promoteNutritionPlanIfReady', () => {
    function createPromoteQuery(result: { data: unknown; error: unknown }) {
      return {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue(result),
      }
    }

    it('gates promotion on the client-local today and anchors the delete/regen pair to it', async () => {
      // London client at 00:30 BST June 10 (23:30 UTC June 9): a plan
      // effective 06-10 must promote NOW, a day before server UTC catches up.
      vi.mocked(getClientTodayString).mockResolvedValue('2026-06-10')

      const plannedQuery = createPromoteQuery({
        data: { id: 'plan-new', effective_from: '2026-06-10' },
        error: null,
      })
      const activeQuery = createPromoteQuery({
        data: { id: 'plan-old' },
        error: null,
      })
      const updateQuery = createPromoteQuery({ data: null, error: null })

      let fromCalls = 0
      vi.mocked(supabaseAdmin.from).mockImplementation(() => {
        fromCalls++
        if (fromCalls === 1) return plannedQuery as never
        if (fromCalls === 2) return activeQuery as never
        return updateQuery as never
      })

      const result = await promoteNutritionPlanIfReady('client-123')

      expect(result).toEqual({ promoted: true, newPlanId: 'plan-new' })
      expect(getClientTodayString).toHaveBeenCalledWith('client-123')
      expect(plannedQuery.lte).toHaveBeenCalledWith('effective_from', '2026-06-10')
      expect(deleteFutureNutritionEventsForPlan).toHaveBeenCalledWith('plan-old', '2026-06-10')
      expect(regenerateFutureNutritionEvents).toHaveBeenCalledWith('client-123', 'plan-new', '2026-06-10')
    })
  })
})
