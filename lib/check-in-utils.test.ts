import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  formatRelativeTime,
  prepareChartData,
  getStatusLabel,
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

  describe('prepareChartData', () => {
    it('returns empty arrays for empty check-ins', () => {
      const result = prepareChartData([])

      expect(result.weight).toEqual([])
      expect(result.bodyFat).toEqual([])
    })



    it('prepares weight chart data', () => {
      const checkIns = [
        createMockCheckIn({ weight: 180, createdAt: '2024-01-01T00:00:00Z' }),
        createMockCheckIn({ weight: 178, createdAt: '2024-01-08T00:00:00Z' }),
      ]

      const result = prepareChartData(checkIns)

      expect(result.weight).toHaveLength(2)
      expect(result.weight[0].value).toBe(180)
      expect(result.weight[1].value).toBe(178)
    })

    it('prepares body fat chart data', () => {
      const checkIns = [
        createMockCheckIn({ bodyFatPercentage: 16, createdAt: '2024-01-01T00:00:00Z' }),
        createMockCheckIn({ bodyFatPercentage: 15, createdAt: '2024-01-08T00:00:00Z' }),
      ]

      const result = prepareChartData(checkIns)

      expect(result.bodyFat).toHaveLength(2)
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
})
