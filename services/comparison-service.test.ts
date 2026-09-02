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

vi.mock('@/utils/comparison-utils', () => ({
  calculateMetricChange: vi.fn().mockReturnValue(undefined),
  calculateDaysBetween: vi.fn().mockReturnValue(7),
  calculateGoalProgress: vi.fn().mockReturnValue({
    remaining: 5,
    percentComplete: 50,
    isOnTrack: true,
  }),
}))

vi.mock('./body-metrics-service', () => ({
  getBodyMetricsHistory: vi.fn(),
}))

vi.mock('./client-goals-service', () => ({
  getCurrentGoals: vi.fn(),
}))

// Client-local today is resolved through today-service by downstream reads.
vi.mock('./today-service', () => ({
  getClientTodayString: vi.fn().mockResolvedValue('2026-01-15'),
}))

// Passthrough spy: real resolver behavior, observable arguments.
const { resolveEffectiveGoalSpy } = vi.hoisted(() => ({
  resolveEffectiveGoalSpy: vi.fn(),
}))
// Spreads `actual` rather than returning a hand-listed export set: the previous
// shape returned only `resolveEffectiveGoal`, so the module's next export
// arrived here as "No X export is defined on the mock" at runtime, with nothing
// in tsc to catch it (CONVENTIONS §3, don't break the mock contract). Only the
// spy is an override; everything else stays real, which is what these tests want
// — they assert on the real resolution arithmetic.
vi.mock('@/lib/goals/resolve-effective-goal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/goals/resolve-effective-goal')>()
  resolveEffectiveGoalSpy.mockImplementation(actual.resolveEffectiveGoal)
  return { ...actual, resolveEffectiveGoal: resolveEffectiveGoalSpy }
})

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
      180, // client.currentWeight — the record's reading, never the check-in's
      165, // goalWeight from service
      190, // earliestWeight falls back to client.startingWeight (empty body_metrics)
      undefined // avgWeeklyWeightChange (only 1 check-in)
    )
  })

  it("the coach's RECORDED start wins over the derived one", async () => {
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

    expect(getBodyMetricsHistory).toHaveBeenCalledWith('client-1', {
      limit: 1,
      ascending: true,
    })

    // The preference used to run the other way, and had to invert when
    // `clients.starting_weight` became editable: `body_metrics` is immutable,
    // so a coach's correction would otherwise show on the Overview card and be
    // ignored by every check-in figure.
    expect(calculateGoalProgress).toHaveBeenCalledWith(
      180, // client.currentWeight — the record's reading, never the check-in's
      165, // goalWeight from service
      190, // client.startingWeight — the recorded start, NOT the 195 event
      undefined // avgWeeklyWeightChange (only 1 check-in)
    )
  })

  it('derives the start from earliest body_metrics when none was recorded', async () => {
    // The legacy client: no start weight was ever written, so the first event
    // is the only thing that knows where they began. This is the leg that keeps
    // the inversion behaviour-identical for everyone who has not been corrected.
    vi.mocked(getClientById).mockResolvedValue({
      ...mockClient,
      startingWeight: undefined,
      startingBodyFatPercentage: undefined,
    } as never)
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
    vi.mocked(getCurrentGoals).mockResolvedValue(null)

    await getCheckInComparison('ci-1')

    expect(calculateGoalProgress).toHaveBeenCalledWith(
      180, // client.currentWeight — the record's reading, never the check-in's
      170, // client.goalWeight fallback
      195, // derived from the earliest event
      undefined
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
      180, // client.currentWeight — the record's reading, never the check-in's
      170, // client.goalWeight fallback
      190, // client.startingWeight fallback
      undefined // avgWeeklyWeightChange (only 1 check-in)
    )
  })

  it("builds the row from the client's reading when the check-in carries none", async () => {
    // Every field on the form is optional (migration 157), so a weightless
    // check-in is ordinary. Position is the client RECORD's current reading;
    // the check-in is a report, and its empty box changes nothing here.
    vi.mocked(getCheckInById).mockResolvedValue({
      ...mockCheckIn,
      weight: undefined,
      bodyFatPercentage: undefined,
    } as never)
    vi.mocked(getClientCheckIns).mockResolvedValue({ checkIns: [] } as never)
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

    expect(calculateGoalProgress).toHaveBeenCalledWith(180, 165, 190, undefined)
    expect(result.goalProgress.weight?.position?.current).toBe(180)
    expect(result.goalProgress.bodyFat?.position?.current).toBe(20)
  })

  it('keeps the row, with no position, for a client the record has no reading for', async () => {
    // The goal is real even when nothing can be said about it yet: the strip
    // shows the goal and says "No reading yet" rather than "No goals".
    vi.mocked(getCheckInById).mockResolvedValue({
      ...mockCheckIn,
      weight: undefined,
      bodyFatPercentage: undefined,
    } as never)
    vi.mocked(getClientCheckIns).mockResolvedValue({ checkIns: [] } as never)
    vi.mocked(getClientById).mockResolvedValue({
      ...mockClient,
      currentWeight: undefined,
      currentBodyFatPercentage: undefined,
    } as never)
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

    expect(result.goalProgress.weight).toEqual({ goal: 165, startingWeight: 190, position: null })
    expect(result.goalProgress.bodyFat).toEqual({ goal: 12, startingBodyFat: 22, position: null })
    expect(calculateGoalProgress).not.toHaveBeenCalled()
  })

  it('the whole pace path runs in ONE unit — no kg/display mixing', async () => {
    // Regression guard for the 7.8 rewire, restated for canonical storage
    // (migration 141): there is no longer a kg↔display round trip at all —
    // resolveEffectiveGoal returns the stored kilograms and comparison-service
    // uses them directly. The invariant this protects is unchanged: goal and
    // the client's weight must be in the SAME unit before subtracting. This runs the
    // REAL calculateGoalProgress (computeGoalPace is already un-mocked here) so
    // the actual subtraction executes. If a stray conversion ever re-entered one
    // side, remaining would swing by ~2.2x and the pace would falsely read
    // "unrealistic".
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

      // Passthrough: the service does not convert. Values are canonical
      // kilograms since migration 141; the render layer converts for the viewer.
      expect(w.goal).toBeCloseTo(165.4, 1)
      expect(w.position?.remaining).toBeCloseTo(-14.6, 1) // 165.4 - 180, the record's weight
      expect(w.position?.paceStatus).toBe('on_track')
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

// `isOnTrack` is the strip's fallback state and the ONLY thing the ten-row
// recent read still feeds (plus the third-priority starting value). These run
// the real `calculateGoalProgress` against the mocked reads so the whole path
// from the recent set to the flag is under test — delete the read and the first
// case reads "on track" for a client moving away from the goal.
describe('the trend behind isOnTrack', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const actual = await vi.importActual<typeof import('@/utils/comparison-utils')>(
      '@/utils/comparison-utils'
    )
    vi.mocked(calculateGoalProgress).mockImplementation(actual.calculateGoalProgress)
    vi.mocked(getClientById).mockResolvedValue(mockClient as never)
    vi.mocked(getBodyMetricsHistory).mockResolvedValue([])
    vi.mocked(getCurrentGoals).mockResolvedValue({
      id: 'goal-2',
      clientId: 'client-1',
      goalWeight: 77,
      setBy: 'coach',
      effectiveFrom: '2024-01-01T00:00:00Z',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    } as never)
  })

  it('reads false for a client whose recent check-ins move AWAY from a loss goal', async () => {
    const current = { ...mockCheckIn, weight: 82, createdAt: '2024-02-08T00:00:00Z' }
    const older = { ...mockCheckIn, id: 'ci-0', weight: 81, createdAt: '2024-02-01T00:00:00Z' }
    vi.mocked(getCheckInById).mockResolvedValue(current as never)
    // Newest first, as the service reads them: +1 kg over the week.
    vi.mocked(getClientCheckIns).mockResolvedValue({ checkIns: [current, older] } as never)

    const result = await getCheckInComparison('ci-1')

    expect(result.goalProgress.weight?.position?.isOnTrack).toBe(false)
  })

  it('reads true while the recent check-ins move TOWARDS it', async () => {
    const current = { ...mockCheckIn, weight: 80, createdAt: '2024-02-08T00:00:00Z' }
    const older = { ...mockCheckIn, id: 'ci-0', weight: 81, createdAt: '2024-02-01T00:00:00Z' }
    vi.mocked(getCheckInById).mockResolvedValue(current as never)
    vi.mocked(getClientCheckIns).mockResolvedValue({ checkIns: [current, older] } as never)

    const result = await getCheckInComparison('ci-1')

    expect(result.goalProgress.weight?.position?.isOnTrack).toBe(true)
  })
})
