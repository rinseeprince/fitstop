import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./check-in-service', () => ({
  getCheckInById: vi.fn(),
  getPreviousCheckIn: vi.fn().mockResolvedValue(null),
  getClientCheckIns: vi.fn().mockResolvedValue({ checkIns: [] }),
  getFirstCheckIn: vi.fn().mockResolvedValue(null),
}))

vi.mock('./client-service', () => ({
  getClientById: vi.fn(),
}))

vi.mock('./supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null }),
              }),
            }),
          }),
          single: vi.fn().mockResolvedValue({ data: { goal_deadline: null } }),
        }),
      }),
    }),
  },
}))

vi.mock('@/lib/check-in-utils', () => ({
  prepareChartData: vi.fn().mockReturnValue([]),
}))

vi.mock('@/utils/comparison-utils', () => ({
  calculateMetricChange: vi.fn().mockReturnValue(undefined),
  calculateDaysBetween: vi.fn().mockReturnValue(7),
  calculateGoalProgress: vi.fn().mockReturnValue({
    remaining: 5,
    percentComplete: 50,
    isOnTrack: true,
    weeksToGoal: 10,
  }),
}))

vi.mock('./body-metrics-service', () => ({
  getBodyMetricsHistory: vi.fn(),
}))

vi.mock('./client-goals-service', () => ({
  getCurrentGoals: vi.fn(),
}))

import { getCheckInById, getClientCheckIns } from './check-in-service'
import { getClientById } from './client-service'
import { getBodyMetricsHistory } from './body-metrics-service'
import { getCurrentGoals } from './client-goals-service'
import { calculateGoalProgress } from '@/utils/comparison-utils'
import { getCheckInComparison } from './comparison-service'

const mockCheckIn = {
  id: 'ci-1',
  clientId: 'client-1',
  weight: 178,
  weightUnit: 'lbs',
  bodyFatPercentage: 19,
  createdAt: '2024-02-01T00:00:00Z',
  mood: 4,
  energy: 7,
  sleep: 7,
  stress: 3,
}

const mockClient = {
  id: 'client-1',
  coachId: 'coach-1',
  name: 'Test Client',
  currentWeight: 180,
  weightUnit: 'lbs' as const,
  currentBodyFatPercentage: 20,
  goalWeight: 170,
  goalBodyFatPercentage: 15,
  startingWeight: 190,
  startingBodyFatPercentage: 22,
  unitPreference: 'imperial' as const,
}

describe('Comparison Service - read-switch behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCheckInById).mockResolvedValue(mockCheckIn as never)
    vi.mocked(getClientById).mockResolvedValue(mockClient as never)
    vi.mocked(getClientCheckIns).mockResolvedValue({ checkIns: [mockCheckIn] } as never)
  })

  it('reads goals from client_goals service', async () => {
    vi.mocked(getBodyMetricsHistory).mockResolvedValue([])
    vi.mocked(getCurrentGoals).mockResolvedValue({
      id: 'goal-1',
      clientId: 'client-1',
      goalWeight: 165,
      goalBodyFatPercentage: 12,
      setBy: 'coach',
      effectiveFrom: '2024-01-01T00:00:00Z',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    })

    const result = await getCheckInComparison('ci-1')

    // comparison.client should use goals service values
    expect(result.comparison.client.goalWeight).toBe(165)
    expect(result.comparison.client.goalBodyFatPercentage).toBe(12)

    // goalProgress weight call should use goals service goalWeight (165)
    expect(calculateGoalProgress).toHaveBeenCalledWith(
      178, // currentCheckIn.weight
      165, // goalWeight from service
      190, // earliestWeight falls back to client.startingWeight (empty body_metrics)
      undefined // avgWeeklyWeightChange (only 1 check-in)
    )
  })

  it('reads starting weight from earliest body_metrics row', async () => {
    vi.mocked(getBodyMetricsHistory).mockResolvedValue([
      {
        id: 'bm-earliest',
        clientId: 'client-1',
        weight: 195,
        bodyFatPercentage: 24,
        source: 'intake_sync' as const,
        recordedAt: '2023-06-01T00:00:00Z',
        createdAt: '2023-06-01T00:00:00Z',
      },
    ])
    vi.mocked(getCurrentGoals).mockResolvedValue({
      id: 'goal-1',
      clientId: 'client-1',
      goalWeight: 165,
      goalBodyFatPercentage: 12,
      setBy: 'coach',
      effectiveFrom: '2024-01-01T00:00:00Z',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    })

    await getCheckInComparison('ci-1')

    // Should use earliest body_metrics weight (195) as starting weight
    expect(getBodyMetricsHistory).toHaveBeenCalledWith('client-1', {
      limit: 1,
      ascending: true,
    })

    // calculateGoalProgress should be called with startingWeight = 195 (from earliest body_metrics)
    expect(calculateGoalProgress).toHaveBeenCalledWith(
      178, // currentCheckIn.weight
      165, // goalWeight from service
      195, // starting weight from earliest body_metrics
      undefined // avgWeeklyWeightChange (only 1 check-in)
    )
  })

  it('falls back to client fields when services return null', async () => {
    vi.mocked(getBodyMetricsHistory).mockResolvedValue([])
    vi.mocked(getCurrentGoals).mockResolvedValue(null)

    const result = await getCheckInComparison('ci-1')

    // Should fall back to client.goalWeight (170)
    expect(result.comparison.client.goalWeight).toBe(170)
    expect(result.comparison.client.goalBodyFatPercentage).toBe(15)

    // startingWeight should fall back to client.startingWeight (190)
    expect(calculateGoalProgress).toHaveBeenCalledWith(
      178, // currentCheckIn.weight
      170, // client.goalWeight fallback
      190, // client.startingWeight fallback
      undefined // avgWeeklyWeightChange (only 1 check-in)
    )
  })
})
