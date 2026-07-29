import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

vi.mock('./client-intake-service', () => ({
  getIntake: vi.fn(),
}))

vi.mock('./body-metrics-service', () => ({
  recordBodyMetrics: vi.fn().mockResolvedValue({}),
}))

vi.mock('./client-goals-service', () => ({
  updateGoals: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/services/client-service', () => ({
  getClientById: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/services/bmr-service', () => ({
  updateClientBMR: vi.fn().mockResolvedValue(undefined),
}))

import { supabaseAdmin } from './supabase-admin'
import { getIntake } from './client-intake-service'
import { recordBodyMetrics } from './body-metrics-service'
import { updateGoals } from './client-goals-service'
import { syncMetricsToClient } from './intake-review-service'

// Helper to mock supabaseAdmin.from with sequential calls
function mockSupabaseChain(selectResult: { data: unknown; error: unknown }, updateResult?: { error: unknown }) {
  let callCount = 0
  vi.mocked(supabaseAdmin.from).mockImplementation(() => {
    callCount++
    if (callCount === 1) {
      // First call: select client
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(selectResult),
      } as any
    }
    // Second call: update client
    return {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue(updateResult ?? { error: null }),
    } as any
  })
}

describe('Intake Review Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('syncMetricsToClient', () => {
    const nullClient = {
      current_weight: null,
      height: null,
      gender: null,
      date_of_birth: null,
      current_body_fat_percentage: null,
      goal_weight: null,
      goal_body_fat_percentage: null,
      goal_deadline: null,
      work_activity_level: null,
      height_unit: null,
      weight_unit: null,
      unit_preference: null,
    }

    it('dual-writes body metrics on sync', async () => {
      vi.mocked(getIntake).mockResolvedValue({
        currentWeight: 80,
        bodyFatPercentage: 18,
        weightUnit: 'kg',
        heightUnit: 'cm',
        height: 180,
        gender: null,
        dateOfBirth: null,
        targetWeight: null,
        goalDeadline: null,
        goalBodyFatPercentage: null,
        workActivityLevel: null,
      } as any)

      mockSupabaseChain({ data: nullClient, error: null })

      await syncMetricsToClient('client-123')

      expect(recordBodyMetrics).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'client-123',
          weight: 80,
          bodyFatPercentage: 18,
          source: 'intake_sync',
        })
      )
    })

    it('dual-writes goals on sync when goal fields present', async () => {
      vi.mocked(getIntake).mockResolvedValue({
        currentWeight: null,
        bodyFatPercentage: null,
        weightUnit: null,
        heightUnit: null,
        height: null,
        gender: null,
        dateOfBirth: null,
        targetWeight: 70,
        goalDeadline: '2025-06-01',
        goalBodyFatPercentage: 12,
        workActivityLevel: null,
      } as any)

      mockSupabaseChain({ data: nullClient, error: null })

      await syncMetricsToClient('client-123')

      expect(updateGoals).toHaveBeenCalledWith(
        'client-123',
        expect.objectContaining({
          goalWeight: 70,
          goalBodyFatPercentage: 12,
          goalDeadline: '2025-06-01',
        }),
        'intake'
      )
    })

    it('FAILS the sync when the goal backfill fails, rather than reporting success', async () => {
      vi.mocked(getIntake).mockResolvedValue({
        currentWeight: null,
        bodyFatPercentage: null,
        weightUnit: null,
        heightUnit: null,
        height: null,
        gender: null,
        dateOfBirth: null,
        targetWeight: 70,
        goalDeadline: '2025-06-01',
        goalBodyFatPercentage: 12,
        workActivityLevel: null,
      } as any)

      mockSupabaseChain({ data: nullClient, error: null })
      vi.mocked(updateGoals).mockRejectedValueOnce(new Error('rpc down'))

      // Swallowing here left the mirror carrying a backfilled goal that
      // `client_goals` had never heard of — and reported success.
      await expect(syncMetricsToClient('client-123')).rejects.toThrow('rpc down')
    })

    it('does not fail if dual-write throws', async () => {
      vi.mocked(getIntake).mockResolvedValue({
        currentWeight: 80,
        bodyFatPercentage: null,
        weightUnit: 'kg',
        heightUnit: null,
        height: null,
        gender: null,
        dateOfBirth: null,
        targetWeight: null,
        goalDeadline: null,
        goalBodyFatPercentage: null,
        workActivityLevel: null,
      } as any)

      mockSupabaseChain({ data: nullClient, error: null })
      vi.mocked(recordBodyMetrics).mockRejectedValueOnce(new Error('DB down'))

      await expect(syncMetricsToClient('client-123')).resolves.toBeDefined()
    })
  })
})
