import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  generateCheckInToken,
} from './check-in-service'

// Mock the supabase-admin module
vi.mock('./supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { supabaseAdmin } from './supabase-admin'

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

  describe('generateCheckInToken', () => {
    it('generates a 64-character token', () => {
      const token = generateCheckInToken()
      expect(token).toHaveLength(64)
    })

    it('generates unique tokens', () => {
      const token1 = generateCheckInToken()
      const token2 = generateCheckInToken()
      expect(token1).not.toBe(token2)
    })

    it('generates alphanumeric tokens', () => {
      const token = generateCheckInToken()
      expect(token).toMatch(/^[a-f0-9]+$/i)
    })
  })

  describe('createCheckInToken', () => {
    it('creates a token and returns it with expiry', async () => {
      const mockToken = 'abc123def456'
      const mockExpiresAt = new Date()
      mockExpiresAt.setDate(mockExpiresAt.getDate() + 7)

      const mockQuery = createMockQuery({
        data: {
          token: mockToken,
          expires_at: mockExpiresAt.toISOString(),
        },
        error: null,
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      // Dynamically import to get the mocked version
      const { createCheckInToken } = await import('./check-in-service')
      const result = await createCheckInToken('client-123')

      expect(result.token).toBe(mockToken)
      expect(result.expiresAt).toBe(mockExpiresAt.toISOString())
      expect(supabaseAdmin.from).toHaveBeenCalledWith('check_in_tokens')
    })

    it('throws error when creation fails', async () => {
      const mockQuery = createMockQuery({
        data: null,
        error: { message: 'Database error' },
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const { createCheckInToken } = await import('./check-in-service')

      await expect(createCheckInToken('client-123')).rejects.toThrow(
        'Failed to create check-in token: Database error'
      )
    })
  })

  describe('validateCheckInToken', () => {
    it('returns valid for unexpired, unused token', async () => {
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 3)

      const mockQuery = createMockQuery({
        data: {
          id: 'token-id',
          client_id: 'client-123',
          expires_at: futureDate.toISOString(),
          used_at: null,
        },
        error: null,
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const { validateCheckInToken } = await import('./check-in-service')
      const result = await validateCheckInToken('valid-token')

      expect(result.valid).toBe(true)
      expect(result.clientId).toBe('client-123')
      expect(result.tokenId).toBe('token-id')
    })

    it('returns invalid for expired token', async () => {
      const pastDate = new Date()
      pastDate.setDate(pastDate.getDate() - 1)

      const mockQuery = createMockQuery({
        data: {
          id: 'token-id',
          client_id: 'client-123',
          expires_at: pastDate.toISOString(),
          used_at: null,
        },
        error: null,
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const { validateCheckInToken } = await import('./check-in-service')
      const result = await validateCheckInToken('expired-token')

      expect(result.valid).toBe(false)
      expect(result.clientId).toBeUndefined()
    })

    it('returns invalid for used token', async () => {
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 3)

      const mockQuery = createMockQuery({
        data: {
          id: 'token-id',
          client_id: 'client-123',
          expires_at: futureDate.toISOString(),
          used_at: new Date().toISOString(),
        },
        error: null,
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const { validateCheckInToken } = await import('./check-in-service')
      const result = await validateCheckInToken('used-token')

      expect(result.valid).toBe(false)
    })

    it('returns invalid for non-existent token', async () => {
      const mockQuery = createMockQuery({
        data: null,
        error: { message: 'Not found' },
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const { validateCheckInToken } = await import('./check-in-service')
      const result = await validateCheckInToken('nonexistent-token')

      expect(result.valid).toBe(false)
    })
  })

  describe('markTokenAsUsed', () => {
    it('marks token as used successfully', async () => {
      const mockQuery = createMockQuery({
        data: {},
        error: null,
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const { markTokenAsUsed } = await import('./check-in-service')

      await expect(markTokenAsUsed('token-id', 'check-in-id')).resolves.not.toThrow()
      expect(mockQuery.update).toHaveBeenCalled()
      expect(mockQuery.eq).toHaveBeenCalledWith('id', 'token-id')
    })

    it('throws error on failure', async () => {
      const mockQuery = createMockQuery({
        data: null,
        error: { message: 'Update failed' },
      })
      // Override single to return error
      mockQuery.eq = vi.fn().mockResolvedValue({ data: null, error: { message: 'Update failed' } })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const { markTokenAsUsed } = await import('./check-in-service')

      await expect(markTokenAsUsed('token-id', 'check-in-id')).rejects.toThrow(
        'Failed to mark token as used'
      )
    })
  })

  describe('submitCheckIn', () => {
    it('submits a basic check-in successfully', async () => {
      const mockInsertQuery = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'new-check-in-id' },
          error: null,
        }),
      }

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockInsertQuery as any)

      const { submitCheckIn } = await import('./check-in-service')
      const result = await submitCheckIn('client-123', {
        mood: 4,
        energy: 7,
        sleep: 8,
        stress: 3,
        weight: 180,
        weightUnit: 'lbs',
      })

      expect(result).toBe('new-check-in-id')
      expect(supabaseAdmin.from).toHaveBeenCalledWith('check_ins')
    })

    it('calculates adherence from nutrition days on target', async () => {
      const mockInsertQuery = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'check-in-id' },
          error: null,
        }),
      }

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockInsertQuery as any)

      const { submitCheckIn } = await import('./check-in-service')
      await submitCheckIn('client-123', {
        nutritionAdherence: {
          daysOnTarget: 5,
        },
      })

      // With 5 days on target out of 7, adherence should be ~71%
      expect(mockInsertQuery.insert).toHaveBeenCalled()
    })

    it('throws error when submission fails', async () => {
      const mockInsertQuery = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Insert failed' },
        }),
      }

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockInsertQuery as any)

      const { submitCheckIn } = await import('./check-in-service')

      await expect(submitCheckIn('client-123', { mood: 4 })).rejects.toThrow(
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

  describe('enrichWithDailyLogCounts (via getClientCheckIns includeDailyLogCounts)', () => {
    // Returns a chainable mock that resolves to `result` and records nothing.
    function chainable(result: unknown) {
      const m: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'gte', 'lte', 'or', 'order', 'limit', 'range']) {
        m[k] = vi.fn().mockReturnValue(m)
      }
      m.then = (resolve: (v: unknown) => void) => Promise.resolve(result).then(resolve)
      return m
    }

    it('counts logs per period with ONE daily_logs query (not one per check-in)', async () => {
      const checkInRows = [
        { id: 'a1111111-1111-4111-8111-111111111111', client_id: 'c', status: 'reviewed', created_at: '2024-01-15T12:00:00Z', updated_at: '2024-01-15T12:00:00Z' },
        { id: 'a2222222-2222-4222-8222-222222222222', client_id: 'c', status: 'reviewed', created_at: '2024-01-08T12:00:00Z', updated_at: '2024-01-08T12:00:00Z' },
        { id: 'a3333333-3333-4333-8333-333333333333', client_id: 'c', status: 'reviewed', created_at: '2024-01-01T12:00:00Z', updated_at: '2024-01-01T12:00:00Z' },
      ]
      // Periods (newest first): [01-09,01-15], [01-02,01-08], [2023-12-26,2024-01-01].
      const dailyLogDates = [
        { date: '2024-01-15' }, { date: '2024-01-14' }, { date: '2024-01-10' }, // → period 0 (3)
        { date: '2024-01-05' },                                                  // → period 1 (1)
        { date: '2023-12-28' }, { date: '2023-12-26' },                          // → period 2 (2)
      ]

      let dailyLogsCalls = 0
      vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
        if (table === 'daily_logs') {
          dailyLogsCalls++
          return chainable({ data: dailyLogDates, error: null }) as any
        }
        return chainable({ data: checkInRows, error: null, count: 3 }) as any
      }) as any)

      const { getClientCheckIns } = await import('./check-in-service')
      const result = await getClientCheckIns('c', { includeDailyLogCounts: true })

      expect(dailyLogsCalls).toBe(1) // single bucketed query, not N
      const enriched = result.checkIns as Array<{ dailyLogsCount: number; expectedDays: number }>
      expect(enriched.map((c) => c.dailyLogsCount)).toEqual([3, 1, 2])
      expect(enriched.map((c) => c.expectedDays)).toEqual([7, 7, 7])
    })

    it('handles same-day check-ins: inverted period counts 0, no double-count', async () => {
      const checkInRows = [
        { id: 'b1111111-1111-4111-8111-111111111111', client_id: 'c', status: 'reviewed', created_at: '2024-01-15T14:00:00Z', updated_at: '2024-01-15T14:00:00Z' },
        { id: 'b2222222-2222-4222-8222-222222222222', client_id: 'c', status: 'reviewed', created_at: '2024-01-15T09:00:00Z', updated_at: '2024-01-15T09:00:00Z' },
      ]
      // period 0 (newer): start = 01-15 + 1 = 01-16, end = 01-15 → inverted → 0.
      // period 1 (older): start = 01-15 - 6 = 01-09, end = 01-15 → counts both logs.
      const dailyLogDates = [{ date: '2024-01-15' }, { date: '2024-01-12' }]

      vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) =>
        table === 'daily_logs'
          ? (chainable({ data: dailyLogDates, error: null }) as any)
          : (chainable({ data: checkInRows, error: null, count: 2 }) as any)) as any)

      const { getClientCheckIns } = await import('./check-in-service')
      const result = await getClientCheckIns('c', { includeDailyLogCounts: true })

      const enriched = result.checkIns as Array<{ dailyLogsCount: number; expectedDays: number }>
      expect(enriched.map((c) => c.dailyLogsCount)).toEqual([0, 2])
      expect(enriched.map((c) => c.expectedDays)).toEqual([1, 7])
    })
  })

  describe('updateCheckInStatus', () => {
    it('updates status successfully', async () => {
      const mockQuery = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: {}, error: null }),
      }

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const { updateCheckInStatus } = await import('./check-in-service')

      await expect(updateCheckInStatus('check-in-123', 'reviewed')).resolves.not.toThrow()
      expect(mockQuery.update).toHaveBeenCalledWith({ status: 'reviewed' })
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
          insights: [{ type: 'strength', text: 'Good sleep' }],
          recommendations: [{ priority: 'high', text: 'Keep it up' }],
          responseDraft: 'Draft response',
        }
      )

      expect(mockQuery.update).toHaveBeenCalled()
      const updateCall = mockQuery.update.mock.calls[0][0]
      expect(updateCall.ai_summary).toBe('Great progress!')
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
