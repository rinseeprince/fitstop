import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock supabase-admin before importing the service (it throws without env vars)
vi.mock('@/services/supabase-admin', () => ({ supabaseAdmin: {} }))
vi.mock('@/services/client-service', () => ({ getClientsForCoach: vi.fn(), getClientById: vi.fn() }))

import {
  calculateNextExpectedCheckIn,
  isClientOverdue,
  getDaysUntilOrPastDue,
} from '@/services/check-in-tracking-service'
import type { ClientWithCheckInInfo } from '@/types/check-in'

// Helper to build a minimal client for testing
function makeClient(overrides: Partial<ClientWithCheckInInfo> = {}): ClientWithCheckInInfo {
  return {
    id: 'test-id',
    coachId: 'coach-id',
    name: 'Test Client',
    email: 'test@test.com',
    active: true,
    includeActivityBurn: false,
    surplusAsCarbs: false,
    timezone: 'UTC',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    checkInFrequency: 'weekly',
    expectedCheckInDay: 'sunday',
    ...overrides,
  }
}

function toISO(date: Date | null): string | null {
  if (!date) return null
  return date.toISOString().split('T')[0]
}

describe('calculateNextExpectedCheckIn', () => {
  beforeEach(() => {
    // Fix "today" to Tuesday Mar 17, 2026
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-17T12:00:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns current period end when client has missed multiple periods', () => {
    // Last check-in covered Feb 23–Mar 1 (period_end = Mar 1)
    // Missed: Mar 2–8, Mar 9–15
    // Current period: Mar 9–15 (most recent Sunday on or before Mar 17 = Mar 15)
    const client = makeClient({
      lastCheckInDate: '2026-02-27T00:00:00Z',
      lastCheckInPeriodEnd: '2026-03-01',
    })

    const result = calculateNextExpectedCheckIn(client)
    expect(toISO(result)).toBe('2026-03-15')
  })

  it('returns next period end when client already checked in for current period', () => {
    // Last check-in covered Mar 9–15 (period_end = Mar 15)
    // Current period is Mar 9–15, already done → next expected is Mar 22
    const client = makeClient({
      lastCheckInDate: '2026-03-15T00:00:00Z',
      lastCheckInPeriodEnd: '2026-03-15',
    })

    const result = calculateNextExpectedCheckIn(client)
    expect(toISO(result)).toBe('2026-03-22')
  })

  it('returns current period end when client has never checked in', () => {
    // New client, no check-ins. Current period: Mar 9–15
    const client = makeClient({
      lastCheckInDate: undefined,
      lastCheckInPeriodEnd: undefined,
    })

    const result = calculateNextExpectedCheckIn(client)
    expect(toISO(result)).toBe('2026-03-15')
  })

  it('returns null when frequency is none', () => {
    const client = makeClient({ checkInFrequency: 'none' })
    expect(calculateNextExpectedCheckIn(client)).toBeNull()
  })

  it('handles fallback loop for clients without expectedCheckInDay', () => {
    // No specific day, just every 7 days from last check-in
    // Last check-in: Feb 27. Feb 27 + 7 = Mar 6, + 7 = Mar 13, + 7 = Mar 20
    // Mar 20 >= Mar 17 (today), so next expected = Mar 20
    const client = makeClient({
      expectedCheckInDay: undefined,
      lastCheckInDate: '2026-02-27T00:00:00Z',
      lastCheckInPeriodEnd: undefined,
    })

    const result = calculateNextExpectedCheckIn(client)
    expect(toISO(result)).toBe('2026-03-20')
  })
})

describe("overdue detection uses the CLIENT's local today (Session 7.84)", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a client whose due day arrived in THEIR zone is due today, not flagged a day early or late', () => {
    // 12:00 UTC Saturday Mar 14 is already 01:00 Sunday Mar 15 in Auckland
    // (NZDT, UTC+13). Sunday is the check-in day: the client is DUE TODAY.
    // Under server-UTC anchoring this read as Saturday -> the current period
    // ended Mar 8 -> the client was flagged 6 days overdue.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-14T12:00:00Z'))

    const client = makeClient({ timezone: 'Pacific/Auckland' })

    expect(toISO(calculateNextExpectedCheckIn(client))).toBe('2026-03-15')
    expect(isClientOverdue(client)).toBe(false)
    expect(getDaysUntilOrPastDue(client)).toBe(0)
  })

  it('the due day itself counts as due-today, not overdue (accepted 7.84 behavior change)', () => {
    // Midday on the due day (UTC client): previously the wall-clock compare
    // (now > midnight-of-due-day) flagged overdue from 00:01; now the day
    // itself is "due today" and overdue starts the next local day.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T12:00:00Z')) // Sunday, the due day

    const client = makeClient()

    expect(isClientOverdue(client)).toBe(false)
    expect(getDaysUntilOrPastDue(client)).toBe(0)
  })

  it('overdue starts the day after the due day in the client zone', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-16T00:30:00Z')) // Monday, day after

    const client = makeClient()

    expect(isClientOverdue(client)).toBe(true)
    expect(getDaysUntilOrPastDue(client)).toBe(1)
  })
})
