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

vi.mock('@/lib/error-handler', () => ({
  captureApiError: vi.fn(),
}))

import { supabaseAdmin } from './supabase-admin'
import { recordBodyMetrics } from './body-metrics-service'
import { getClientTodayString } from './today-service'
import { captureApiError } from '@/lib/error-handler'
import { createNutritionPlan, stampPhasesFingerprint } from './nutrition-plan-service'

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
          // Defaults to false (preserve banner snapshot) when not passed.
          p_recalc_snapshots: false,
        })
      )
    })

    it('forwards recalcSnapshots to the RPC as p_recalc_snapshots', async () => {
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 'plan-123', error: null } as any)
      const updateQuery = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      }
      vi.mocked(supabaseAdmin.from).mockReturnValue(updateQuery as any)

      await createNutritionPlan({ ...baseParams, recalcSnapshots: true })

      expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
        'create_nutrition_plan_atomic',
        expect.objectContaining({ p_recalc_snapshots: true })
      )
    })

    it('never sends phases_fingerprint to the RPC', () => {
      // Migration 138 keeps the fingerprint OUT of create_nutrition_plan_atomic
      // on purpose: it must be the last write of a generation, after event
      // regeneration. If it ever reappears in this arg object, the RPC has been
      // widened and the stamp-last ordering has been broken.
      const args = vi.mocked(supabaseAdmin.rpc).mock.calls[0]?.[1] as
        | Record<string, unknown>
        | undefined
      expect(args && 'p_phases_fingerprint' in args).toBeFalsy()
    })
  })

  describe('stampPhasesFingerprint', () => {
    function updateQuery(error: { message: string } | null) {
      const q = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn(),
      }
      q.eq.mockResolvedValue({ data: null, error })
      return q
    }

    it('writes the fingerprint scoped to the plan id', async () => {
      const q = updateQuery(null)
      vi.mocked(supabaseAdmin.from).mockReturnValue(q as never)

      await stampPhasesFingerprint('plan-1', 'abc123')

      expect(supabaseAdmin.from).toHaveBeenCalledWith('nutrition_plans')
      expect(q.update).toHaveBeenCalledWith(
        expect.objectContaining({ phases_fingerprint: 'abc123' })
      )
      expect(q.eq).toHaveBeenCalledWith('id', 'plan-1')
    })

    it('writes null when no block set drove the generation', async () => {
      const q = updateQuery(null)
      vi.mocked(supabaseAdmin.from).mockReturnValue(q as never)

      await stampPhasesFingerprint('plan-1', null)

      expect(q.update).toHaveBeenCalledWith(
        expect.objectContaining({ phases_fingerprint: null })
      )
    })

    it('reports a failure to Sentry and does NOT throw', async () => {
      // The deliberate CONVENTIONS section 2 #12 case: this is the last write of
      // the generation, so failing it leaves the OLD fingerprint in place, which
      // reads as "out of date" — a visible false alarm that clears on the next
      // regenerate. Throwing would 500 a coach whose plan, targets and events all
      // committed correctly.
      const q = updateQuery({ message: 'boom' })
      vi.mocked(supabaseAdmin.from).mockReturnValue(q as never)

      await expect(stampPhasesFingerprint('plan-1', 'abc123')).resolves.toBeUndefined()
      expect(captureApiError).toHaveBeenCalled()
    })
  })
})
