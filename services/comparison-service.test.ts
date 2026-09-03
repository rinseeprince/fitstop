import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./check-in-service', () => ({
  getCheckInById: vi.fn(),
  getPreviousCheckIn: vi.fn().mockResolvedValue(null),
  getClientCheckIns: vi.fn().mockResolvedValue({ checkIns: [] }),
}))

vi.mock('./client-service', () => ({
  getClientById: vi.fn(),
}))

// The two as-of reads and the covering-version read: the review's whole view
// of "then" comes through these three, so each is scripted per case.
vi.mock('./client-goals-service', () => ({
  getGoalAsOf: vi.fn(),
}))

vi.mock('./measurements-service', () => ({
  getReadingsAsOf: vi.fn(),
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
import { getGoalAsOf } from './client-goals-service'
import { getReadingsAsOf } from './measurements-service'
import { getNutritionPlanForDate } from './nutrition-plan-service'
import { calculateGoalProgress } from '@/utils/comparison-utils'
import { getCheckInComparison } from './comparison-service'

// A check-in submitted on 31 May at noon UTC by a London client, reviewed in
// September. Every number is distinct so a wrong source shows as a wrong
// number: the check-in's own reading is 80, today's is 85, the baseline 88,
// the goal then 77 and the live goal's mirror 70.
const AT = '2026-05-31T12:00:00+00:00'
const DAY = '2026-05-31'

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
  // Today's reading and the live goal's mirror: neither may reach the strip.
  currentWeight: 85,
  currentBodyFatPercentage: 16,
  goalWeight: 70,
  goalBodyFatPercentage: 10,
  startingWeight: 88,
  startingBodyFatPercentage: 20,
  unitPreference: 'metric' as const,
}

/** The version in force on 31 May, replaced on 27 August. */
const goalThen = {
  id: 'goal-may',
  clientId: 'client-1',
  goalWeight: 77,
  goalBodyFatPercentage: 15,
  goalDeadline: '2026-07-04',
  setBy: 'coach',
  effectiveFrom: '2026-04-11T09:00:00+00:00',
  supersededAt: '2026-08-27T15:23:50.965+00:00',
  createdAt: '2026-04-11T09:00:00+00:00',
  updatedAt: '2026-08-27T15:23:50.965+00:00',
}

/** The check-in's own stamped rows. */
const readingsThen = {
  weight: { id: 'w-then', metricKey: 'weight' as const, value: 80, date: DAY, source: 'check_in' as const },
  bodyFat: { id: 'bf-then', metricKey: 'bodyFat' as const, value: 17, date: DAY, source: 'check_in' as const },
}

/** The nutrition version covering 31 May. */
const planThen = { id: 'plan-april', base_weight_kg: 84, effective_from: '2026-04-05' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCheckInById).mockResolvedValue(mockCheckIn as never)
  vi.mocked(getClientById).mockResolvedValue(mockClient as never)
  vi.mocked(getClientCheckIns).mockResolvedValue({ checkIns: [mockCheckIn] } as never)
  vi.mocked(getGoalAsOf).mockResolvedValue(goalThen)
  vi.mocked(getReadingsAsOf).mockResolvedValue(readingsThen)
  vi.mocked(getNutritionPlanForDate).mockResolvedValue(planThen as never)
})

describe("the review reads the check-in's day (commit 8b)", () => {
  it("judges the reading as of the check-in's day against the goal in force then", async () => {
    const result = await getCheckInComparison('ci-1')

    // 80 against 77 from a start of 88 — never today's 85 against the live 70.
    expect(calculateGoalProgress).toHaveBeenCalledWith(80, 77, 88, undefined)
    expect(calculateGoalProgress).toHaveBeenCalledWith(17, 15, 20, undefined)
    expect(result.goalProgress.weight?.position?.current).toBe(80)
    expect(result.goalProgress.weight?.goal).toBe(77)
    expect(result.goalProgress.bodyFat?.position?.current).toBe(17)
    expect(result.comparison.client.goalWeight).toBe(77)
    expect(result.comparison.client.goalBodyFatPercentage).toBe(15)
    expect(result.comparison.client.goalDeadline).toBe('2026-07-04')
  })

  it("asks for the goal at the check-in's instant and the readings as of its day, by its stamp", async () => {
    await getCheckInComparison('ci-1')

    expect(getGoalAsOf).toHaveBeenCalledWith('client-1', AT)
    expect(getReadingsAsOf).toHaveBeenCalledWith('client-1', DAY, 'ci-1')
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

  it('marks a version since replaced as not current, and the live one as current', async () => {
    const replaced = await getCheckInComparison('ci-1')
    expect(replaced.goalProgress.goalIsCurrent).toBe(false)

    vi.mocked(getGoalAsOf).mockResolvedValue({ ...goalThen, supersededAt: undefined })
    const live = await getCheckInComparison('ci-1')
    expect(live.goalProgress.goalIsCurrent).toBe(true)
  })

  it('shows no goal for a check-in older than every version — the review reads the versions alone', async () => {
    // The client's mirror carries the live goal (70); the review must not read it.
    vi.mocked(getGoalAsOf).mockResolvedValue(null)

    const result = await getCheckInComparison('ci-1')

    expect(result.goalProgress).toEqual({ goalIsCurrent: false })
    expect(result.comparison.client.goalWeight).toBeUndefined()
    expect(result.comparison.client.goalDeadline).toBeUndefined()
    expect(calculateGoalProgress).not.toHaveBeenCalled()
  })

  it("falls back to the reading then, not today's, when the record has no baseline", async () => {
    vi.mocked(getClientById).mockResolvedValue({
      ...mockClient,
      startingWeight: undefined,
      startingBodyFatPercentage: undefined,
    } as never)

    await getCheckInComparison('ci-1')

    // 80 → 77 from 80: no direction yet — and never 85, today's reading.
    expect(calculateGoalProgress).toHaveBeenCalledWith(80, 77, 80, undefined)
    expect(calculateGoalProgress).toHaveBeenCalledWith(17, 15, 17, undefined)
  })

  it('keeps the row, with no position, when nothing was read on or before the day', async () => {
    vi.mocked(getReadingsAsOf).mockResolvedValue({})

    const result = await getCheckInComparison('ci-1')

    expect(result.goalProgress.weight).toEqual({ goal: 77, startingWeight: 88, position: null })
    expect(result.goalProgress.bodyFat).toEqual({ goal: 15, startingBodyFat: 20, position: null })
    expect(calculateGoalProgress).not.toHaveBeenCalled()
    expect(result.comparison.client.currentWeight).toBeUndefined()
  })

  it("takes the check-in's day on the CLIENT's calendar (Kiritimati boundary)", async () => {
    // UTC+14: a check-in at 12:00 UTC on 9 June was submitted on 10 June there.
    vi.mocked(getCheckInById).mockResolvedValue({ ...mockCheckIn, createdAt: '2026-06-09T12:00:00Z' } as never)
    vi.mocked(getClientById).mockResolvedValue({ ...mockClient, timezone: 'Pacific/Kiritimati' } as never)

    await getCheckInComparison('ci-1')

    expect(getReadingsAsOf).toHaveBeenCalledWith('client-1', '2026-06-10', 'ci-1')
    expect(getNutritionPlanForDate).toHaveBeenCalledWith('client-1', '2026-06-10')
  })

  it("anchors daysRemaining to the check-in's local day (west-of-UTC boundary)", async () => {
    // UTC has rolled to 18 June, but a UTC-11 client submitted on the 17th. A
    // deadline of that day reads 0 days remaining, not -1.
    vi.mocked(getCheckInById).mockResolvedValue({ ...mockCheckIn, createdAt: '2026-06-18T00:30:00Z' } as never)
    vi.mocked(getClientById).mockResolvedValue({ ...mockClient, timezone: 'Pacific/Niue' } as never)
    vi.mocked(getGoalAsOf).mockResolvedValue({ ...goalThen, goalDeadline: '2026-06-17' })

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
    vi.mocked(getGoalAsOf).mockResolvedValue({ ...goalThen, goalWeight: 77.4, goalDeadline: '2026-12-01' })

    const result = await getCheckInComparison('ci-1')
    const w = result.goalProgress.weight!

    expect(w.goal).toBeCloseTo(77.4, 1)
    expect(w.position?.remaining).toBeCloseTo(-2.6, 1) // 77.4 - 80, the reading then
    expect(w.position?.paceStatus).toBe('on_track')
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
    vi.mocked(getGoalAsOf).mockResolvedValue({ ...goalThen, goalDeadline: undefined })
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
