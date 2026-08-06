import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  formatCheckInDate,
  formatCheckInTime,
  formatRelativeTime,
  calculateProgressComparison,
  prepareChartData,
  getStatusColor,
  getStatusLabel,
  calculateAverage,
  getTrendDirection,
} from './check-in-utils'
import type { CheckIn } from '@/types/check-in'

// Helper to create mock check-ins
function createMockCheckIn(overrides: Partial<CheckIn> = {}): CheckIn {
  return {
    id: 'check-in-1',
    clientId: 'client-1',
    status: 'pending',
    createdAt: '2024-01-15T10:30:00Z',
    updatedAt: '2024-01-15T10:30:00Z',
    ...overrides,
  }
}

describe('Check-in Utilities', () => {
  describe('formatCheckInDate', () => {
    it('formats a date string correctly', () => {
      const result = formatCheckInDate('2024-01-15T10:30:00Z')
      expect(result).toBe('Jan 15, 2024')
    })

    it('handles different months', () => {
      expect(formatCheckInDate('2024-06-01T00:00:00Z')).toBe('Jun 1, 2024')
      expect(formatCheckInDate('2024-12-25T00:00:00Z')).toBe('Dec 25, 2024')
    })
  })

  describe('formatCheckInTime', () => {
    it('formats time in 12-hour format', () => {
      const result = formatCheckInTime('2024-01-15T10:30:00Z')
      // Note: This will depend on the timezone of the test runner
      expect(result).toMatch(/\d{1,2}:\d{2}\s(AM|PM)/i)
    })

    it('handles afternoon times', () => {
      const result = formatCheckInTime('2024-01-15T15:45:00Z')
      expect(result).toMatch(/\d{1,2}:\d{2}\s(AM|PM)/i)
    })
  })

  describe('formatRelativeTime', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns "X minutes ago" for recent times', () => {
      vi.setSystemTime(new Date('2024-01-15T10:35:00Z'))
      const result = formatRelativeTime('2024-01-15T10:30:00Z')
      expect(result).toContain('5 minutes ago')
    })

    it('returns "X hours ago" for same day', () => {
      vi.setSystemTime(new Date('2024-01-15T15:30:00Z'))
      const result = formatRelativeTime('2024-01-15T10:30:00Z')
      expect(result).toContain('5 hours ago')
    })

    it('returns "X days ago" for past days', () => {
      vi.setSystemTime(new Date('2024-01-18T10:30:00Z'))
      const result = formatRelativeTime('2024-01-15T10:30:00Z')
      expect(result).toContain('3 days ago')
    })
  })

  describe('calculateProgressComparison', () => {
    it('calculates weight change', () => {
      const current = createMockCheckIn({ weight: 178, weightUnit: 'lbs' })
      const previous = createMockCheckIn({ weight: 180, weightUnit: 'lbs' })

      const result = calculateProgressComparison(current, previous)

      expect(result.changes.weight).toBe(-2)
    })

    it('calculates body fat change', () => {
      const current = createMockCheckIn({ bodyFatPercentage: 14.5 })
      const previous = createMockCheckIn({ bodyFatPercentage: 15.0 })

      const result = calculateProgressComparison(current, previous)

      expect(result.changes.bodyFatPercentage).toBe(-0.5)
    })

    it('calculates measurement changes', () => {
      const current = createMockCheckIn({
        waist: 31,
        hips: 37,
        chest: 43,
        arms: 15,
        thighs: 23,
      })
      const previous = createMockCheckIn({
        waist: 32,
        hips: 38,
        chest: 42,
        arms: 14,
        thighs: 24,
      })

      const result = calculateProgressComparison(current, previous)

      expect(result.changes.measurements?.waist).toBe(-1)
      expect(result.changes.measurements?.hips).toBe(-1)
      expect(result.changes.measurements?.chest).toBe(1)
      expect(result.changes.measurements?.arms).toBe(1)
      expect(result.changes.measurements?.thighs).toBe(-1)
    })

    it('calculates adherence change', () => {
      const current = createMockCheckIn({ adherencePercentage: 90 })
      const previous = createMockCheckIn({ adherencePercentage: 80 })

      const result = calculateProgressComparison(current, previous)

      expect(result.changes.adherence).toBe(10)
    })

    it('returns empty changes when no previous check-in', () => {
      const current = createMockCheckIn({ weight: 180 })

      const result = calculateProgressComparison(current)

      expect(result.changes).toEqual({})
      expect(result.previous).toBeUndefined()
    })

    it('skips metrics that are not present in both check-ins', () => {
      const current = createMockCheckIn({ weight: 180 })
      const previous = createMockCheckIn({ bodyFatPercentage: 15 })

      const result = calculateProgressComparison(current, previous)

      expect(result.changes.weight).toBeUndefined()
      expect(result.changes.bodyFatPercentage).toBeUndefined()
    })
  })

  describe('prepareChartData', () => {
    it('returns empty arrays for empty check-ins', () => {
      const result = prepareChartData([])

      expect(result.weight).toEqual([])
      expect(result.bodyFat).toEqual([])
      expect(result.adherence).toEqual([])
      expect(result.mood).toEqual([])
      expect(result.energy).toEqual([])
      expect(result.sleep).toEqual([])
      expect(result.stress).toEqual([])
      expect(result.soreness).toEqual([])
    })

    it('prepares sleep and stress chart data', () => {
      const checkIns = [
        createMockCheckIn({ sleep: 7, stress: 3, createdAt: '2024-01-01T00:00:00Z' }),
        createMockCheckIn({ sleep: 8, stress: 2, createdAt: '2024-01-08T00:00:00Z' }),
      ]

      const result = prepareChartData(checkIns)

      expect(result.sleep).toHaveLength(2)
      expect(result.sleep[0].label).toBe('7/10')
      expect(result.stress).toHaveLength(2)
      expect(result.stress[1].value).toBe(2)
    })

    it('prepares soreness chart data with /10 labels', () => {
      const checkIns = [
        createMockCheckIn({ soreness: 7, createdAt: '2024-01-01T00:00:00Z' }),
        createMockCheckIn({ soreness: 4, createdAt: '2024-01-08T00:00:00Z' }),
      ]

      const result = prepareChartData(checkIns)

      expect(result.soreness).toHaveLength(2)
      expect(result.soreness[0].label).toBe('7/10')
      expect(result.soreness[1].value).toBe(4)
    })

    it('prepares weight chart data', () => {
      const checkIns = [
        createMockCheckIn({ weight: 180, weightUnit: 'lbs', createdAt: '2024-01-01T00:00:00Z' }),
        createMockCheckIn({ weight: 178, weightUnit: 'lbs', createdAt: '2024-01-08T00:00:00Z' }),
      ]

      const result = prepareChartData(checkIns)

      expect(result.weight).toHaveLength(2)
      expect(result.weight[0].value).toBe(180)
      expect(result.weight[0].label).toBe('180 lbs')
      expect(result.weight[1].value).toBe(178)
    })

    it('prepares body fat chart data', () => {
      const checkIns = [
        createMockCheckIn({ bodyFatPercentage: 16, createdAt: '2024-01-01T00:00:00Z' }),
        createMockCheckIn({ bodyFatPercentage: 15, createdAt: '2024-01-08T00:00:00Z' }),
      ]

      const result = prepareChartData(checkIns)

      expect(result.bodyFat).toHaveLength(2)
      expect(result.bodyFat[0].label).toBe('16%')
    })

    it('prepares mood chart data', () => {
      const checkIns = [
        createMockCheckIn({ mood: 4, createdAt: '2024-01-01T00:00:00Z' }),
        createMockCheckIn({ mood: 5, createdAt: '2024-01-08T00:00:00Z' }),
      ]

      const result = prepareChartData(checkIns)

      expect(result.mood).toHaveLength(2)
      expect(result.mood[0].label).toBe('4/5')
    })

    it('prepares energy chart data', () => {
      const checkIns = [
        createMockCheckIn({ energy: 7, createdAt: '2024-01-01T00:00:00Z' }),
        createMockCheckIn({ energy: 8, createdAt: '2024-01-08T00:00:00Z' }),
      ]

      const result = prepareChartData(checkIns)

      expect(result.energy).toHaveLength(2)
      expect(result.energy[0].label).toBe('7/10')
    })

    it('sorts check-ins by date ascending', () => {
      const checkIns = [
        createMockCheckIn({ weight: 178, createdAt: '2024-01-15T00:00:00Z' }),
        createMockCheckIn({ weight: 180, createdAt: '2024-01-01T00:00:00Z' }),
        createMockCheckIn({ weight: 179, createdAt: '2024-01-08T00:00:00Z' }),
      ]

      const result = prepareChartData(checkIns)

      expect(result.weight[0].value).toBe(180)
      expect(result.weight[1].value).toBe(179)
      expect(result.weight[2].value).toBe(178)
    })

    it('skips check-ins without the metric', () => {
      const checkIns = [
        createMockCheckIn({ weight: 180, createdAt: '2024-01-01T00:00:00Z' }),
        createMockCheckIn({ createdAt: '2024-01-08T00:00:00Z' }), // No weight
        createMockCheckIn({ weight: 178, createdAt: '2024-01-15T00:00:00Z' }),
      ]

      const result = prepareChartData(checkIns)

      expect(result.weight).toHaveLength(2)
    })
  })

  describe('getStatusColor', () => {
    it('returns warning classes for pending', () => {
      const result = getStatusColor('pending')
      expect(result).toContain('warning')
    })

    it('returns primary classes for ai_processed', () => {
      const result = getStatusColor('ai_processed')
      expect(result).toContain('primary')
    })

    it('returns success classes for reviewed', () => {
      const result = getStatusColor('reviewed')
      expect(result).toContain('success')
    })

    it('returns muted classes for unknown status', () => {
      const result = getStatusColor('unknown' as any)
      expect(result).toContain('muted')
    })
  })

  describe('getStatusLabel', () => {
    it('returns "Pending" for pending', () => {
      expect(getStatusLabel('pending')).toBe('Pending')
    })

    it('returns "AI Processed" for ai_processed', () => {
      expect(getStatusLabel('ai_processed')).toBe('AI Processed')
    })

    it('returns "Reviewed" for reviewed', () => {
      expect(getStatusLabel('reviewed')).toBe('Reviewed')
    })

    it('returns "Unknown" for unknown status', () => {
      expect(getStatusLabel('unknown' as any)).toBe('Unknown')
    })
  })

  describe('calculateAverage', () => {
    it('calculates average of numbers', () => {
      const result = calculateAverage([1, 2, 3, 4, 5])
      expect(result).toBe(3)
    })

    it('filters out undefined values', () => {
      const result = calculateAverage([1, undefined, 3, undefined, 5])
      expect(result).toBe(3)
    })

    it('returns 0 for empty array', () => {
      const result = calculateAverage([])
      expect(result).toBe(0)
    })

    it('returns 0 for all undefined values', () => {
      const result = calculateAverage([undefined, undefined, undefined])
      expect(result).toBe(0)
    })

    it('handles single value', () => {
      const result = calculateAverage([42])
      expect(result).toBe(42)
    })
  })

  describe('getTrendDirection', () => {
    it('returns "up" for increase above threshold', () => {
      const result = getTrendDirection(10, 8)
      expect(result).toBe('up')
    })

    it('returns "down" for decrease above threshold', () => {
      const result = getTrendDirection(8, 10)
      expect(result).toBe('down')
    })

    it('returns "stable" for small changes within default threshold', () => {
      const result = getTrendDirection(10, 10.3)
      expect(result).toBe('stable')
    })

    it('respects custom threshold', () => {
      const result = getTrendDirection(10, 11, 2)
      expect(result).toBe('stable')
    })

    it('returns "up" when change equals threshold', () => {
      const result = getTrendDirection(10.5, 10, 0.5)
      // 0.5 difference is not less than 0.5 threshold, so it's "up"
      expect(result).toBe('up')
    })

    it('handles negative numbers', () => {
      expect(getTrendDirection(-5, -10)).toBe('up')
      expect(getTrendDirection(-10, -5)).toBe('down')
    })

    it('handles zero', () => {
      expect(getTrendDirection(5, 0)).toBe('up')
      expect(getTrendDirection(0, 5)).toBe('down')
      expect(getTrendDirection(0, 0)).toBe('stable')
    })
  })
})
