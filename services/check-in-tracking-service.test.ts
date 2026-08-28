import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock supabase-admin before importing the service (it throws without env vars)
vi.mock('@/services/supabase-admin', () => ({ supabaseAdmin: {} }))
vi.mock('@/services/client-service', () => ({ getClientsForCoach: vi.fn(), getClientById: vi.fn() }))

import {
  resolveCheckInDue,
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
    nextCheckInDue: '2026-03-15', // a Sunday
    ...overrides,
  }
}

function toISO(date: Date | null): string | null {
  if (!date) return null
  return date.toISOString().split('T')[0]
}

describe('resolveCheckInDue', () => {
  beforeEach(() => {
    // Fix "today" to Tuesday Mar 17, 2026
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-17T12:00:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads the stored date, in the past and all', () => {
    // A past due date is not a bug: it IS how overdue is defined, and it drives
    // the roster's Overdue view, the sidebar badge and the reminder sweep.
    expect(toISO(resolveCheckInDue(makeClient()))).toBe('2026-03-15')
  })

  it('reads a future date unchanged', () => {
    const client = makeClient({ nextCheckInDue: '2026-03-22' })
    expect(toISO(resolveCheckInDue(client))).toBe('2026-03-22')
  })

  it('holds a due date inside the grace window rather than rolling it', () => {
    // Mar 10 is 7 days back — still satisfiable, so still the live one.
    const client = makeClient({ nextCheckInDue: '2026-03-10' })
    expect(toISO(resolveCheckInDue(client))).toBe('2026-03-10')
  })

  it('rolls a LAPSED due date forward by whole frequency steps', () => {
    // Mar 8 is 9 days back — past the 7-day grace, so it lapsed and the next
    // one became live. Without this a client who stopped checking in a year ago
    // would read as 365 days overdue instead of being measured against the
    // check-in they can still do something about.
    const client = makeClient({ nextCheckInDue: '2026-03-08' })
    expect(toISO(resolveCheckInDue(client))).toBe('2026-03-15')
  })

  it('rolls by the FREQUENCY, so a fortnightly client advances a fortnight', () => {
    // The old derivation ignored frequency entirely and handed every client a
    // weekly period, so all fortnightly clients were silently treated as weekly.
    const client = makeClient({
      checkInFrequency: 'biweekly',
      nextCheckInDue: '2026-02-15',
    })
    expect(toISO(resolveCheckInDue(client))).toBe('2026-03-15')
  })

  it('honours a custom interval', () => {
    const client = makeClient({
      checkInFrequency: 'custom',
      checkInFrequencyDays: 10,
      nextCheckInDue: '2026-02-25',
    })
    // Feb 25 + 10 = Mar 7, + 10 = Mar 17 — the first that is not lapsed.
    expect(toISO(resolveCheckInDue(client))).toBe('2026-03-17')
  })

  it('returns null when frequency is none', () => {
    expect(resolveCheckInDue(makeClient({ checkInFrequency: 'none' }))).toBeNull()
  })

  it('returns null when the client has no schedule', () => {
    // A NULL due date replaces the old frequency='none' special case, and it is
    // what the picker writes when the coach leaves the date empty.
    expect(resolveCheckInDue(makeClient({ nextCheckInDue: undefined }))).toBeNull()
    expect(isClientOverdue(makeClient({ nextCheckInDue: undefined }))).toBe(false)
    expect(getDaysUntilOrPastDue(makeClient({ nextCheckInDue: undefined }))).toBe(0)
  })

  it('does not consult the last check-in at all', () => {
    // The whole point of storing the date: "when is the next one due" no longer
    // has to be reconstructed from what the client last submitted.
    const withHistory = makeClient({
      lastCheckInDate: '2026-03-15T00:00:00Z',
      lastCheckInPeriodEnd: '2026-03-15',
    })
    expect(toISO(resolveCheckInDue(withHistory))).toBe(toISO(resolveCheckInDue(makeClient())))
  })
})

describe("overdue detection uses the CLIENT's local today (Session 7.84)", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a client whose due day arrived in THEIR zone is due today, not flagged a day early or late', () => {
    // 12:00 UTC Saturday Mar 14 is already 01:00 Sunday Mar 15 in Auckland
    // (NZDT, UTC+13). Sunday is the due date: the client is DUE TODAY.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-14T12:00:00Z'))

    const client = makeClient({ timezone: 'Pacific/Auckland' })

    expect(toISO(resolveCheckInDue(client))).toBe('2026-03-15')
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

  it('caps at the grace window instead of counting a year of silence', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2027-03-16T12:00:00Z')) // a year on

    // The lapse roll keeps the live due date inside [today - 7, today], so
    // getOverdueSeverity still reads a meaningful "critically overdue" rather
    // than an unbounded number nobody can act on.
    expect(getDaysUntilOrPastDue(makeClient())).toBeLessThanOrEqual(7)
    expect(isClientOverdue(makeClient())).toBe(true)
  })
})
