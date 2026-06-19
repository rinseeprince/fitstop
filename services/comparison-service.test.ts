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

vi.mock('./roadmap-service', () => ({
  getActiveRoadmap: vi.fn().mockResolvedValue(null),
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
import { getActiveRoadmap } from './roadmap-service'
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
    vi.mocked(getActiveRoadmap).mockResolvedValue(null as never)
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

  it('uses the active phase pair (weight + deadline) — no cross-scope unrealistic', async () => {
    // Session 7.8: while a phase is active it drives BOTH the goal weight and the
    // deadline. The old bug paired the client goal weight with the active plan's
    // deadline; here the single phase scope yields a realistic (on_track) pace.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-05T00:00:00Z'))
    try {
      vi.mocked(getBodyMetricsHistory).mockResolvedValue([])
      // A live client goal exists but MUST be ignored while a phase is active.
      vi.mocked(getCurrentGoals).mockResolvedValue({
        id: 'goal-1',
        clientId: 'client-1',
        goalWeight: 150,
        goalDeadline: '2026-06-20', // a soon (would-be-aggressive) client deadline
        setBy: 'coach',
        effectiveFrom: '2024-01-01T00:00:00Z',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      })
      vi.mocked(getActiveRoadmap).mockResolvedValue({
        id: 'rm-1',
        clientId: 'client-1',
        coachId: 'coach-1',
        name: 'Recomp',
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        phases: [
          {
            id: 'phase-1',
            roadmapId: 'rm-1',
            clientId: 'client-1',
            name: 'Cut',
            orderIndex: 0,
            status: 'active',
            startDate: '2026-05-01',
            endDate: '2026-12-01', // ~26 weeks out → realistic
            phaseGoalWeight: 75, // kg → ~165.4 lbs display
            phaseGoalBodyFatPercentage: 14,
            milestones: [],
            createdAt: '2026-05-01T00:00:00Z',
            updatedAt: '2026-05-01T00:00:00Z',
          },
        ],
      } as never)

      const result = await getCheckInComparison('ci-1')

      // Deadline + weight both come from the phase scope (not the client goal).
      expect(result.comparison.client.goalDeadline).toBe('2026-12-01')
      expect(result.comparison.client.goalWeight).toBe(165.4) // round(kgToLbs(75))
      // The phase pair gives a realistic pace — NOT the cross-scope "unrealistic".
      expect(result.goalProgress.weight?.paceStatus).toBe('on_track')
    } finally {
      vi.useRealTimers()
    }
  })

  it('imperial (lbs) client: the whole pace path runs in display units — no kg/lbs mixing', async () => {
    // Regression guard for the 7.8 rewire: resolveEffectiveGoal returns goalWeightKg
    // in KG, but comparison-service converts it BACK to display (weightFromKg) before
    // any math. This test runs the REAL calculateGoalProgress (computeGoalPace is
    // already un-mocked here) so the actual subtraction executes. A 75 kg phase goal
    // displays as ~165.4 lbs; against a 178 lb check-in, remaining = 165.4 - 178 =
    // -12.6 lb. If kg ever leaked into the pace math, remaining would be 75 - 178 =
    // -103 and the pace would falsely read "unrealistic".
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-05T00:00:00Z'))
    try {
      const actual = await vi.importActual<typeof import('@/utils/comparison-utils')>(
        '@/utils/comparison-utils'
      )
      vi.mocked(calculateGoalProgress).mockImplementation(actual.calculateGoalProgress)

      vi.mocked(getBodyMetricsHistory).mockResolvedValue([])
      vi.mocked(getCurrentGoals).mockResolvedValue(null) // phase drives
      vi.mocked(getActiveRoadmap).mockResolvedValue({
        id: 'rm-1',
        clientId: 'client-1',
        coachId: 'coach-1',
        name: 'Recomp',
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        phases: [
          {
            id: 'phase-1',
            roadmapId: 'rm-1',
            clientId: 'client-1',
            name: 'Cut',
            orderIndex: 0,
            status: 'active',
            startDate: '2026-05-01',
            endDate: '2026-12-01', // ~26 weeks out
            phaseGoalWeight: 75, // kg → ~165.4 lbs display
            phaseGoalBodyFatPercentage: null,
            milestones: [],
            createdAt: '2026-05-01T00:00:00Z',
            updatedAt: '2026-05-01T00:00:00Z',
          },
        ],
      } as never)

      const result = await getCheckInComparison('ci-1')
      const w = result.goalProgress.weight!

      expect(w.goal).toBeCloseTo(165.4, 1) // 75 kg in lbs, NOT raw 75
      expect(w.remaining).toBeCloseTo(-12.6, 1) // 165.4 - 178 (lbs), NOT 75 - 178 = -103
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
})
