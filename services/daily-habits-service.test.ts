import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the supabase-admin module
vi.mock('./supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

// Habit defaults resolve the client-local today through today-service.
vi.mock('./today-service', () => ({
  getClientTodayString: vi.fn().mockResolvedValue('2026-04-08'),
}))

import { supabaseAdmin } from './supabase-admin'
import { getClientTodayString } from './today-service'
import {
  calculateCompletionRate,
  calculateCurrentStreak,
  mapArrayIndexToSortOrder,
} from './daily-habits-logic'
import {
  getClientHabits,
  createHabit,
  getTodayHabitLogs,
} from './daily-habits-service'
import type { DailyHabitLog } from '@/types/daily-habit'

// Helper to create a chainable mock query
function createMockQuery(result: { data: unknown; error: unknown; count?: number }) {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: typeof result) => void) => Promise.resolve(result).then(resolve),
  }

  return mockQuery
}

// Mock habit log helper
function createMockHabitLog(overrides: Partial<DailyHabitLog> = {}): DailyHabitLog {
  return {
    id: 'log-123',
    dailyHabitId: 'habit-123',
    clientId: 'client-123',
    date: '2024-01-15',
    completed: true,
    value: undefined,
    notes: undefined,
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T10:00:00Z',
    ...overrides,
  }
}

describe('Daily Habits Service - Pure Functions', () => {
  describe('calculateCompletionRate', () => {
    it('returns 0 for no days', () => {
      const logs: DailyHabitLog[] = []
      expect(calculateCompletionRate(logs, 0)).toBe(0)
    })

    it('returns 0 for negative days', () => {
      const logs: DailyHabitLog[] = []
      expect(calculateCompletionRate(logs, -5)).toBe(0)
    })

    it('calculates 100% completion rate', () => {
      const logs = [
        createMockHabitLog({ date: '2024-01-01', completed: true }),
        createMockHabitLog({ date: '2024-01-02', completed: true }),
        createMockHabitLog({ date: '2024-01-03', completed: true }),
      ]
      expect(calculateCompletionRate(logs, 3)).toBe(100)
    })

    it('calculates partial completion rate', () => {
      const logs = [
        createMockHabitLog({ date: '2024-01-01', completed: true }),
        createMockHabitLog({ date: '2024-01-02', completed: false }),
        createMockHabitLog({ date: '2024-01-03', completed: true }),
      ]
      expect(calculateCompletionRate(logs, 3)).toBe(67) // 2/3 = 66.67% rounded to 67%
    })

    it('calculates 0% completion rate', () => {
      const logs = [
        createMockHabitLog({ date: '2024-01-01', completed: false }),
        createMockHabitLog({ date: '2024-01-02', completed: false }),
      ]
      expect(calculateCompletionRate(logs, 2)).toBe(0)
    })

    it('handles more days than logs', () => {
      const logs = [
        createMockHabitLog({ date: '2024-01-01', completed: true }),
      ]
      expect(calculateCompletionRate(logs, 5)).toBe(20) // 1/5 = 20%
    })
  })

  describe('calculateCurrentStreak', () => {
    const today = new Date('2024-01-07')

    it('returns 0 for empty logs', () => {
      expect(calculateCurrentStreak([], today)).toBe(0)
    })

    it('calculates streak when completed today', () => {
      const logs = [
        createMockHabitLog({ date: '2024-01-05', completed: true }),
        createMockHabitLog({ date: '2024-01-06', completed: true }),
        createMockHabitLog({ date: '2024-01-07', completed: true }),
      ]
      expect(calculateCurrentStreak(logs, today)).toBe(3)
    })

    it('calculates streak when not completed today', () => {
      const logs = [
        createMockHabitLog({ date: '2024-01-05', completed: true }),
        createMockHabitLog({ date: '2024-01-06', completed: true }),
        createMockHabitLog({ date: '2024-01-07', completed: false }),
      ]
      expect(calculateCurrentStreak(logs, today)).toBe(2)
    })

    it('returns 0 when streak is broken', () => {
      const logs = [
        createMockHabitLog({ date: '2024-01-04', completed: true }),
        createMockHabitLog({ date: '2024-01-05', completed: true }),
        // Gap on 2024-01-06 (no log)
        // Today is 2024-01-07 (no log)
      ]
      expect(calculateCurrentStreak(logs, today)).toBe(0)
    })

    it('handles logs in random order', () => {
      const logs = [
        createMockHabitLog({ date: '2024-01-07', completed: true }),
        createMockHabitLog({ date: '2024-01-05', completed: true }),
        createMockHabitLog({ date: '2024-01-06', completed: true }),
      ]
      expect(calculateCurrentStreak(logs, today)).toBe(3)
    })
  })

  describe('mapArrayIndexToSortOrder', () => {
    it('maps empty array', () => {
      expect(mapArrayIndexToSortOrder([])).toEqual([])
    })

    it('maps single habit', () => {
      const result = mapArrayIndexToSortOrder(['habit-1'])
      expect(result).toEqual([{ id: 'habit-1', sortOrder: 0 }])
    })

    it('maps multiple habits in order', () => {
      const result = mapArrayIndexToSortOrder(['habit-1', 'habit-2', 'habit-3'])
      expect(result).toEqual([
        { id: 'habit-1', sortOrder: 0 },
        { id: 'habit-2', sortOrder: 1 },
        { id: 'habit-3', sortOrder: 2 },
      ])
    })
  })
})

describe('Daily Habits Service - Database Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getClientHabits', () => {
    it('fetches and transforms client habits', async () => {
      const mockData = [{
        id: 'habit-123',
        coach_id: 'coach-456',
        client_id: 'client-789',
        name: 'Drink Water',
        description: 'Drink 8 glasses of water',
        target_value: 8,
        target_unit: 'glasses',
        is_boolean: false,
        is_active: true,
        sort_order: 0,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }]

      const mockQuery = createMockQuery({ data: mockData, error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never)

      const result = await getClientHabits('client-789')

      expect(supabaseAdmin.from).toHaveBeenCalledWith('daily_habits')
      expect(mockQuery.eq).toHaveBeenCalledWith('client_id', 'client-789')
      expect(mockQuery.eq).toHaveBeenCalledWith('is_active', true)
      expect(mockQuery.order).toHaveBeenCalledWith('sort_order', { ascending: true })
      
      expect(result).toEqual([{
        id: 'habit-123',
        coachId: 'coach-456',
        clientId: 'client-789',
        name: 'Drink Water',
        description: 'Drink 8 glasses of water',
        targetValue: 8,
        targetUnit: 'glasses',
        isBoolean: false,
        isActive: true,
        sortOrder: 0,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }])
    })
  })

  describe('getTodayHabitLogs', () => {
    it("defaults the query date to the CLIENT's local today, not the host clock", async () => {
      const mockQuery = createMockQuery({ data: [], error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never)

      await getTodayHabitLogs('client-789')

      // '2026-04-08' is the mocked client-local today — any regression to a
      // host-clock default fails these exact-match assertions.
      expect(getClientTodayString).toHaveBeenCalledWith('client-789')
      expect(mockQuery.eq).toHaveBeenCalledWith('date', '2026-04-08')
    })

    it('does not resolve a today when an explicit date is given', async () => {
      const mockQuery = createMockQuery({ data: [], error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never)

      await getTodayHabitLogs('client-789', '2026-03-01')

      expect(getClientTodayString).not.toHaveBeenCalled()
      expect(mockQuery.eq).toHaveBeenCalledWith('date', '2026-03-01')
    })
  })

  describe('createHabit', () => {
    it("defaults effective_date to the CLIENT's local today", async () => {
      const clientQuery = createMockQuery({
        data: { coach_id: 'coach-1' },
        error: null,
      })
      // daily_habits queries, in call order: inactive-name check (miss),
      // next-sort-order lookup (none), then the insert itself.
      const noInactiveQuery = createMockQuery({
        data: null,
        error: { message: 'No rows found' },
      })
      const sortOrderQuery = createMockQuery({ data: null, error: null })
      const insertQuery = createMockQuery({
        data: {
          id: 'habit-1',
          client_id: 'client-789',
          name: 'Walk',
          is_boolean: true,
          is_active: true,
          sort_order: 0,
          effective_date: '2026-04-08',
          created_at: '2026-04-08T00:00:00Z',
          updated_at: '2026-04-08T00:00:00Z',
        },
        error: null,
      })

      let habitCalls = 0
      vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
        if (table === 'clients') return clientQuery as never
        habitCalls++
        if (habitCalls === 1) return noInactiveQuery as never
        if (habitCalls === 2) return sortOrderQuery as never
        return insertQuery as never
      }) as never)

      await createHabit('coach-1', 'client-789', { name: 'Walk', isBoolean: true })

      expect(getClientTodayString).toHaveBeenCalledWith('client-789')
      expect(insertQuery.insert).toHaveBeenCalledWith(
        expect.objectContaining({ effective_date: '2026-04-08' }),
      )
    })
  })
})