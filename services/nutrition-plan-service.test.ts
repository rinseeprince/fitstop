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

import { supabaseAdmin } from './supabase-admin'
import { recordBodyMetrics } from './body-metrics-service'
import { getClientTodayString } from './today-service'
import { createNutritionPlan } from './nutrition-plan-service'

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

    // The RPC argument object is cast `as never`, so TypeScript checks nothing
    // about it: a key that no longer exists on the function makes PostgREST
    // unable to resolve the overload (PGRST202) and every plan save fails,
    // with tsc/eslint/vitest all green. This asserts the payload keys match
    // migration 139's 24-arg signature exactly.
    it('sends no arguments the RPC does not declare', async () => {
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 'plan-123', error: null } as any)
      const updateQuery = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      }
      vi.mocked(supabaseAdmin.from).mockReturnValue(updateQuery as any)

      await createNutritionPlan(baseParams)

      const sentKeys = Object.keys(
        vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as Record<string, unknown>
      ).sort()

      expect(sentKeys).toEqual([
        'p_base_weight_kg', 'p_baseline_calories', 'p_bmr', 'p_carb_target_g',
        'p_client_id', 'p_coach_id', 'p_custom_calories', 'p_custom_carb_g',
        'p_custom_fat_g', 'p_custom_macros_enabled', 'p_custom_protein_g',
        'p_daily_targets', 'p_diet_type', 'p_effective_from', 'p_fat_target_g',
        'p_goal_deadline', 'p_goal_weight_kg', 'p_protein_target_g',
        'p_protein_target_g_per_kg', 'p_regeneration_reason', 'p_tdee',
        'p_today', 'p_training_volume_hours', 'p_work_activity_level',
      ])
      expect(sentKeys).toHaveLength(24)
      expect(sentKeys).not.toContain('p_coach_notes')
      expect(sentKeys).not.toContain('p_recalc_snapshots')
    })
  })
})
