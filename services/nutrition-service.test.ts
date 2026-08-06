import { describe, it, expect, vi, afterEach } from 'vitest'
import { calculateBaselineCalories } from './nutrition-service'

describe('calculateBaselineCalories', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const tdee = 2400
  const currentWeightKg = 85
  const goalWeightKg = 75
  const gender = 'male' as const

  it('uses today as start date when calcStartDate is undefined', () => {
    const deadline = new Date()
    deadline.setDate(deadline.getDate() + 90)
    const goalDeadline = deadline.toISOString()

    const result = calculateBaselineCalories(tdee, currentWeightKg, goalWeightKg, goalDeadline, gender)

    // 10kg loss = 77,000 kcal total, over 91 days (inclusive) = ~846 kcal/day deficit
    expect(result.requiredDailyDeficit).toBeGreaterThan(0)
    expect(result.baselineCalories).toBeLessThan(tdee)
    expect(result.warnings).toEqual([])
  })

  it('uses phase start date when it is in the future', () => {
    // Phase starts 30 days from now, deadline 120 days from now
    const now = new Date()
    const futureStart = new Date(now)
    futureStart.setDate(now.getDate() + 30)
    const deadline = new Date(now)
    deadline.setDate(now.getDate() + 120)

    const resultWithFutureStart = calculateBaselineCalories(
      tdee, currentWeightKg, goalWeightKg, deadline.toISOString(), gender,
      futureStart.toISOString()
    )

    // Without start date, uses today → 120 days
    const resultWithoutStart = calculateBaselineCalories(
      tdee, currentWeightKg, goalWeightKg, deadline.toISOString(), gender
    )

    // Future start → 91 days inclusive (120 - 30 + 1), so deficit should be LARGER (more aggressive)
    expect(resultWithFutureStart.requiredDailyDeficit).toBeGreaterThan(
      resultWithoutStart.requiredDailyDeficit
    )
    // And baseline calories should be LOWER
    expect(resultWithFutureStart.baselineCalories).toBeLessThan(
      resultWithoutStart.baselineCalories
    )
  })

  it('uses today when phase start date is in the past', () => {
    const now = new Date()
    const pastStart = new Date(now)
    pastStart.setDate(now.getDate() - 30)
    const deadline = new Date(now)
    deadline.setDate(now.getDate() + 90)

    const resultWithPastStart = calculateBaselineCalories(
      tdee, currentWeightKg, goalWeightKg, deadline.toISOString(), gender,
      pastStart.toISOString()
    )

    const resultWithoutStart = calculateBaselineCalories(
      tdee, currentWeightKg, goalWeightKg, deadline.toISOString(), gender
    )

    // Past start date should be clamped to today → same result as no start date
    expect(resultWithPastStart.requiredDailyDeficit).toBe(resultWithoutStart.requiredDailyDeficit)
    expect(resultWithPastStart.baselineCalories).toBe(resultWithoutStart.baselineCalories)
  })

  // ===========================================================================
  // Clock independence.
  //
  // This module is pure, so the coach's BROWSER now runs it to preview a plan
  // before the server saves it. That only holds up if the arithmetic does not
  // depend on which machine's clock it runs on: the preview would otherwise
  // show one baseline and the save would store another, which is the single
  // failure this whole feature must not have.
  // ===========================================================================
  describe('is clock-independent', () => {
    const originalTZ = process.env.TZ

    afterEach(() => {
      process.env.TZ = originalTZ
    })

    const run = (tz: string, goalDeadline: string, startDate?: string) => {
      process.env.TZ = tz
      return calculateBaselineCalories(
        tdee, currentWeightKg, goalWeightKg, goalDeadline, gender, startDate, '2026-08-05'
      )
    }

    // +13 and +14 are the cases that actually broke: past those offsets the
    // Math.max below picks the local value and Math.round no longer absorbs
    // the difference. The common zones never diverged, which is exactly why
    // this was invisible while the calculator only ever ran on the server.
    const ZONES = [
      'UTC',
      'Europe/London',
      'America/New_York',
      'America/Los_Angeles',
      'Asia/Kolkata',
      'Australia/Lord_Howe',
      'Pacific/Kiritimati',
      'Pacific/Apia',
    ]

    it('produces an identical baseline in every timezone, with a past goal start', () => {
      const results = ZONES.map((tz) => run(tz, '2026-12-31', '2026-06-01'))
      const baselines = results.map((r) => r.baselineCalories)
      expect(new Set(baselines).size).toBe(1)
      expect(baselines[0]).toBeGreaterThan(0)
    })

    it('produces an identical baseline in every timezone, with a future goal start', () => {
      const baselines = ZONES.map((tz) => run(tz, '2026-12-31', '2026-09-01').baselineCalories)
      expect(new Set(baselines).size).toBe(1)
    })

    // Callers pass both shapes: production sends the DATE column's
    // "YYYY-MM-DD", but toISOString() timestamps reach here too. Appending
    // "T00:00:00" to a full ISO string yields an Invalid Date, and the
    // resulting NaN slips past the minimum-calorie floor silently.
    it('treats a full ISO timestamp and a date-only string as the same day', () => {
      const dateOnly = run('UTC', '2026-12-31', '2026-06-01')
      const isoForm = run('UTC', '2026-12-31T09:12:34.567Z', '2026-06-01T23:45:00.000Z')
      expect(isoForm.baselineCalories).toBe(dateOnly.baselineCalories)
      expect(Number.isNaN(isoForm.baselineCalories)).toBe(false)
    })
  })
})

// The safety-cap warnings used to be sentences with "kg/week" baked in, which
// put the number out of reach of the only layer that knows the viewer's unit.
// They are structured codes carrying raw KILOGRAMS now; the wording lives in
// components/clients/nutrition/nutrition-warnings.tsx.
describe('calculateBaselineCalories — capped-rate warnings', () => {
  const soon = () => {
    const d = new Date()
    d.setDate(d.getDate() + 14)
    return d.toISOString()
  }

  it('emits deficit_capped with the raw kilogram cap, not a sentence', () => {
    // 15kg in two weeks is far past any safe rate.
    const result = calculateBaselineCalories(2400, 90, 75, soon(), 'male')

    expect(result.warnings).toContainEqual({
      code: 'deficit_capped',
      maxWeeklyChangeKg: 1.0,
    })
    expect(result.weeklyRate).toBe(-1.0)
  })

  it('uses the lower female cap', () => {
    const result = calculateBaselineCalories(2400, 90, 75, soon(), 'female')

    expect(result.warnings).toContainEqual({
      code: 'deficit_capped',
      maxWeeklyChangeKg: 0.75,
    })
  })

  it('emits surplus_capped when gaining too fast', () => {
    const result = calculateBaselineCalories(2400, 75, 90, soon(), 'male')

    expect(result.warnings).toContainEqual({
      code: 'surplus_capped',
      maxWeeklyChangeKg: 0.5,
    })
  })

  it('emits deadline_passed for a deadline in the past', () => {
    const past = new Date()
    past.setDate(past.getDate() - 30)

    const result = calculateBaselineCalories(2400, 90, 75, past.toISOString(), 'male')

    expect(result.warnings).toEqual([{ code: 'deadline_passed' }])
  })
})
