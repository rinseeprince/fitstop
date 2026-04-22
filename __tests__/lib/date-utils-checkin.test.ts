import { describe, it, expect } from 'vitest'
import { getCheckInStatus } from '@/lib/date-helpers'

describe('getCheckInStatus', () => {
  // Helper: create a Date from an ISO string in local time
  const d = (iso: string) => new Date(iso + 'T12:00:00')

  describe('late submission for previous period does NOT block current period', () => {
    it('returns available when last check-in period_end is from previous week', () => {
      // Client check-in day: sunday
      // Last check-in covered Mar 2–8 (period_end = "2026-03-08")
      // Today is Sunday Mar 15 (current period: Mar 9–15)
      const result = getCheckInStatus('sunday', '2026-03-08', d('2026-03-15'))
      expect(result.status).toBe('available')
      expect(result.periodEnd).toBe('2026-03-15')
    })

    it('returns overdue when past due day and last check-in is from previous period', () => {
      // Today is Tuesday Mar 17, check-in day is Sunday
      // Last check-in covered Mar 2–8, current period is Mar 9–15
      const result = getCheckInStatus('sunday', '2026-03-08', d('2026-03-17'))
      expect(result.status).toBe('overdue')
    })
  })

  describe('same-period check-in correctly returns completed', () => {
    it('returns completed when last check-in period_end matches current period', () => {
      // Last check-in covered Mar 9–15 (period_end = "2026-03-15")
      // Today is Sunday Mar 15
      const result = getCheckInStatus('sunday', '2026-03-15', d('2026-03-15'))
      expect(result.status).toBe('completed')
    })

    it('returns completed when checked in for current period and today is after due day', () => {
      // Last check-in covered Mar 9–15 (period_end = "2026-03-15")
      // Today is Wednesday Mar 18 (still in grace window, period is still Mar 9–15)
      const result = getCheckInStatus('sunday', '2026-03-15', d('2026-03-18'))
      expect(result.status).toBe('completed')
    })
  })

  describe('new client with no prior check-ins', () => {
    it('returns available when no check-ins exist and today is the due day', () => {
      const result = getCheckInStatus('sunday', null, d('2026-03-15'))
      expect(result.status).toBe('available')
    })

    it('returns not_due when no check-ins exist and today is past the due day', () => {
      const result = getCheckInStatus('sunday', null, d('2026-03-17'))
      expect(result.status).toBe('not_due')
      expect(result.nextDueDate).toBe('2026-03-22')
    })

    it('returns not_due when no check-ins and today is before due day', () => {
      const result = getCheckInStatus('sunday', null, d('2026-03-12'))
      expect(result.status).toBe('not_due')
    })
  })

  describe('standard gating states', () => {
    it('returns overdue mid-week when last check-in is from a prior period', () => {
      // Check-in day: sunday. Today: Wednesday Mar 11.
      // Current period is Mar 2–8 (most recent Sunday = Mar 8, already past)
      // Last check-in covered Feb 23–Mar 1 period → client is overdue for Mar 2–8
      const result = getCheckInStatus('sunday', '2026-03-01', d('2026-03-11'))
      expect(result.status).toBe('overdue')
    })

    it('returns available on the due day with no check-in for current period', () => {
      const result = getCheckInStatus('sunday', '2026-03-08', d('2026-03-15'))
      expect(result.status).toBe('available')
    })

    it('returns overdue after the due day with no check-in for current period', () => {
      const result = getCheckInStatus('sunday', '2026-03-08', d('2026-03-17'))
      expect(result.status).toBe('overdue')
    })
  })

  describe('period calculation', () => {
    it('returns correct periodStart and periodEnd', () => {
      const result = getCheckInStatus('sunday', null, d('2026-03-15'))
      expect(result.periodStart).toBe('2026-03-09')
      expect(result.periodEnd).toBe('2026-03-15')
    })

    it('returns nextDueDate one week after periodEnd when completed', () => {
      const result = getCheckInStatus('sunday', '2026-03-15', d('2026-03-15'))
      expect(result.nextDueDate).toBe('2026-03-22')
    })
  })
})
