import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

vi.mock('./client-intake-service', () => ({
  getIntake: vi.fn(),
}))

vi.mock('./measurements-service', () => ({
  appendMeasurements: vi.fn(),
  getCurrentMeasurements: vi.fn(),
}))

vi.mock('./client-goals-service', () => ({
  updateGoals: vi.fn().mockResolvedValue({}),
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
import { appendMeasurements, getCurrentMeasurements } from './measurements-service'
import { updateGoals } from './client-goals-service'
import { syncMetricsToClient } from './intake-review-service'
import type { ClientIntake } from '@/types/client-intake'

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

/** The columns the sync reads off `clients`: every profile fact unset, and a
 *  client east of UTC so the completion instant's DAY is something to assert. */
const nullClient = {
  height: null,
  gender: null,
  date_of_birth: null,
  goal_weight: null,
  goal_body_fat_percentage: null,
  goal_deadline: null,
  work_activity_level: null,
  timezone: 'Europe/London',
}

/** A completed questionnaire with nothing filled in; tests add the answers. */
const emptyIntake: ClientIntake = {
  id: 'intake-1',
  clientId: 'client-123',
  status: 'completed',
  completedAt: '2026-06-09T12:00:00Z',
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-09T12:00:00Z',
}

describe('Intake Review Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(appendMeasurements).mockReset()
    vi.mocked(appendMeasurements).mockResolvedValue({
      rows: {},
      inserted: [],
      unchanged: [],
      energy: 'nothing_inserted',
    })
    vi.mocked(getCurrentMeasurements).mockReset()
    vi.mocked(getCurrentMeasurements).mockResolvedValue({})
  })

  describe('syncMetricsToClient', () => {
    it("records the intake's weight and body fat as intake readings, dated the day the questionnaire was completed on the client's calendar", async () => {
      // 23:30 UTC June 9 is already June 10 in London: the reading belongs to
      // the day the client captured it, not to the server's.
      vi.mocked(getIntake).mockResolvedValue({
        ...emptyIntake,
        currentWeight: 80,
        bodyFatPercentage: 18,
        height: 180,
        completedAt: '2026-06-09T23:30:00Z',
      })
      mockSupabaseChain({ data: nullClient, error: null })

      await syncMetricsToClient('client-123')

      expect(appendMeasurements).toHaveBeenCalledWith({
        clientId: 'client-123',
        source: 'intake',
        recordedOn: '2026-06-10',
        values: { weight: 80, bodyFat: 18 },
      })
    })

    it('fills a reading only when the client has none yet — the newest reading in the log is the guard', async () => {
      // A client already weighed in cannot be overwritten by a sync; the body
      // fat, which no reading carries yet, still lands.
      vi.mocked(getCurrentMeasurements).mockResolvedValue({
        weight: { id: 'm-1', metricKey: 'weight', value: 82, date: '2026-06-01', source: 'check_in' },
      })
      vi.mocked(getIntake).mockResolvedValue({
        ...emptyIntake,
        currentWeight: 80,
        bodyFatPercentage: 18,
      })
      mockSupabaseChain({ data: nullClient, error: null })

      const synced = await syncMetricsToClient('client-123')

      expect(appendMeasurements).toHaveBeenCalledWith(
        expect.objectContaining({ values: { bodyFat: 18 } })
      )
      expect(synced).toContain('body fat')
      expect(synced).not.toContain('weight')
    })

    it('records nothing when the intake carries no reading', async () => {
      vi.mocked(getIntake).mockResolvedValue({ ...emptyIntake, height: 180 })
      mockSupabaseChain({ data: nullClient, error: null })

      await syncMetricsToClient('client-123')

      expect(appendMeasurements).not.toHaveBeenCalled()
    })

    it('names the readings first in the synced list, then the profile fields', async () => {
      // This is the "Synced: weight, body fat, height…" line the coach reads.
      vi.mocked(getIntake).mockResolvedValue({
        ...emptyIntake,
        currentWeight: 80,
        bodyFatPercentage: 18,
        height: 180,
        gender: 'female',
      })
      mockSupabaseChain({ data: nullClient, error: null })

      const synced = await syncMetricsToClient('client-123')

      expect(synced.slice(0, 4)).toEqual(['weight', 'body fat', 'height', 'gender'])
    })

    it('dual-writes goals on sync when goal fields present', async () => {
      vi.mocked(getIntake).mockResolvedValue({
        ...emptyIntake,
        targetWeight: 70,
        goalDeadline: '2025-06-01',
        goalBodyFatPercentage: 12,
      })
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

    it('a failed reading write is not swallowed', async () => {
      // The profile UPDATE has already committed (CONVENTIONS §2 item 13); the
      // sync reports failure, and a re-run finds the fields filled and only
      // the readings left to write.
      vi.mocked(getIntake).mockResolvedValue({ ...emptyIntake, currentWeight: 80 })
      mockSupabaseChain({ data: nullClient, error: null })
      vi.mocked(appendMeasurements).mockRejectedValueOnce(new Error('DB down'))

      await expect(syncMetricsToClient('client-123')).rejects.toThrow('DB down')
    })
  })

  // Task 0b.2: `updateGoals` is the sole writer of both goal stores, so the goal
  // fields travel in their own object and never reach the `clients` UPDATE.
  describe('goals do not travel in the clients UPDATE', () => {
    const GOAL_INTAKE: ClientIntake = {
      ...emptyIntake,
      currentWeight: 80,
      height: 180,
      targetWeight: 70,
      goalDeadline: '2026-12-01',
      goalBodyFatPercentage: 12,
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
      vi.mocked(getIntake).mockResolvedValue(GOAL_INTAKE)
      const update = chainCapturingUpdate()

      await syncMetricsToClient('client-123')

      const payload = update.mock.calls[0][0]
      expect(payload).not.toHaveProperty('goal_weight')
      expect(payload).not.toHaveProperty('goal_deadline')
      expect(payload).not.toHaveProperty('goal_body_fat_percentage')
      // No reading travels in it either — that is a row in the measurement log.
      expect(payload).not.toHaveProperty('current_weight')
      // The profile half is untouched by the split.
      expect(payload).toHaveProperty('height', 180)

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
      vi.mocked(getIntake).mockResolvedValue(GOAL_INTAKE)
      chainCapturingUpdate()

      const synced = await syncMetricsToClient('client-123')

      expect(synced).toEqual(
        expect.arrayContaining(['goal weight', 'goal deadline', 'goal body fat'])
      )
    })

    it('a failed goal write is no longer swallowed', async () => {
      vi.mocked(getIntake).mockResolvedValue(GOAL_INTAKE)
      chainCapturingUpdate()
      vi.mocked(updateGoals).mockRejectedValueOnce(new Error('goal insert failed'))

      await expect(syncMetricsToClient('client-123')).rejects.toThrow('goal insert failed')
    })
  })
})
