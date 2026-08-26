import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
} from './check-in-service'

// Mock the supabase-admin module
vi.mock('./supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

// Session 6.4: submitCheckIn now DERIVES its snapshot columns from the spine.
// Mock those service dependencies so the submit tests assert the derived values
// (and that the exercise-highlights writer is the only related-data write left —
// the session-completions writer was deleted with its dropped table).
const getClientByIdMock = vi.fn()
const getCheckInTrainingPeriodStatsMock = vi.fn()
const getNutritionSummaryForPeriodMock = vi.fn()
const getDailyLogsMock = vi.fn()
const insertExerciseHighlightsMock = vi.fn()
const calculateCheckInPeriodMock = vi.fn()
const resolveCheckInWindowMock = vi.fn()

vi.mock('./client-service', () => ({
  getClientById: (...args: unknown[]) => getClientByIdMock(...args),
}))
vi.mock('./check-in-context-service', () => ({
  getCheckInTrainingPeriodStats: (...args: unknown[]) => getCheckInTrainingPeriodStatsMock(...args),
}))
vi.mock('./weekly-nutrition-service', () => ({
  getNutritionSummaryForPeriod: (...args: unknown[]) => getNutritionSummaryForPeriodMock(...args),
}))
vi.mock('./daily-logs-service', () => ({
  getDailyLogs: (...args: unknown[]) => getDailyLogsMock(...args),
}))
vi.mock('./check-in-details-service', () => ({
  insertExerciseHighlights: (...args: unknown[]) => insertExerciseHighlightsMock(...args),
  // deriveSessionCompletionsForCheckIn / getCheckInWithDetails / getCheckInExerciseHighlights
  // are re-exported but unused by these tests; stub to keep the module mock total.
  deriveSessionCompletionsForCheckIn: vi.fn(),
  getCheckInWithDetails: vi.fn(),
  getCheckInExerciseHighlights: vi.fn(),
}))

import { supabaseAdmin } from './supabase-admin'

// We mock the whole date-helpers module elsewhere is risky (the service uses
// several helpers), so instead we spy on calculateCheckInPeriod via partial mock.
vi.mock('@/lib/date-helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/date-helpers')>()
  return {
    ...actual,
    calculateCheckInPeriod: (...args: unknown[]) => calculateCheckInPeriodMock(...args),
    resolveCheckInWindow: (...args: unknown[]) => resolveCheckInWindowMock(...args),
  }
})

// Helper to create a chainable mock query
function createMockQuery(result: { data: unknown; error: unknown }) {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  }

  // Make the query itself thenable for await without .single()
  const thenableMock = Object.assign(mockQuery, {
    then: (resolve: (value: typeof result) => void) => Promise.resolve(result).then(resolve),
  })

  return thenableMock
}

describe('Check-in Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('submitCheckIn (Session 6.4 spine derivation)', () => {
    function mockInsert(result: { data: unknown; error: unknown }) {
      const mockInsertQuery = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(result),
      }
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockInsertQuery as any)
      return mockInsertQuery
    }

    beforeEach(() => {
      getClientByIdMock.mockReset()
      getCheckInTrainingPeriodStatsMock.mockReset()
      getNutritionSummaryForPeriodMock.mockReset()
      getDailyLogsMock.mockReset()
      insertExerciseHighlightsMock.mockReset()
      calculateCheckInPeriodMock.mockReset()
      resolveCheckInWindowMock.mockReset()
      // Default happy-path period + client.
      getClientByIdMock.mockResolvedValue({ expectedCheckInDay: 'sunday', startDate: '2026-01-01' })
      resolveCheckInWindowMock.mockReturnValue({ periodStart: '2026-05-08', periodEnd: '2026-05-14' })
      getCheckInTrainingPeriodStatsMock.mockResolvedValue({ sessionsCompleted: 0, sessionsPlanned: 0 })
      getNutritionSummaryForPeriodMock.mockResolvedValue(null)
      getDailyLogsMock.mockResolvedValue([])
    })

    it('submits a basic check-in successfully', async () => {
      const q = mockInsert({ data: { id: 'new-check-in-id' }, error: null })

      const { submitCheckIn } = await import('./check-in-service')
      const result = await submitCheckIn('client-123', { weight: 180, weightUnit: 'lbs' })

      expect(result).toBe('new-check-in-id')
      expect(supabaseAdmin.from).toHaveBeenCalledWith('check_ins')
      expect(q.insert).toHaveBeenCalled()
    })

    it("anchors the STORED period to the client's local today (London 23:30Z boundary)", async () => {
      // 23:30 UTC June 9 = 00:30 BST June 10. The persisted period_start/end
      // are read forever by coach-side derivations, so the window passed to
      // resolveCheckInWindow must be the client-local day. getTodayInTimezone
      // is real here (the partial date-helpers mock only replaces the two
      // window fns); the suite is pinned to TZ=UTC so a regression to the
      // server clock fails on any host.
      vi.useFakeTimers()
      try {
        vi.setSystemTime(new Date('2026-06-09T23:30:00Z'))
        getClientByIdMock.mockResolvedValue({
          expectedCheckInDay: 'wednesday',
          startDate: '2026-01-01',
          timezone: 'Europe/London',
        })
        mockInsert({ data: { id: 'new-check-in-id' }, error: null })

        const { submitCheckIn } = await import('./check-in-service')
        await submitCheckIn('client-123', { weight: 180, weightUnit: 'lbs' })

        const todayArg = resolveCheckInWindowMock.mock.calls[0][0] as Date
        expect(todayArg.getDate()).toBe(10)
        expect(resolveCheckInWindowMock).toHaveBeenCalledWith(
          expect.any(Date),
          'wednesday',
          '2026-01-01',
        )
      } finally {
        vi.useRealTimers()
      }
    })

    it('DERIVES snapshot columns from the spine, not the form body', async () => {
      getCheckInTrainingPeriodStatsMock.mockResolvedValue({ sessionsCompleted: 4, sessionsPlanned: 5 })
      getNutritionSummaryForPeriodMock.mockResolvedValue({ daysOnTarget: 5, adherencePercentage: 71.4 })
      getDailyLogsMock.mockResolvedValue([
        { date: '2026-05-08', mood: 4, energy: 8, sleep: 7, stress: 3, soreness: 6 },
        { date: '2026-05-09', mood: 2, energy: 6, sleep: 5, stress: 5, soreness: 2 },
      ])

      const q = mockInsert({ data: { id: 'ci' }, error: null })

      const { submitCheckIn } = await import('./check-in-service')
      // Form body carries bogus session/nutrition/mood values that MUST be ignored.
      await submitCheckIn('client-123', {
        mood: 99,
        energy: 99,
        sleep: 99,
        stress: 99,
        workoutsCompleted: 99,
        adherencePercentage: 99,
        sessionCompletions: [{ trainingSessionId: 's', sessionName: 'x', completed: true }],
        nutritionAdherence: { daysOnTarget: 99 },
        notes: 'reflection',
      } as any)

      const inserted = q.insert.mock.calls[0][0]
      expect(inserted.workouts_completed).toBe(4) // from training stats, not 99
      expect(inserted.nutrition_days_on_target).toBe(5) // from nutrition summary, not 99
      expect(inserted.adherence_percentage).toBe(71) // rounded, capped 0-100
      // Wellness averaged via calculateMetricAverages over the period rows.
      expect(inserted.mood).toBe(3) // round((4+2)/2)
      expect(inserted.energy).toBe(7) // round((8+6)/2)
      expect(inserted.sleep).toBe(6) // round((7+5)/2)
      expect(inserted.stress).toBe(4) // round((3+5)/2)
      expect(inserted.soreness).toBe(4) // round((6+2)/2)
      // The qualitative reflection is preserved.
      expect(inserted.notes).toBe('reflection')
      // Period persisted.
      expect(inserted.period_start).toBe('2026-05-08')
      expect(inserted.period_end).toBe('2026-05-14')
      // Reuses getNutritionSummaryForPeriod (Pin 1) and getDailyLogs (Pin 2).
      expect(getNutritionSummaryForPeriodMock).toHaveBeenCalledWith('client-123', '2026-05-08', '2026-05-14')
      expect(getDailyLogsMock).toHaveBeenCalledWith('client-123', '2026-05-08', '2026-05-14')
    })

    it('inserts NO soreness snapshot when the period logged none (decision C: no fabricated default)', async () => {
      getCheckInTrainingPeriodStatsMock.mockResolvedValue({ sessionsCompleted: 4, sessionsPlanned: 5 })
      getNutritionSummaryForPeriodMock.mockResolvedValue({ daysOnTarget: 5, adherencePercentage: 71.4 })
      getDailyLogsMock.mockResolvedValue([
        { date: '2026-05-08', mood: 4, energy: 8, sleep: 7, stress: 3 },
      ])

      const q = mockInsert({ data: { id: 'ci' }, error: null })

      const { submitCheckIn } = await import('./check-in-service')
      await submitCheckIn('client-123', { notes: 'reflection' } as any)

      const inserted = q.insert.mock.calls[0][0]
      // Siblings keep their existing derivation/fallback semantics...
      expect(inserted.mood).toBe(4)
      // ...but soreness is never fabricated: undefined -> NULL snapshot, not 5.
      expect(inserted.soreness).toBeUndefined()
    })

    it('caps adherence_percentage at 100', async () => {
      getNutritionSummaryForPeriodMock.mockResolvedValue({ daysOnTarget: 7, adherencePercentage: 142 })
      const q = mockInsert({ data: { id: 'ci' }, error: null })

      const { submitCheckIn } = await import('./check-in-service')
      await submitCheckIn('client-123', {})

      expect(q.insert.mock.calls[0][0].adherence_percentage).toBe(100)
    })

    it('writes only exercise highlights as related data (the session-completions writer is gone)', async () => {
      mockInsert({ data: { id: 'ci' }, error: null })

      const { submitCheckIn } = await import('./check-in-service')
      await submitCheckIn('client-123', {
        exerciseHighlights: [
          { exerciseName: 'Squat', highlightType: 'pr' },
        ],
      } as any)

      // No session-completions writer exists anymore — assert the highlights one
      // is the only related-data write.
      expect(insertExerciseHighlightsMock).toHaveBeenCalledTimes(1)
    })

    it('throws error when submission fails', async () => {
      mockInsert({ data: null, error: { message: 'Insert failed' } })

      const { submitCheckIn } = await import('./check-in-service')

      await expect(submitCheckIn('client-123', {})).rejects.toThrow(
        'Failed to submit check-in: Insert failed'
      )
    })
  })

  describe('getCheckInById', () => {
    it('returns check-in when found', async () => {
      const mockQuery = createMockQuery({
        data: {
          id: 'check-in-123',
          client_id: 'client-456',
          status: 'pending',
          mood: 4,
          energy: 7,
          created_at: '2024-01-15T00:00:00Z',
          updated_at: '2024-01-15T00:00:00Z',
        },
        error: null,
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const { getCheckInById } = await import('./check-in-service')
      const result = await getCheckInById('check-in-123')

      expect(result).not.toBeNull()
      expect(result?.id).toBe('check-in-123')
      expect(result?.clientId).toBe('client-456')
      expect(result?.mood).toBe(4)
    })

    it('returns null when not found', async () => {
      const mockQuery = createMockQuery({
        data: null,
        error: { message: 'Not found' },
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const { getCheckInById } = await import('./check-in-service')
      const result = await getCheckInById('nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('getClientCheckIns', () => {
    it('returns paginated check-ins', async () => {
      const mockData = [
        {
          id: 'check-in-1',
          client_id: 'client-123',
          status: 'reviewed',
          created_at: '2024-01-15T00:00:00Z',
          updated_at: '2024-01-15T00:00:00Z',
        },
        {
          id: 'check-in-2',
          client_id: 'client-123',
          status: 'pending',
          created_at: '2024-01-08T00:00:00Z',
          updated_at: '2024-01-08T00:00:00Z',
        },
      ]

      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        then: (resolve: (value: unknown) => void) =>
          Promise.resolve({ data: mockData, error: null, count: 10 }).then(resolve),
      }

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const { getClientCheckIns } = await import('./check-in-service')
      const result = await getClientCheckIns('client-123', { limit: 10, offset: 0 })

      expect(result.checkIns).toHaveLength(2)
      expect(result.total).toBe(10)
      expect(result.checkIns[0].id).toBe('check-in-1')
    })

    it('filters by status when provided', async () => {
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: (resolve: (value: unknown) => void) =>
          Promise.resolve({ data: [], error: null, count: 0 }).then(resolve),
      }

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const { getClientCheckIns } = await import('./check-in-service')
      await getClientCheckIns('client-123', { status: 'pending' })

      // eq should be called twice - once for client_id, once for status
      expect(mockQuery.eq).toHaveBeenCalledTimes(2)
    })

    it('keyset first page (no cursor) fetches limit+1 and returns a nextCursor when more exist', async () => {
      // 3 rows returned for limit 2 → a further page exists.
      const rows = [
        { id: '11111111-1111-4111-8111-111111111111', client_id: 'c', status: 'reviewed', created_at: '2024-01-15T00:00:00Z', updated_at: '2024-01-15T00:00:00Z' },
        { id: '22222222-2222-4222-8222-222222222222', client_id: 'c', status: 'reviewed', created_at: '2024-01-08T00:00:00Z', updated_at: '2024-01-08T00:00:00Z' },
        { id: '33333333-3333-4333-8333-333333333333', client_id: 'c', status: 'reviewed', created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' },
      ]
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: (resolve: (value: unknown) => void) =>
          Promise.resolve({ data: rows, error: null }).then(resolve),
      }
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const { getClientCheckIns } = await import('./check-in-service')
      const result = await getClientCheckIns('c', { limit: 2, keyset: true })

      expect(mockQuery.or).not.toHaveBeenCalled() // first page has no predicate
      expect(mockQuery.limit).toHaveBeenCalledWith(3) // limit + 1
      expect(result.checkIns).toHaveLength(2) // extra row trimmed
      expect(result.checkIns.map((c) => c.id)).toEqual([
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ])
      // nextCursor points at the last RETURNED row, not the peeked extra.
      expect(result.nextCursor).toEqual({
        createdAt: '2024-01-08T00:00:00Z',
        id: '22222222-2222-4222-8222-222222222222',
      })
    })

    it('keyset follow-up applies the (created_at,id) predicate and ends with nextCursor null', async () => {
      const rows = [
        { id: '44444444-4444-4444-8444-444444444444', client_id: 'c', status: 'reviewed', created_at: '2023-12-25T00:00:00Z', updated_at: '2023-12-25T00:00:00Z' },
      ]
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: (resolve: (value: unknown) => void) =>
          Promise.resolve({ data: rows, error: null }).then(resolve),
      }
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const { getClientCheckIns } = await import('./check-in-service')
      const cursor = { createdAt: '2024-01-01T00:00:00Z', id: '33333333-3333-4333-8333-333333333333' }
      const result = await getClientCheckIns('c', { limit: 2, cursor })

      // Exact .or string: created_at < cursor OR (created_at = cursor AND id < cursor.id)
      expect(mockQuery.or).toHaveBeenCalledWith(
        'created_at.lt.2024-01-01T00:00:00Z,and(created_at.eq.2024-01-01T00:00:00Z,id.lt.33333333-3333-4333-8333-333333333333)'
      )
      expect(result.checkIns).toHaveLength(1)
      expect(result.nextCursor).toBeNull() // fewer than limit+1 rows → no further page
    })

    it('pages across a created_at tie, splitting by id with no overlap (simulated DB ordering)', async () => {
      const { getClientCheckIns } = await import('./check-in-service')

      // Page 1: two rows sharing the same created_at, newest id first (limit 2, peek 1 extra).
      const page1 = [
        { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', client_id: 'c', status: 'reviewed', created_at: '2024-02-01T10:00:00Z', updated_at: '2024-02-01T10:00:00Z' },
        { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', client_id: 'c', status: 'reviewed', created_at: '2024-02-01T10:00:00Z', updated_at: '2024-02-01T10:00:00Z' },
        { id: '99999999-9999-4999-8999-999999999999', client_id: 'c', status: 'reviewed', created_at: '2024-02-01T10:00:00Z', updated_at: '2024-02-01T10:00:00Z' },
      ]
      const q1 = {
        select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
        then: (r: (v: unknown) => void) => Promise.resolve({ data: page1, error: null }).then(r),
      }
      vi.mocked(supabaseAdmin.from).mockReturnValue(q1 as any)
      const r1 = await getClientCheckIns('c', { limit: 2, keyset: true })
      expect(r1.checkIns.map((c) => c.id)).toEqual([
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ])
      expect(r1.nextCursor).toEqual({ createdAt: '2024-02-01T10:00:00Z', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })

      // Page 2 with that cursor: the id-tiebreak predicate excludes the page-1 ids.
      const page2 = [
        { id: '99999999-9999-4999-8999-999999999999', client_id: 'c', status: 'reviewed', created_at: '2024-02-01T10:00:00Z', updated_at: '2024-02-01T10:00:00Z' },
      ]
      const q2 = {
        select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
        then: (r: (v: unknown) => void) => Promise.resolve({ data: page2, error: null }).then(r),
      }
      vi.mocked(supabaseAdmin.from).mockReturnValue(q2 as any)
      const r2 = await getClientCheckIns('c', { limit: 2, cursor: r1.nextCursor! })

      expect(q2.or).toHaveBeenCalledWith(
        'created_at.lt.2024-02-01T10:00:00Z,and(created_at.eq.2024-02-01T10:00:00Z,id.lt.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa)'
      )
      // No overlap with page 1.
      const page1Ids = new Set(r1.checkIns.map((c) => c.id))
      expect(r2.checkIns.some((c) => page1Ids.has(c.id))).toBe(false)
      expect(r2.checkIns.map((c) => c.id)).toEqual(['99999999-9999-4999-8999-999999999999'])
    })
  })

  describe('updateCheckInAISummary', () => {
    it('updates AI fields and sets status', async () => {
      const mockQuery = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: {}, error: null }),
      }

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const { updateCheckInAISummary } = await import('./check-in-service')

      await updateCheckInAISummary(
        'check-in-123',
        {
          summary: 'Great progress!',
          watchItems: [{ type: 'win', text: 'Slept well all week' }],
          themes: ['sleep', 'consistency'],
          coachActions: [{ priority: 'high', text: 'Keep it up' }],
          clientMessage: 'Draft message',
        }
      )

      expect(mockQuery.update).toHaveBeenCalled()
      const updateCall = mockQuery.update.mock.calls[0][0]
      expect(updateCall.ai_summary).toBe('Great progress!')
      expect(updateCall.ai_response_draft).toBe('Draft message')
      expect(updateCall.ai_insights._version).toBe(3)
      expect(updateCall.status).toBe('ai_processed')
    })
  })

  describe('updateCheckInResponse', () => {
    it('updates coach response and sets reviewed status', async () => {
      const mockQuery = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: {}, error: null }),
      }

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const { updateCheckInResponse } = await import('./check-in-service')

      await updateCheckInResponse('check-in-123', 'Great work this week!')

      const updateCall = mockQuery.update.mock.calls[0][0]
      expect(updateCall.coach_response).toBe('Great work this week!')
      expect(updateCall.status).toBe('reviewed')
      expect(updateCall.coach_reviewed_at).toBeDefined()
    })
  })
})
