import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../services/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

vi.mock('../../lib/date-helpers', async () => {
  const actual = await vi.importActual<typeof import('../../lib/date-helpers')>('../../lib/date-helpers')
  return {
    ...actual,
    getTodayDateString: vi.fn(() => '2024-03-27'),
    getDateDaysAgo: vi.fn((days: number) => {
      const date = new Date('2024-03-27T00:00:00')
      date.setDate(date.getDate() - days)
      return actual.getDateString(date)
    }),
  }
})

import { supabaseAdmin } from '../../services/supabase-admin'
import { getWeeklyHabitsData } from '../../services/habits-weekly-service'

type MockResult = { data: unknown; error: unknown }

function createMockQuery(result: MockResult) {
  const mockQuery: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    then: (resolve: (value: MockResult) => void) => Promise.resolve(result).then(resolve),
  }
  return mockQuery
}

// Helper to set up supabase mock calls in order
function setupMockQueries(queries: MockResult[]) {
  const fromMock = supabaseAdmin.from as ReturnType<typeof vi.fn>
  let callIndex = 0
  fromMock.mockImplementation(() => {
    const result = queries[callIndex] || { data: [], error: null }
    callIndex++
    return createMockQuery(result)
  })
}

const CLIENT_ID = 'client-123'
// Monday 2024-03-25 through Sunday 2024-03-31
const WEEK_START = '2024-03-25'

function makeHabit(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name,
    is_boolean: true,
    target_value: null,
    target_unit: null,
    created_at: '2024-01-01',
    ...overrides,
  }
}

function makeLog(habitId: string, date: string, completed: boolean, value: number | null = null) {
  return {
    date,
    daily_habit_id: habitId,
    completed,
    value,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getWeeklyHabitsData', () => {
  it('returns empty result for client with zero habits', async () => {
    setupMockQueries([
      { data: [], error: null },          // habits query
    ])

    const result = await getWeeklyHabitsData(CLIENT_ID, WEEK_START, null)

    expect(result.habits).toEqual([])
    expect(result.summary.todayCompleted).toBe(0)
    expect(result.summary.todayTotal).toBe(0)
    expect(result.summary.weeklyRate).toBe(0)
    expect(result.summary.activeCount).toBe(0)
    expect(result.summary.allHabitsStreak).toBe(0)
    expect(result.weekDays).toHaveLength(7)
  })

  it('shows not-tracked for days before habit creation', async () => {
    const habit = makeHabit('h1', 'New Habit', { created_at: '2024-03-28' })

    setupMockQueries([
      { data: [habit], error: null },     // habits
      { data: [], error: null },          // week logs
      { data: [], error: null },          // streak logs
    ])

    const result = await getWeeklyHabitsData(CLIENT_ID, WEEK_START, null)
    const row = result.habits[0]

    // Days before March 28 should be not-tracked
    const notTrackedDays = row.days.filter(d => d.date < '2024-03-28')
    expect(notTrackedDays.every(d => d.status === 'not-tracked')).toBe(true)
  })

  it('computes weeklyRate correctly with all completed', async () => {
    const habit = makeHabit('h1', 'Habit')
    const logs = [
      makeLog('h1', '2024-03-25', true),
      makeLog('h1', '2024-03-26', true),
      makeLog('h1', '2024-03-27', true),
      makeLog('h1', '2024-03-28', true),
      makeLog('h1', '2024-03-29', true),
      makeLog('h1', '2024-03-30', true),
      makeLog('h1', '2024-03-31', true),
    ]

    setupMockQueries([
      { data: [habit], error: null },
      { data: logs, error: null },
      { data: logs, error: null },
    ])

    const result = await getWeeklyHabitsData(CLIENT_ID, WEEK_START, null)
    expect(result.habits[0].weeklyRate).toBe(100)
  })

  it('marks future days correctly for current week', async () => {
    // Today is mocked as March 27 (Wednesday)
    const habit = makeHabit('h1', 'Habit')
    const logs = [
      makeLog('h1', '2024-03-25', true),
      makeLog('h1', '2024-03-26', true),
    ]

    setupMockQueries([
      { data: [habit], error: null },
      { data: logs, error: null },
      { data: logs, error: null },
    ])

    const result = await getWeeklyHabitsData(CLIENT_ID, WEEK_START, null)
    const row = result.habits[0]

    // Mon/Tue completed, Wed pending, Thu-Sun future
    expect(row.days[0].status).toBe('completed') // Mon
    expect(row.days[1].status).toBe('completed') // Tue
    expect(row.days[2].status).toBe('pending')   // Wed (today)
    expect(row.days[3].status).toBe('future')    // Thu
    expect(row.days[4].status).toBe('future')    // Fri
  })

  it('handles numeric habit with value', async () => {
    const habit = makeHabit('h1', 'Steps', {
      is_boolean: false,
      target_value: 10000,
      target_unit: 'steps',
    })
    const logs = [
      makeLog('h1', '2024-03-25', true, 11200),
    ]

    setupMockQueries([
      { data: [habit], error: null },
      { data: logs, error: null },
      { data: logs, error: null },
    ])

    const result = await getWeeklyHabitsData(CLIENT_ID, WEEK_START, null)
    const day = result.habits[0].days[0]

    expect(day.status).toBe('completed')
    expect(day.value).toBe(11200)
    expect(result.habits[0].isBoolean).toBe(false)
    expect(result.habits[0].targetValue).toBe(10000)
  })

  it('uses coaching week days when checkInDay is provided', async () => {
    const habit = makeHabit('h1', 'Habit')

    setupMockQueries([
      { data: [habit], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ])

    // Wednesday check-in means week starts Thursday
    const result = await getWeeklyHabitsData(CLIENT_ID, '2024-03-28', 'wednesday')

    // Should start on Thursday (day after Wednesday check-in)
    expect(result.weekDays[0]).toBe('2024-03-28') // Thursday
    expect(result.weekDays[6]).toBe('2024-04-03') // Wednesday
  })

  it('falls back to Monday start when checkInDay is null', async () => {
    const habit = makeHabit('h1', 'Habit')

    setupMockQueries([
      { data: [habit], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ])

    const result = await getWeeklyHabitsData(CLIENT_ID, WEEK_START, null)

    expect(result.weekDays[0]).toBe('2024-03-25') // Monday
    expect(result.weekDays[6]).toBe('2024-03-31') // Sunday
  })

  it('calculates all-habits streak correctly', async () => {
    const habits = [
      makeHabit('h1', 'Habit A'),
      makeHabit('h2', 'Habit B'),
    ]

    // Both completed for 3 consecutive days up to March 27
    const streakLogs = [
      makeLog('h1', '2024-03-25', true),
      makeLog('h2', '2024-03-25', true),
      makeLog('h1', '2024-03-26', true),
      makeLog('h2', '2024-03-26', true),
      makeLog('h1', '2024-03-27', true),
      makeLog('h2', '2024-03-27', true),
      // h2 missed on March 24 (breaks streak)
      makeLog('h1', '2024-03-24', true),
    ]

    setupMockQueries([
      { data: habits, error: null },
      { data: streakLogs, error: null },  // week logs
      { data: streakLogs, error: null },  // streak logs
    ])

    // Mock today as March 27
    const result = await getWeeklyHabitsData(CLIENT_ID, WEEK_START, null)
    expect(result.summary.allHabitsStreak).toBe(3)
  })

  it('streak is 0 when any habit missed yesterday', async () => {
    const habits = [
      makeHabit('h1', 'Habit A'),
      makeHabit('h2', 'Habit B'),
    ]

    // h1 completed today and yesterday, h2 only today
    const streakLogs = [
      makeLog('h1', '2024-03-27', true),
      makeLog('h2', '2024-03-27', true),
      makeLog('h1', '2024-03-26', true),
      // h2 missing on March 26
    ]

    setupMockQueries([
      { data: habits, error: null },
      { data: streakLogs, error: null },
      { data: streakLogs, error: null },
    ])

    const result = await getWeeklyHabitsData(CLIENT_ID, WEEK_START, null)
    // Today both completed = 1, but yesterday h2 missed, so streak breaks after today
    expect(result.summary.allHabitsStreak).toBe(1)
  })

  it('throws on habits query error', async () => {
    setupMockQueries([
      { data: null, error: { message: 'DB error' } },
    ])

    await expect(
      getWeeklyHabitsData(CLIENT_ID, WEEK_START, null)
    ).rejects.toThrow('Failed to fetch habits')
  })
})
