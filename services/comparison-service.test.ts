import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./check-in-service', () => ({
  getCheckInById: vi.fn(),
  getPreviousCheckIn: vi.fn(),
}))

vi.mock('./client-service', () => ({
  getClientById: vi.fn(),
}))

// "Set new goals" is the one live question the review asks: is the goal the
// check-in judged still the client's goal today? Which goal a day has is the
// real timeline over these goals.
vi.mock('./client-goals-service', () => ({
  listClientGoals: vi.fn(),
}))

vi.mock('./today-service', () => ({
  getClientTodayString: vi.fn(),
}))

// The reads that composed a goal section before check-ins saved their copy.
// The review may call none of them; each is scripted to answer with TODAY's
// state, so a review that reached for one would show a different number.
vi.mock('./measurements-service', () => ({
  getReadingsAsOf: vi.fn(),
  getReadingsOnDay: vi.fn(),
}))

vi.mock('./nutrition-plan-service', () => ({
  getNutritionPlanForDate: vi.fn(),
}))

import { getCheckInById, getPreviousCheckIn } from './check-in-service'
import { getClientById } from './client-service'
import { listClientGoals } from './client-goals-service'
import { getClientTodayString } from './today-service'
import { getReadingsAsOf, getReadingsOnDay } from './measurements-service'
import { getNutritionPlanForDate } from './nutrition-plan-service'
import { buildCheckInComparison, getCheckInComparison } from './comparison-service'
import { parseSentSnapshot, type SentSnapshot } from '@/lib/check-in/sent-snapshot'
import type { CheckIn, Client } from '@/types/check-in'
import type { ClientGoal } from '@/types/client-goals'

// A check-in sent on 31 May by a London client, reviewed in September. Every
// number is distinct so a wrong source shows as a wrong number: it reported
// 80.2 kg and 17.1 %, the goal then was 77 kg by 4 July, its start reading
// 86.3 and the client's baseline 88.4; since then the goal became 70 kg, the
// weigh-in was corrected to 79.4 and today's reading is 85.6.
const AT = '2026-05-31T12:00:00+00:00'
const TODAY = '2026-09-03'

const goalThen: ClientGoal = {
  id: '00000000-0000-4000-8000-0000000000a1',
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
  deadlines: [{ effectiveOn: '2026-04-11', deadline: '2026-07-04', setBy: 'coach-1' }],
}

/** The goal in force since 27 August, which replaced the one the check-in judged. */
const goalNow: ClientGoal = {
  ...goalThen,
  id: '00000000-0000-4000-8000-0000000000a2',
  targetWeight: 70,
  targetBodyFatPercentage: 10,
  startsOn: '2026-08-27',
  deadlines: [{ effectiveOn: '2026-08-27', deadline: '2026-12-18', setBy: 'coach-1' }],
}

/** The copy the check-in saved when it was sent (lib/check-in/sent-snapshot.ts). */
function sentCopy(overrides: Partial<SentSnapshot> = {}): SentSnapshot {
  return parseSentSnapshot({
    version: 2,
    day: '2026-05-31',
    readings: { weight: 80.2, bodyFat: 17.1, waist: null, hips: null, chest: null, arms: null, thighs: null },
    standing: { weight: 80.2, bodyFat: 17.1 },
    goal: {
      id: goalThen.id,
      name: goalThen.name,
      type: goalThen.type,
      targetWeight: 77,
      targetBodyFatPercentage: 15,
      startsOn: '2026-04-11',
      deadline: '2026-07-04',
    },
    goalProgress: {
      weight: {
        goal: 77,
        startingWeight: 88.4,
        goalStartWeight: 86.3,
        position: {
          current: 80.2,
          remaining: -3.2,
          percentComplete: 64.8,
          status: 'approaching',
          trend: 'towards',
          paceStatus: 'behind_pace',
        },
      },
      bodyFat: {
        goal: 15,
        startingBodyFat: 20.3,
        goalStartBodyFat: 18.6,
        position: {
          current: 17.1,
          remaining: -2.1,
          percentComplete: 41.7,
          status: 'approaching',
          trend: 'away',
        },
      },
      deadline: { date: '2026-07-04', daysRemaining: 34, isPastDeadline: false },
    },
    nutritionPlan: { baseWeightKg: 83.4, effectiveFrom: '2026-05-01' },
    period: null,
    questions: [],
    ...overrides,
  })
}

const sentCheckIn = (overrides: Partial<CheckIn> = {}): CheckIn =>
  ({
    id: 'ci-1',
    clientId: 'client-1',
    status: 'pending',
    weight: 80.2,
    bodyFatPercentage: 17.1,
    mood: 4,
    energy: 7,
    sleep: 6,
    stress: 3,
    soreness: 2,
    createdAt: AT,
    updatedAt: AT,
    sentSnapshot: sentCopy(),
    ...overrides,
  }) as CheckIn

/** The check-in before it, a week earlier, with its own copy. */
const previousCheckIn = {
  id: 'ci-0',
  clientId: 'client-1',
  status: 'reviewed',
  weight: 81.4,
  bodyFatPercentage: 17.9,
  mood: 3,
  energy: 8,
  sleep: 5,
  stress: 4,
  soreness: 1,
  createdAt: '2026-05-24T12:00:00+00:00',
  updatedAt: '2026-05-24T12:00:00+00:00',
  sentSnapshot: sentCopy({
    day: '2026-05-24',
    readings: { weight: 81.4, bodyFat: 17.9, waist: null, hips: null, chest: null, arms: null, thighs: null },
  }),
} as CheckIn

const client = {
  id: 'client-1',
  coachId: 'coach-1',
  name: 'Test Client',
  timezone: 'Europe/London',
  // Today's reading: it may never reach a sent check-in.
  currentWeight: 85.6,
  currentBodyFatPercentage: 16.2,
  startingWeight: 88.4,
  startingBodyFatPercentage: 20.3,
  unitPreference: 'metric' as const,
} as Client

/** Today's state, which a sent check-in must never read: a corrected weigh-in, a later goal, a re-saved plan. */
function scriptToday(goals: ClientGoal[]) {
  vi.mocked(listClientGoals).mockResolvedValue(goals)
  vi.mocked(getClientTodayString).mockResolvedValue(TODAY)
  vi.mocked(getReadingsAsOf).mockResolvedValue({
    weight: { id: 'm-1', metricKey: 'weight', value: 79.4, date: '2026-05-31', source: 'check_in' },
  })
  vi.mocked(getReadingsOnDay).mockResolvedValue({
    weight: { id: 'm-2', metricKey: 'weight', value: 91.7, date: '2026-08-27', source: 'coach_entry' },
  })
  vi.mocked(getNutritionPlanForDate).mockResolvedValue({ base_weight_kg: 90.3, effective_from: '2026-05-28' } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getPreviousCheckIn).mockResolvedValue(previousCheckIn)
  scriptToday([goalThen, goalNow])
})

describe("a sent check-in's goal section is the one it saved", () => {
  it("shows the goal then, where the client stood and the drift note's plan — whatever the goal and the readings are now", async () => {
    const { comparison, goalProgress } = await buildCheckInComparison(sentCheckIn(), client)

    const saved = sentCopy()
    // The goal judged, by name and type — what a goal with no target shows.
    expect(goalProgress).toEqual({
      ...saved.goalProgress,
      goal: { name: 'Lose weight', type: 'lose_weight' },
      goalIsCurrent: false,
    })
    // The client carries no goal of its own: the goal section is the copy's.
    expect(comparison.client).toEqual({
      id: 'client-1',
      name: 'Test Client',
      currentWeight: 80.2,
      currentBodyFatPercentage: 17.1,
      unitPreference: 'metric',
      nutritionPlanBaseWeightKg: 83.4,
      nutritionPlanEffectiveDate: '2026-05-01',
    })
  })

  it('a goal changed and a weigh-in corrected after Send never move it — only "is it still the goal" answers today', async () => {
    // Read while the goal it judged was still in force…
    scriptToday([goalThen])
    const before = await buildCheckInComparison(sentCheckIn(), client)

    // …then the goal is replaced and its deadline moved, the weigh-in is
    // corrected in the log and the plan re-saved: today's state all differs.
    scriptToday([
      { ...goalThen, deadlines: [...goalThen.deadlines, { effectiveOn: '2026-06-02', deadline: '2026-09-30', setBy: 'coach-1' }] },
      goalNow,
    ])
    const after = await buildCheckInComparison(
      sentCheckIn(),
      { ...client, currentWeight: 79.4 } as Client
    )

    const { goalIsCurrent: currentBefore, ...rowsBefore } = before.goalProgress
    const { goalIsCurrent: currentAfter, ...rowsAfter } = after.goalProgress
    expect(rowsAfter).toEqual(rowsBefore)
    expect(after.comparison.client).toEqual(before.comparison.client)
    expect(after.comparison.client.currentWeight).toBe(80.2)
    expect(currentBefore).toBe(true)
    expect(currentAfter).toBe(false)
  })

  it('reads nothing that composes a goal section — no readings, no plan, no trend', async () => {
    await buildCheckInComparison(sentCheckIn(), client)

    expect(getReadingsAsOf).not.toHaveBeenCalled()
    expect(getReadingsOnDay).not.toHaveBeenCalled()
    expect(getNutritionPlanForDate).not.toHaveBeenCalled()
  })

  it('shows no goal when the check-in judged none, even though the client has one now', async () => {
    const { goalProgress } = await buildCheckInComparison(
      sentCheckIn({ sentSnapshot: sentCopy({ goal: null, goalProgress: {} }) }),
      client
    )

    expect(goalProgress).toEqual({ goal: null, goalIsCurrent: false })
  })

  it('leaves out the drift plan when none covered the check-in day', async () => {
    const { comparison } = await buildCheckInComparison(
      sentCheckIn({ sentSnapshot: sentCopy({ nutritionPlan: null }) }),
      client
    )

    expect(comparison.client.nutritionPlanBaseWeightKg).toBeUndefined()
    expect(comparison.client.nutritionPlanEffectiveDate).toBeUndefined()
    // …so the wire carries neither key, as before copies existed.
    const wire = JSON.parse(JSON.stringify(comparison.client))
    expect(wire).not.toHaveProperty('nutritionPlanBaseWeightKg')
    expect(wire).not.toHaveProperty('nutritionPlanEffectiveDate')
  })

  it('throws for a check-in with no saved copy rather than inventing its section from today', async () => {
    await expect(
      buildCheckInComparison(sentCheckIn({ sentSnapshot: null }), client)
    ).rejects.toThrow('has no saved copy')
    expect(getReadingsAsOf).not.toHaveBeenCalled()
  })
})

describe('"Set new goals" asks whether the goal judged is still the goal today', () => {
  it('is current while the goal it judged is the one in force on the client\'s today', async () => {
    scriptToday([goalThen])
    const { goalProgress } = await buildCheckInComparison(sentCheckIn(), client)
    expect(goalProgress.goalIsCurrent).toBe(true)
  })

  it('is not current once a later goal has replaced it', async () => {
    const { goalProgress } = await buildCheckInComparison(sentCheckIn(), client)
    expect(goalProgress.goalIsCurrent).toBe(false)
  })

  it('a goal planned after today does not replace it yet', async () => {
    scriptToday([goalThen, { ...goalNow, startsOn: '2026-10-19', deadlines: [{ effectiveOn: '2026-10-19', deadline: null, setBy: 'coach-1' }] }])
    const { goalProgress } = await buildCheckInComparison(sentCheckIn(), client)
    expect(goalProgress.goalIsCurrent).toBe(true)
    expect(listClientGoals).toHaveBeenCalledWith('client-1')
    expect(getClientTodayString).toHaveBeenCalledWith('client-1')
  })
})

describe('the changes since the last check-in compare what the two check-ins reported', () => {
  it('differences each figure against the previous check-in, both as they were sent', async () => {
    const { comparison } = await buildCheckInComparison(sentCheckIn(), client)

    expect(getPreviousCheckIn).toHaveBeenCalledWith('client-1', 'ci-1')
    expect(comparison.changes).toEqual({
      weight: -1.2,
      bodyFatPercentage: -0.8,
      mood: 1,
      energy: -1,
      sleep: 1,
      stress: -1,
      soreness: 1,
    })
    expect(comparison.timeBetweenCheckIns).toBe(7)
  })

  it("sends the previous check-in without its saved copy — the server reads it, the browser does not", async () => {
    const { comparison } = await buildCheckInComparison(sentCheckIn(), client)

    expect(comparison.previous?.id).toBe('ci-0')
    expect(comparison.previous?.weight).toBe(81.4)
    expect(comparison.previous).not.toHaveProperty('sentSnapshot')
  })

  it('a first check-in has nothing to compare against', async () => {
    vi.mocked(getPreviousCheckIn).mockResolvedValue(null)
    const { comparison } = await buildCheckInComparison(sentCheckIn(), client)

    expect(comparison.previous).toBeNull()
    expect(comparison.timeBetweenCheckIns).toBeUndefined()
    expect(comparison.changes.weight).toBeUndefined()
  })
})

describe('getCheckInComparison', () => {
  it('reads the check-in and its client, then the same comparison', async () => {
    vi.mocked(getCheckInById).mockResolvedValue(sentCheckIn())
    vi.mocked(getClientById).mockResolvedValue(client)

    const { goalProgress } = await getCheckInComparison('ci-1')

    expect(getCheckInById).toHaveBeenCalledWith('ci-1')
    expect(getClientById).toHaveBeenCalledWith('client-1')
    expect(goalProgress.weight?.position?.current).toBe(80.2)
  })

  it('throws for a missing check-in, and for a missing client', async () => {
    vi.mocked(getCheckInById).mockResolvedValue(null)
    await expect(getCheckInComparison('ci-404')).rejects.toThrow('Check-in not found')

    vi.mocked(getCheckInById).mockResolvedValue(sentCheckIn())
    vi.mocked(getClientById).mockResolvedValue(null)
    await expect(getCheckInComparison('ci-1')).rejects.toThrow('Client not found')
  })
})
