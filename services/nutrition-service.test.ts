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
})
