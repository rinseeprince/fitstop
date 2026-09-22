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
  getReadingsOnDay: vi.fn(),
}))

vi.mock('./client-goals-service', () => ({
  getGoalForDate: vi.fn(),
}))

vi.mock('./client-goal-writes-service', () => ({
  addGoal: vi.fn(),
}))

vi.mock('./today-service', () => ({
  getClientTodayString: vi.fn(),
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
import { appendMeasurements, getCurrentMeasurements, getReadingsOnDay } from './measurements-service'
import { getGoalForDate } from './client-goals-service'
import { addGoal } from './client-goal-writes-service'
import { getClientTodayString } from './today-service'
import { syncMetricsToClient } from './intake-review-service'
import type { ClientIntake } from '@/types/client-intake'
import type { GoalOnDay } from '@/types/client-goals'

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
      } as never
    }
    // Second call: update client
    return {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue(updateResult ?? { error: null }),
    } as never
  })
}

/** The columns the sync reads off `clients`: every profile fact unset, and a
 *  client east of UTC so the completion instant's DAY is something to assert. */
const nullClient = {
  height: null,
  gender: null,
  date_of_birth: null,
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

/** The client's today, and the coach pressing Sync. */
const TODAY = '2026-06-10'
const COACH_ID = 'coach-9'
const GOAL_ID = 'goal-7'

/** A goal the coach already set, in force on the client's today. */
const GOAL_IN_FORCE: GoalOnDay = {
  id: 'goal-existing',
  clientId: 'client-123',
  name: 'Build muscle',
  type: 'build_muscle',
  targetWeight: 91.5,
  targetBodyFatPercentage: null,
  description: null,
  startsOn: '2026-05-20',
  source: 'coach',
  setBy: COACH_ID,
  createdAt: '2026-05-20T08:00:00Z',
  updatedAt: '2026-05-20T08:00:00Z',
  deadline: null,
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
    vi.mocked(getReadingsOnDay).mockReset()
    vi.mocked(getReadingsOnDay).mockResolvedValue({})
    vi.mocked(getClientTodayString).mockReset()
    vi.mocked(getClientTodayString).mockResolvedValue(TODAY)
    vi.mocked(getGoalForDate).mockReset()
    vi.mocked(getGoalForDate).mockResolvedValue(null)
    vi.mocked(addGoal).mockReset()
    vi.mocked(addGoal).mockResolvedValue(GOAL_ID)
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

      await syncMetricsToClient('client-123', COACH_ID)

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

      const { syncedFields } = await syncMetricsToClient('client-123', COACH_ID)

      expect(appendMeasurements).toHaveBeenCalledWith(
        expect.objectContaining({ values: { bodyFat: 18 } })
      )
      expect(syncedFields).toContain('body fat')
      expect(syncedFields).not.toContain('weight')
    })

    it('records nothing when the intake carries no reading', async () => {
      vi.mocked(getIntake).mockResolvedValue({ ...emptyIntake, height: 180 })
      mockSupabaseChain({ data: nullClient, error: null })

      await syncMetricsToClient('client-123', COACH_ID)

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

      const { syncedFields } = await syncMetricsToClient('client-123', COACH_ID)

      expect(syncedFields.slice(0, 4)).toEqual(['weight', 'body fat', 'height', 'gender'])
    })

    it('a failed reading write is not swallowed', async () => {
      // The profile UPDATE has already committed (CONVENTIONS §2 item 13); the
      // sync reports failure, and a re-run finds the fields filled and only
      // the readings left to write.
      vi.mocked(getIntake).mockResolvedValue({ ...emptyIntake, currentWeight: 80 })
      mockSupabaseChain({ data: nullClient, error: null })
      vi.mocked(appendMeasurements).mockRejectedValueOnce(new Error('DB down'))

      await expect(syncMetricsToClient('client-123', COACH_ID)).rejects.toThrow('DB down')
    })
  })

  describe("the questionnaire's goal", () => {
    it("sets it from the client's today when they have no goal: their type, targets, own words and deadline, set by the syncing coach", async () => {
      vi.mocked(getIntake).mockResolvedValue({
        ...emptyIntake,
        gender: 'male',
        primaryGoal: 'event_prep',
        targetWeight: 88.5,
        goalBodyFatPercentage: 14.5,
        goalDescription: 'Step on stage in December',
        goalDeadline: '2026-12-18',
      })
      mockSupabaseChain({ data: nullClient, error: null })

      const result = await syncMetricsToClient('client-123', COACH_ID)

      expect(getGoalForDate).toHaveBeenCalledWith('client-123', TODAY)
      expect(addGoal).toHaveBeenCalledWith({
        clientId: 'client-123',
        today: TODAY,
        startsOn: TODAY,
        source: 'intake',
        setBy: COACH_ID,
        type: 'event_prep',
        name: 'Event prep',
        targetWeight: 88.5,
        targetBodyFatPercentage: 14.5,
        description: 'Step on stage in December',
        deadline: '2026-12-18',
      })
      // The client's own answer is the type: their weight is never read for it.
      expect(getReadingsOnDay).not.toHaveBeenCalled()
      expect(result).toEqual({
        syncedFields: ['gender', 'goal', 'BMR & TDEE'],
        notes: [],
        goalId: GOAL_ID,
      })
    })

    it("types a goal the questionnaire left untyped from its targets against the client's weight today", async () => {
      // The client already weighs 69.5, so the intake's 76.5 is not recorded,
      // and a 71.5 target is above them: building muscle, not losing weight.
      vi.mocked(getCurrentMeasurements).mockResolvedValue({
        weight: { id: 'm-2', metricKey: 'weight', value: 69.5, date: '2026-06-04', source: 'coach_entry' },
      })
      vi.mocked(getReadingsOnDay).mockResolvedValue({
        weight: { id: 'm-2', metricKey: 'weight', value: 69.5, date: '2026-06-04', source: 'coach_entry' },
      })
      vi.mocked(getIntake).mockResolvedValue({ ...emptyIntake, currentWeight: 76.5, targetWeight: 71.5 })
      mockSupabaseChain({ data: nullClient, error: null })

      await syncMetricsToClient('client-123', COACH_ID)

      expect(getReadingsOnDay).toHaveBeenCalledWith('client-123', TODAY)
      expect(addGoal).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'build_muscle', name: 'Build muscle', targetWeight: 71.5 })
      )
    })

    it("reads that weight after recording the intake's own", async () => {
      vi.mocked(getIntake).mockResolvedValue({ ...emptyIntake, currentWeight: 74.5, targetWeight: 67.5 })
      mockSupabaseChain({ data: nullClient, error: null })

      await syncMetricsToClient('client-123', COACH_ID)

      expect(appendMeasurements).toHaveBeenCalledTimes(1)
      expect(getReadingsOnDay).toHaveBeenCalledTimes(1)
      expect(vi.mocked(appendMeasurements).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(getReadingsOnDay).mock.invocationCallOrder[0]
      )
    })

    it('copies a deadline that falls today — it is still ahead', async () => {
      vi.mocked(getIntake).mockResolvedValue({ ...emptyIntake, primaryGoal: 'maintain', goalDeadline: TODAY })
      mockSupabaseChain({ data: nullClient, error: null })

      const { notes } = await syncMetricsToClient('client-123', COACH_ID)

      expect(addGoal).toHaveBeenCalledWith(expect.objectContaining({ deadline: TODAY }))
      expect(notes).toEqual([])
    })

    it('leaves out a deadline that has passed, and says so', async () => {
      vi.mocked(getIntake).mockResolvedValue({
        ...emptyIntake,
        primaryGoal: 'lose_weight',
        targetWeight: 63.5,
        goalDeadline: '2026-03-01',
      })
      mockSupabaseChain({ data: nullClient, error: null })

      const result = await syncMetricsToClient('client-123', COACH_ID)

      expect(addGoal).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'lose_weight', targetWeight: 63.5, deadline: null })
      )
      expect(result.syncedFields).toContain('goal')
      expect(result.notes).toEqual([
        "The goal deadline (1 Mar) had passed, so it wasn't copied.",
      ])
    })

    it('writes no goal when the client already has one in force today, and says only that', async () => {
      vi.mocked(getGoalForDate).mockResolvedValue(GOAL_IN_FORCE)
      vi.mocked(getIntake).mockResolvedValue({
        ...emptyIntake,
        primaryGoal: 'lose_weight',
        targetWeight: 66.5,
        goalDeadline: '2026-02-14',
      })
      mockSupabaseChain({ data: nullClient, error: null })

      const result = await syncMetricsToClient('client-123', COACH_ID)

      expect(getGoalForDate).toHaveBeenCalledWith('client-123', TODAY)
      expect(addGoal).not.toHaveBeenCalled()
      expect(result.syncedFields).not.toContain('goal')
      expect(result.notes).toEqual([
        "The client already has a goal, so the questionnaire's goal wasn't copied.",
      ])
      expect(result.goalId).toBeNull()
    })

    it('reads and writes no goal, and says nothing of one, when the questionnaire carries none', async () => {
      vi.mocked(getIntake).mockResolvedValue({ ...emptyIntake, height: 172 })
      mockSupabaseChain({ data: nullClient, error: null })

      const result = await syncMetricsToClient('client-123', COACH_ID)

      expect(getGoalForDate).not.toHaveBeenCalled()
      expect(addGoal).not.toHaveBeenCalled()
      expect(result.notes).toEqual([])
      expect(result.goalId).toBeNull()
    })

    it('a failed goal write is not swallowed', async () => {
      vi.mocked(getIntake).mockResolvedValue({ ...emptyIntake, primaryGoal: 'general_fitness' })
      mockSupabaseChain({ data: nullClient, error: null })
      vi.mocked(addGoal).mockRejectedValueOnce(new Error('goal write failed'))

      await expect(syncMetricsToClient('client-123', COACH_ID)).rejects.toThrow('goal write failed')
    })
  })
})
