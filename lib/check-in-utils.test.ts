import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  formatRelativeTime,
  getStatusLabel,
} from './check-in-utils'

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
