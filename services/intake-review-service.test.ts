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

vi.mock('@/services/client-energy-service', () => ({
  // Mocked at the MODULE boundary, not the query builder: this suite's
  // supabaseAdmin.from stub routes by call ORDER, so a real energy read/write
  // would consume two slots and reshuffle every later stub.
  recalculateClientEnergy: vi
    .fn()
    .mockResolvedValue({ status: 'written', bmr: 1800, tdee: 2160 }),
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

  // Task 0b.2: `updateGoals` is the sole writer of both goal stores, so the goal
  // fields travel in their own object and never reach the `clients` UPDATE.
  describe('goals do not travel in the clients UPDATE', () => {
    const GOAL_INTAKE = {
      currentWeight: 80,
      bodyFatPercentage: null,
      weightUnit: 'kg',
      heightUnit: null,
      height: null,
      gender: null,
      dateOfBirth: null,
      targetWeight: 70,
      goalDeadline: '2026-12-01',
      goalBodyFatPercentage: 12,
      workActivityLevel: null,
    }

    const nullClient = {
      current_weight: null,
      starting_weight: null,
      height: null,
      gender: null,
      date_of_birth: null,
      current_body_fat_percentage: null,
      starting_body_fat_percentage: null,
      goal_weight: null,
      goal_body_fat_percentage: null,
      goal_deadline: null,
      work_activity_level: null,
      unit_preference: null,
    }

    /** Same call-order routing as mockSupabaseChain, but keeps the UPDATE payload. */
    function chainCapturingUpdate() {
      const update = vi.fn().mockReturnThis()
      let callCount = 0
      vi.mocked(supabaseAdmin.from).mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: nullClient, error: null }),
          } as any
        }
        return { update, eq: vi.fn().mockResolvedValue({ error: null }) } as any
      })
      return update
    }

    it('writes no goal column to clients, and still routes the values to updateGoals', async () => {
      vi.mocked(getIntake).mockResolvedValue(GOAL_INTAKE as any)
      const update = chainCapturingUpdate()

      await syncMetricsToClient('client-123')

      const payload = update.mock.calls[0][0]
      expect(payload).not.toHaveProperty('goal_weight')
      expect(payload).not.toHaveProperty('goal_deadline')
      expect(payload).not.toHaveProperty('goal_body_fat_percentage')
      // The non-goal half is untouched by the split.
      expect(payload).toHaveProperty('current_weight', 80)

      expect(updateGoals).toHaveBeenCalledWith(
        'client-123',
        { goalWeight: 70, goalBodyFatPercentage: 12, goalDeadline: '2026-12-01' },
        'intake'
      )
    })

    // The return value is the "Synced: …" list the coach reads. Splitting the
    // goals out of `updates` without spanning both objects would silently stop
    // reporting three fields the sync still writes.
    it('still reports the goal fields as synced', async () => {
      vi.mocked(getIntake).mockResolvedValue(GOAL_INTAKE as any)
      chainCapturingUpdate()

      const synced = await syncMetricsToClient('client-123')

      expect(synced).toEqual(
        expect.arrayContaining(['goal weight', 'goal deadline', 'goal body fat'])
      )
    })

    it('a failed goal write is no longer swallowed', async () => {
      vi.mocked(getIntake).mockResolvedValue(GOAL_INTAKE as any)
      chainCapturingUpdate()
      vi.mocked(updateGoals).mockRejectedValueOnce(new Error('goal insert failed'))

      await expect(syncMetricsToClient('client-123')).rejects.toThrow('goal insert failed')
    })
  })
})
