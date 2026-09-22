import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./check-in-service', () => ({
  getCheckInById: vi.fn(),
  getPreviousCheckIn: vi.fn().mockResolvedValue(null),
  getClientCheckIns: vi.fn().mockResolvedValue({ checkIns: [] }),
}))

vi.mock('./client-service', () => ({
  getClientById: vi.fn(),
}))

// The review's whole view of "then" comes through these reads — the client's
// goals and their today, the readings as of the check-in's day and on the
// goal's start day, and the covering nutrition version — so each is scripted
// per case. Which goal and which deadline a day has is the real timeline.
vi.mock('./client-goals-service', () => ({
  listClientGoals: vi.fn(),
}))

vi.mock('./today-service', () => ({
  getClientTodayString: vi.fn(),
}))

vi.mock('./measurements-service', () => ({
  getReadingsAsOf: vi.fn(),
  getReadingsOnDay: vi.fn(),
}))

vi.mock('./nutrition-plan-service', () => ({
  getNutritionPlanForDate: vi.fn(),
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

import { getCheckInById, getClientCheckIns } from './check-in-service'
import { getClientById } from './client-service'
import { listClientGoals } from './client-goals-service'
import { getClientTodayString } from './today-service'
import { getReadingsAsOf, getReadingsOnDay } from './measurements-service'
import { getNutritionPlanForDate } from './nutrition-plan-service'
import { calculateGoalProgress } from '@/utils/comparison-utils'
import { getCheckInComparison } from './comparison-service'
import type { ClientGoal } from '@/types/client-goals'

// A check-in submitted on 31 May at noon UTC by a London client, reviewed in
// September. Every number is distinct so a wrong source shows as a wrong
// number: the check-in's own reading is 80, today's is 85, the baseline 88,
// the reading on the goal's start day 86, the goal then 77 and the goal in
// force today 70.
const AT = '2026-05-31T12:00:00+00:00'
const DAY = '2026-05-31'
const TODAY = '2026-09-03'

const mockCheckIn = {
  id: 'ci-1',
  clientId: 'client-1',
  weight: 80,
  bodyFatPercentage: 17,
  createdAt: AT,
  mood: 4,
  energy: 7,
  sleep: 7,
  stress: 3,
}

const mockClient = {
  id: 'client-1',
  coachId: 'coach-1',
  name: 'Test Client',
  timezone: 'Europe/London',
  // Today's reading: it may not reach the strip.
  currentWeight: 85,
  currentBodyFatPercentage: 16,
  startingWeight: 88,
  startingBodyFatPercentage: 20,
  unitPreference: 'metric' as const,
}

/**
 * The goal in force on 31 May: started 11 April, replaced on 27 August. Its
 * deadline moved on 20 May and again after the check-in, so 31 May reads the
 * middle one.
 */
const goalThen: ClientGoal = {
  id: 'goal-may',
  clientId: 'client-1',
  name: 'Lose weight',
  type: 'lose_weight',
  targetWeight: 77,
  targetBodyFatPercentage: 15,
  description: null,
  startsOn: '2026-04-11',
  source: 'coach',
  setBy: 'coach-1',
  createdAt: '2026-04-11T09:00:00+00:00',
  updatedAt: '2026-04-11T09:00:00+00:00',
  deadlines: [
    { effectiveOn: '2026-04-11', deadline: '2026-06-20', setBy: 'coach-1' },
    { effectiveOn: '2026-05-20', deadline: '2026-07-04', setBy: 'coach-1' },
    { effectiveOn: '2026-06-10', deadline: '2026-08-01', setBy: 'coach-1' },
  ],
}

/** The goal in force today, since 27 August. */
const goalNow: ClientGoal = {
  ...goalThen,
  id: 'goal-aug',
  targetWeight: 70,
  targetBodyFatPercentage: 10,
  startsOn: '2026-08-27',
  createdAt: '2026-08-27T15:23:50.965+00:00',
  updatedAt: '2026-08-27T15:23:50.965+00:00',
  deadlines: [{ effectiveOn: '2026-08-27', deadline: '2026-12-18', setBy: 'coach-1' }],
}

/** The goal then with one deadline, set on its start day. */
const withDeadline = (deadline: string | null): ClientGoal => ({
  ...goalThen,
  deadlines: [{ effectiveOn: goalThen.startsOn, deadline, setBy: 'coach-1' }],
})

/** The check-in's own stamped rows. */
const readingsThen = {
  weight: { id: 'w-then', metricKey: 'weight' as const, value: 80, date: DAY, source: 'check_in' as const },
  bodyFat: { id: 'bf-then', metricKey: 'bodyFat' as const, value: 17, date: DAY, source: 'check_in' as const },
}

/** The readings on the goal's start day, 11 April. */
const readingsAtGoalStart = {
  weight: { id: 'w-start', metricKey: 'weight' as const, value: 86, date: '2026-04-11', source: 'coach_entry' as const },
  bodyFat: { id: 'bf-start', metricKey: 'bodyFat' as const, value: 19, date: '2026-04-11', source: 'coach_entry' as const },
}

/** The nutrition version covering 31 May. */
const planThen = { id: 'plan-april', base_weight_kg: 84, effective_from: '2026-04-05' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCheckInById).mockResolvedValue(mockCheckIn as never)
  vi.mocked(getClientById).mockResolvedValue(mockClient as never)
  vi.mocked(getClientCheckIns).mockResolvedValue({ checkIns: [mockCheckIn] } as never)
  vi.mocked(listClientGoals).mockResolvedValue([goalThen, goalNow])
  vi.mocked(getClientTodayString).mockResolvedValue(TODAY)
  vi.mocked(getReadingsAsOf).mockResolvedValue(readingsThen)
  vi.mocked(getReadingsOnDay).mockResolvedValue(readingsAtGoalStart)
  vi.mocked(getNutritionPlanForDate).mockResolvedValue(planThen as never)
})

describe("the review reads the check-in's day (commit 8b)", () => {
  it("judges the reading as of the check-in's day against the goal in force on that day", async () => {
    const result = await getCheckInComparison('ci-1')

    // 80 against 77, measured from 86 — the reading on the goal's start day —
    // downward, as losing weight counts; never today's 85 against today's 70.
    // Body fat: the type sets no direction for it, so from 19 down to 15.
    expect(calculateGoalProgress).toHaveBeenCalledWith(80, 77, 86, undefined, -1)
    expect(calculateGoalProgress).toHaveBeenCalledWith(17, 15, 19, undefined, -1)
    expect(result.goalProgress.weight?.position?.current).toBe(80)
    expect(result.goalProgress.weight?.goal).toBe(77)
    expect(result.goalProgress.bodyFat?.position?.current).toBe(17)
    expect(result.comparison.client.goalWeight).toBe(77)
    expect(result.comparison.client.goalBodyFatPercentage).toBe(15)
    // The deadline in force on 31 May: neither the first nor the one set later.
    expect(result.comparison.client.goalDeadline).toBe('2026-07-04')
  })

  it("asks for the client's goals and today, the readings as of its day by its stamp, and those on the goal's start day", async () => {
    await getCheckInComparison('ci-1')

    expect(listClientGoals).toHaveBeenCalledWith('client-1')
    expect(getClientTodayString).toHaveBeenCalledWith('client-1')
    expect(getReadingsAsOf).toHaveBeenCalledWith('client-1', DAY, 'ci-1')
    expect(getReadingsOnDay).toHaveBeenCalledWith('client-1', '2026-04-11')
  })

  it("carries the baseline beside the goal's start: the ribbon counts from one, the strip from the other", async () => {
    const result = await getCheckInComparison('ci-1')

    expect(result.goalProgress.weight?.startingWeight).toBe(88)
    expect(result.goalProgress.weight?.goalStartWeight).toBe(86)
    expect(result.goalProgress.bodyFat?.startingBodyFat).toBe(20)
    expect(result.goalProgress.bodyFat?.goalStartBodyFat).toBe(19)
  })

  it("counts days remaining from the check-in's day, not from today", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-03T12:00:00Z'))
    try {
      const result = await getCheckInComparison('ci-1')

      // 31 May to 4 July on the client's calendar; today would say -61.
      expect(result.goalProgress.deadline).toEqual({
        date: '2026-07-04',
        daysRemaining: 34,
        isPastDeadline: false,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds the trend to the check-ins up to the one under review', async () => {
    await getCheckInComparison('ci-1')

    expect(getClientCheckIns).toHaveBeenCalledWith('client-1', { limit: 10, upTo: AT })
  })

  it("reads the nutrition version covering the check-in's day for the drift note, against the reading then", async () => {
    const result = await getCheckInComparison('ci-1')

    expect(getNutritionPlanForDate).toHaveBeenCalledWith('client-1', DAY)
    expect(result.comparison.client.nutritionPlanBaseWeightKg).toBe(84)
    expect(result.comparison.client.nutritionPlanEffectiveDate).toBe('2026-04-05')
    // The wire's reading is the reading then, so the strip's drift arithmetic
    // compares like with like.
    expect(result.comparison.client.currentWeight).toBe(80)
    expect(result.comparison.client.currentBodyFatPercentage).toBe(17)
  })

  it('degrades the drift note, never the page, when the covering-version read fails', async () => {
    vi.mocked(getNutritionPlanForDate).mockRejectedValue(new Error('boom'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const result = await getCheckInComparison('ci-1')

      expect(result.comparison.client.nutritionPlanBaseWeightKg).toBeUndefined()
      expect(result.goalProgress.weight?.position?.current).toBe(80)
      expect(errorSpy).toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })

  it("marks a goal since replaced as not current, and the one in force on the client's today as current", async () => {
    const replaced = await getCheckInComparison('ci-1')
    expect(replaced.goalProgress.goalIsCurrent).toBe(false)

    vi.mocked(listClientGoals).mockResolvedValue([goalThen])
    const inForce = await getCheckInComparison('ci-1')
    expect(inForce.goalProgress.goalIsCurrent).toBe(true)
  })

  it('a goal planned after today does not replace the one in force yet', async () => {
    const planned: ClientGoal = { ...goalNow, id: 'goal-planned', startsOn: '2026-10-05' }
    vi.mocked(listClientGoals).mockResolvedValue([goalThen, planned])

    const result = await getCheckInComparison('ci-1')

    expect(result.goalProgress.goalIsCurrent).toBe(true)
  })

  it('shows no goal for a check-in older than every goal — the client had none then', async () => {
    // Today's goal (70) started after the check-in; the review must not read it.
    vi.mocked(listClientGoals).mockResolvedValue([goalNow])

    const result = await getCheckInComparison('ci-1')

    expect(result.goalProgress).toEqual({ goalIsCurrent: false })
    expect(result.comparison.client.goalWeight).toBeUndefined()
    expect(result.comparison.client.goalDeadline).toBeUndefined()
    expect(calculateGoalProgress).not.toHaveBeenCalled()
    // No goal, no start day to read.
    expect(getReadingsOnDay).not.toHaveBeenCalled()
  })

  it("carries the reading then as the baseline, not today's, when the record has none", async () => {
    vi.mocked(getClientById).mockResolvedValue({
      ...mockClient,
      startingWeight: undefined,
      startingBodyFatPercentage: undefined,
    } as never)

    const result = await getCheckInComparison('ci-1')

    // Never 85, today's reading. The goal's progress still runs from its start.
    expect(result.goalProgress.weight?.startingWeight).toBe(80)
    expect(result.goalProgress.bodyFat?.startingBodyFat).toBe(17)
    expect(calculateGoalProgress).toHaveBeenCalledWith(80, 77, 86, undefined, -1)
  })

  it('keeps the row, with no position, when nothing was read on or before the day', async () => {
    vi.mocked(getReadingsAsOf).mockResolvedValue({})

    const result = await getCheckInComparison('ci-1')

    expect(result.goalProgress.weight).toEqual({ goal: 77, startingWeight: 88, goalStartWeight: 86, position: null })
    expect(result.goalProgress.bodyFat).toEqual({ goal: 15, startingBodyFat: 20, goalStartBodyFat: 19, position: null })
    expect(calculateGoalProgress).not.toHaveBeenCalled()
    expect(result.comparison.client.currentWeight).toBeUndefined()
  })

  it("takes the check-in's day on the CLIENT's calendar (Kiritimati boundary)", async () => {
    // UTC+14: a check-in at 12:00 UTC on 9 June was submitted on 10 June there.
    vi.mocked(getCheckInById).mockResolvedValue({ ...mockCheckIn, createdAt: '2026-06-09T12:00:00Z' } as never)
    vi.mocked(getClientById).mockResolvedValue({ ...mockClient, timezone: 'Pacific/Kiritimati' } as never)

    const result = await getCheckInComparison('ci-1')

    expect(getReadingsAsOf).toHaveBeenCalledWith('client-1', '2026-06-10', 'ci-1')
    expect(getNutritionPlanForDate).toHaveBeenCalledWith('client-1', '2026-06-10')
    // The deadline moved on 10 June: that day reads the new one, 9 June the old.
    expect(result.comparison.client.goalDeadline).toBe('2026-08-01')
  })

  it("anchors daysRemaining to the check-in's local day (west-of-UTC boundary)", async () => {
    // UTC has rolled to 18 June, but a UTC-11 client submitted on the 17th. A
    // deadline of that day reads 0 days remaining, not -1.
    vi.mocked(getCheckInById).mockResolvedValue({ ...mockCheckIn, createdAt: '2026-06-18T00:30:00Z' } as never)
    vi.mocked(getClientById).mockResolvedValue({ ...mockClient, timezone: 'Pacific/Niue' } as never)
    vi.mocked(listClientGoals).mockResolvedValue([withDeadline('2026-06-17'), goalNow])

    const result = await getCheckInComparison('ci-1')

    expect(result.goalProgress.deadline?.daysRemaining).toBe(0)
    expect(result.goalProgress.deadline?.isPastDeadline).toBe(false)
  })

  it('the whole pace path runs in ONE unit — no kg/display mixing', async () => {
    // Regression guard for the 7.8 rewire, restated for canonical storage
    // (migration 141): there is no kg↔display round trip at all — the resolver
    // returns the stored kilograms and the service uses them directly. The
    // invariant is unchanged: goal and reading must be in the SAME unit before
    // subtracting. This runs the REAL calculateGoalProgress so the actual
    // subtraction executes; a stray conversion on one side would swing
    // `remaining` by ~2.2x and the pace would falsely read "unrealistic".
    const actual = await vi.importActual<typeof import('@/utils/comparison-utils')>(
      '@/utils/comparison-utils'
    )
    vi.mocked(calculateGoalProgress).mockImplementation(actual.calculateGoalProgress)
    vi.mocked(listClientGoals).mockResolvedValue([
      { ...withDeadline('2026-12-01'), targetWeight: 77.4 },
      goalNow,
    ])

    const result = await getCheckInComparison('ci-1')
    const w = result.goalProgress.weight!

    expect(w.goal).toBeCloseTo(77.4, 1)
    expect(w.position?.remaining).toBeCloseTo(-2.6, 1) // 77.4 - 80, the reading then
    expect(w.position?.paceStatus).toBe('on_track')
  })
})

// The strip's figures run from the client's reading on the goal's start day, in
// the direction the goal's type sets. These run the REAL calculateGoalProgress
// against the mocked reads.
describe("progress runs from the goal's start, in its type's direction", () => {
  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('@/utils/comparison-utils')>(
      '@/utils/comparison-utils'
    )
    vi.mocked(calculateGoalProgress).mockImplementation(actual.calculateGoalProgress)
  })

  it("measures percentComplete from the reading on the goal's start day, not the baseline", async () => {
    const result = await getCheckInComparison('ci-1')

    // 6 of the 9 kg from 86 to 77; the baseline (88) would say 8 of 11.
    expect(result.goalProgress.weight?.position?.percentComplete).toBe(66.7)
  })

  it("judges a lose-weight goal downward even when its start day's reading sat below the target", async () => {
    // Started at 76, under the 77 target: by the side of the start 80 would be
    // past a climb. Losing weight counts down, so 80 is 3 kg short of it.
    vi.mocked(getReadingsOnDay).mockResolvedValue({
      ...readingsAtGoalStart,
      weight: { ...readingsAtGoalStart.weight, value: 76 },
    })

    const result = await getCheckInComparison('ci-1')

    expect(result.goalProgress.weight?.position?.status).toBe('approaching')
  })
})

// `isOnTrack` is the strip's fallback state and the ONLY thing the bounded
// ten-row read feeds. These run the real `calculateGoalProgress` against the
// mocked reads so the whole path from the set to the flag is under test —
// delete the read and the first case reads "on track" for a client moving
// away from the goal.
describe('the trend behind isOnTrack', () => {
  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('@/utils/comparison-utils')>(
      '@/utils/comparison-utils'
    )
    vi.mocked(calculateGoalProgress).mockImplementation(actual.calculateGoalProgress)
    vi.mocked(listClientGoals).mockResolvedValue([withDeadline(null), goalNow])
  })

  it('reads false for a client whose check-ins up to this one move AWAY from a loss goal', async () => {
    const current = { ...mockCheckIn, weight: 82, createdAt: AT }
    const older = { ...mockCheckIn, id: 'ci-0', weight: 81, createdAt: '2026-05-24T12:00:00+00:00' }
    vi.mocked(getCheckInById).mockResolvedValue(current as never)
    vi.mocked(getReadingsAsOf).mockResolvedValue({
      ...readingsThen,
      weight: { ...readingsThen.weight, value: 82 },
    })
    // Newest first, as the service reads them: +1 kg over the week.
    vi.mocked(getClientCheckIns).mockResolvedValue({ checkIns: [current, older] } as never)

    const result = await getCheckInComparison('ci-1')

    expect(result.goalProgress.weight?.position?.isOnTrack).toBe(false)
  })

  it('reads true while they move TOWARDS it', async () => {
    const current = { ...mockCheckIn, weight: 79.5, createdAt: AT }
    const older = { ...mockCheckIn, id: 'ci-0', weight: 81, createdAt: '2026-05-24T12:00:00+00:00' }
    vi.mocked(getCheckInById).mockResolvedValue(current as never)
    vi.mocked(getReadingsAsOf).mockResolvedValue({
      ...readingsThen,
      weight: { ...readingsThen.weight, value: 79.5 },
    })
    vi.mocked(getClientCheckIns).mockResolvedValue({ checkIns: [current, older] } as never)

    const result = await getCheckInComparison('ci-1')

    expect(result.goalProgress.weight?.position?.isOnTrack).toBe(true)
  })
})
