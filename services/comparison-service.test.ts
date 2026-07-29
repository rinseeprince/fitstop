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
            lte: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
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

vi.mock('./client-phases-service', () => ({
  getClientPhases: vi.fn().mockResolvedValue([]),
}))

// Client-local today is resolved through today-service by downstream reads.
vi.mock('./today-service', () => ({
  getClientTodayString: vi.fn().mockResolvedValue('2026-01-15'),
}))

// Passthrough spy: real resolver behavior, observable arguments.
const { resolveEffectiveGoalSpy } = vi.hoisted(() => ({
  resolveEffectiveGoalSpy: vi.fn(),
}))
vi.mock('@/lib/goals/resolve-effective-goal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/goals/resolve-effective-goal')>()
  resolveEffectiveGoalSpy.mockImplementation(actual.resolveEffectiveGoal)
  return { resolveEffectiveGoal: resolveEffectiveGoalSpy }
})

import { getCheckInById, getClientCheckIns } from './check-in-service'
import { getClientById } from './client-service'
import { getBodyMetricsHistory } from './body-metrics-service'
import { getCurrentGoals } from './client-goals-service'
import { getClientPhases } from './client-phases-service'
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

  it('imperial (lbs) client: the whole pace path runs in display units — no kg/lbs mixing', async () => {
    // Regression guard for the 7.8 rewire: resolveEffectiveGoal returns goalWeightKg
    // in KG (normalized from the display-unit client goal), but comparison-service
    // converts it BACK to display (weightFromKg) before any math. This test runs the
    // REAL calculateGoalProgress (computeGoalPace is already un-mocked here) so the
    // actual subtraction executes. A 165.4 lb client goal round-trips through kg;
    // against a 178 lb check-in, remaining = 165.4 - 178 = -12.6 lb. If kg ever
    // leaked into the pace math, remaining would read ~-103 and the pace would
    // falsely read "unrealistic".
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-05T00:00:00Z'))
    try {
      const actual = await vi.importActual<typeof import('@/utils/comparison-utils')>(
        '@/utils/comparison-utils'
      )
      vi.mocked(calculateGoalProgress).mockImplementation(actual.calculateGoalProgress)

      vi.mocked(getBodyMetricsHistory).mockResolvedValue([])
      vi.mocked(getCurrentGoals).mockResolvedValue({
        id: 'goal-1',
        clientId: 'client-1',
        goalWeight: 165.4, // lbs (display units) → normalized to kg and back
        goalDeadline: '2026-12-01', // ~26 weeks out
        setBy: 'coach',
        effectiveFrom: '2024-01-01T00:00:00Z',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      } as never)

      const result = await getCheckInComparison('ci-1')
      const w = result.goalProgress.weight!

      expect(w.goal).toBeCloseTo(165.4, 1) // display units, NOT raw kg
      expect(w.remaining).toBeCloseTo(-12.6, 1) // 165.4 - 178 (lbs)
      expect(w.unit).toBe('lbs')
      // Display-unit pace is sensible; a kg/lbs mix would falsely read "unrealistic".
      expect(w.paceStatus).toBe('on_track')
    } finally {
      vi.useRealTimers()
    }
  })

  it("passes the CLIENT's local today to resolveEffectiveGoal (Kiritimati boundary)", async () => {
    // UTC+14: at 12:00 UTC June 9 the client is already on June 10. Suite is
    // pinned to TZ=UTC, so a regression to the server clock fails anywhere.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-06-09T12:00:00Z'))
      vi.mocked(getClientById).mockResolvedValue({
        ...mockClient,
        timezone: 'Pacific/Kiritimati',
      } as never)
      vi.mocked(getBodyMetricsHistory).mockResolvedValue([])
      vi.mocked(getCurrentGoals).mockResolvedValue(null)

      await getCheckInComparison('ci-1')

      expect(resolveEffectiveGoalSpy).toHaveBeenCalledWith(
        expect.objectContaining({ today: '2026-06-10' }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it("anchors daysRemaining to the client's local day, not the server clock (west-of-UTC boundary)", async () => {
    // UTC has already rolled to 2026-06-18, but a UTC-11 client is still on
    // 2026-06-17. A deadline of their local today reads 0 days remaining, not
    // -1 (the old Date.now() ms-math bug across the UTC day boundary).
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-06-18T00:30:00Z'))
      vi.mocked(getClientById).mockResolvedValue({
        ...mockClient,
        timezone: 'Pacific/Niue',
      } as never)
      vi.mocked(getBodyMetricsHistory).mockResolvedValue([])
      vi.mocked(getCurrentGoals).mockResolvedValue({
        id: 'goal-1',
        clientId: 'client-1',
        goalWeight: 170,
        goalDeadline: '2026-06-17',
        setBy: 'coach',
        effectiveFrom: '2024-01-01T00:00:00Z',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      } as never)

      const result = await getCheckInComparison('ci-1')

      expect(result.goalProgress.deadline?.daysRemaining).toBe(0)
      expect(result.goalProgress.deadline?.isPastDeadline).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it("resolves against the period this check-in REPORTS ON, not today", async () => {
    // The anchor that matters: a check-in reviewed late must be graded against
    // the block that was running while the client lived it.
    vi.mocked(getCheckInById).mockResolvedValue({
      ...mockCheckIn,
      periodEnd: '2026-03-20',
    } as never)
    vi.mocked(getBodyMetricsHistory).mockResolvedValue([])
    vi.mocked(getCurrentGoals).mockResolvedValue(null)

    await getCheckInComparison('ci-1')

    const call = resolveEffectiveGoalSpy.mock.calls[0][0]
    expect(call.date).toBe('2026-03-20')
    // The discriminating half: the anchor is the PERIOD, not today. `today` is
    // the real client-local day here (comparison-service reads the clock
    // directly via getTodayDateStringInTimezone, not the mocked today-service).
    expect(call.date).not.toBe(call.today)
  })

  it('falls back to the client-local today when the check-in has no periodEnd', async () => {
    // periodEnd is optional on the legacy token flow.
    vi.mocked(getCheckInById).mockResolvedValue({ ...mockCheckIn } as never)
    vi.mocked(getBodyMetricsHistory).mockResolvedValue([])
    vi.mocked(getCurrentGoals).mockResolvedValue(null)

    await getCheckInComparison('ci-1')

    const call = resolveEffectiveGoalSpy.mock.calls[0][0]
    expect(call.date).toBe(call.today)
  })

  it("the covering block's rate becomes the pace requirement, in DISPLAY units", async () => {
    // The client is imperial. Deadline math alone would demand 8 lbs over ~10
    // days = 5.6 lbs/wk against a 1.78 ceiling -> unrealistic. The block
    // prescribes 0.5 kg/wk, which must arrive as 1.1 LBS/wk, not a bare 0.5.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
      vi.mocked(getCheckInById).mockResolvedValue({
        ...mockCheckIn,
        periodEnd: '2026-01-14',
      } as never)
      vi.mocked(getClientPhases).mockResolvedValue([
        {
          id: 'phase-1',
          name: 'Cut 1',
          startsOn: '2026-01-01',
          endsOn: '2026-02-28',
          ratePerWeekKg: -0.5,
          dailyTargets: null,
        },
      ] as never)
      vi.mocked(getBodyMetricsHistory).mockResolvedValue([])
      vi.mocked(getCurrentGoals).mockResolvedValue({
        id: 'goal-1',
        clientId: 'client-1',
        goalWeight: 170,
        goalDeadline: '2026-01-25',
        setBy: 'coach',
        effectiveFrom: '2024-01-01T00:00:00Z',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      } as never)

      const result = await getCheckInComparison('ci-1')

      expect(resolveEffectiveGoalSpy).toHaveBeenCalledWith(
        expect.objectContaining({ date: '2026-01-14' }),
      )
      // 0.5 kg/wk -> 1.10 lbs/wk. A regression that forwards the kg value
      // straight through reads 0.5 here and still grades on_track, so the
      // NUMBER is the assertion that catches it, not the status.
      expect(result.goalProgress.weight?.requiredRate).toBe(1.1)
      expect(result.goalProgress.weight?.paceStatus).toBe('on_track')
    } finally {
      vi.useRealTimers()
    }
  })
})
