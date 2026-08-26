import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/services/client-service', () => ({
  getClientById: vi.fn(),
}))

vi.mock('@/services/check-in-service', () => ({
  getClientCheckIns: vi.fn().mockResolvedValue({ checkIns: [] }),
}))

vi.mock('@/services/training-service', () => ({
  getTrainingPlanForDate: vi.fn().mockResolvedValue(null),
  getNextFutureTrainingPlan: vi.fn().mockResolvedValue(null),
  getTrainingPlanById: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/services/today-service', () => ({
  getClientTodayString: vi.fn().mockResolvedValue('2026-01-15'),
}))

vi.mock('@/lib/auth-helpers', () => ({
  getAuthenticatedCoachId: vi.fn().mockResolvedValue('coach-1'),
}))

vi.mock('@/lib/rate-limit', () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/csrf-protection', () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/services/body-metrics-service', () => ({
  getLatestBodyMetrics: vi.fn(),
}))

vi.mock('@/services/client-goals-service', () => ({
  getCurrentGoals: vi.fn(),
}))

vi.mock('@/services/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          }),
        }),
      }),
    }),
  },
}))

import { getClientById } from '@/services/client-service'
import {
  getTrainingPlanForDate,
  getNextFutureTrainingPlan,
  getTrainingPlanById,
} from '@/services/training-service'
import { GET } from './route'

const mockClient = {
  id: 'client-1',
  coachId: 'coach-1',
  name: 'Test Client',
  currentWeight: 180,
  weightUnit: 'lbs' as const,
  currentBodyFatPercentage: 20,
  goalWeight: 170,
  goalBodyFatPercentage: 15,
  tdee: 2100,
  bmr: 1700,
  gender: 'male',
}

// --- GET: scheduled-plan-as-working-plan semantics ---

const activePlan = {
  id: 'plan-active',
  clientId: 'client-1',
  name: 'Active Plan',
  status: 'active',
  splitType: 'upper_lower',
  frequencyPerWeek: 4,
  sessions: [],
}

const upcomingFullPlan = {
  id: 'plan-upcoming',
  clientId: 'client-1',
  name: 'Scheduled Plan',
  status: 'active',
  splitType: 'full_body',
  frequencyPerWeek: 3,
  sessions: [],
}

// Fixed date after the mocked client-today (2026-01-15): the route resolves the
// "next future plan" by effective_from > today. The lookup is now the shared
// getNextFutureTrainingPlan (which owns the deleted/archived exclusions), so the
// route test stubs the service rather than a hand-rolled query chain — the
// archived predicate is covered where it lives, in the service.
const upcomingRow = {
  id: 'plan-upcoming',
  effectiveFrom: '2026-01-19',
  name: 'Scheduled Plan',
  splitType: 'full_body',
  frequencyPerWeek: 3,
  programDurationWeeks: 4,
}

function mockUpcomingPlanRow(row: typeof upcomingRow | null): void {
  vi.mocked(getNextFutureTrainingPlan).mockResolvedValue(row)
}

function makeGetRequest(): NextRequest {
  return new NextRequest('http://localhost/api/clients/client-1/training')
}

describe('Training Route GET - scheduled plan semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getClientById).mockResolvedValue({
      ...mockClient,
      timezone: 'Europe/London',
    } as never)
  })

  it('upcoming-only: returns the future-dated plan as plan with scheduledFor set', async () => {
    vi.mocked(getTrainingPlanForDate).mockResolvedValue(null)
    vi.mocked(getTrainingPlanById).mockResolvedValue(upcomingFullPlan as never)
    mockUpcomingPlanRow(upcomingRow)

    const response = await GET(makeGetRequest(), {
      params: Promise.resolve({ id: 'client-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.plan.id).toBe('plan-upcoming')
    expect(data.scheduledFor).toBe('2026-01-19')
    expect(data.upcomingPlan).toBeNull()
    expect(data.clientTimezone).toBe('Europe/London')
  })

  it('active + upcoming: returns the active plan with upcomingPlan set and no scheduledFor', async () => {
    vi.mocked(getTrainingPlanForDate).mockResolvedValue(activePlan as never)
    vi.mocked(getTrainingPlanById).mockResolvedValue(upcomingFullPlan as never)
    mockUpcomingPlanRow(upcomingRow)

    const response = await GET(makeGetRequest(), {
      params: Promise.resolve({ id: 'client-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.plan.id).toBe('plan-active')
    expect(data.upcomingPlan).toMatchObject({
      id: 'plan-upcoming',
      effectiveFrom: '2026-01-19',
      name: 'Scheduled Plan',
    })
    expect(data.scheduledFor).toBeNull()
  })

  it('no plans at all: plan, upcomingPlan and scheduledFor are all null', async () => {
    vi.mocked(getTrainingPlanForDate).mockResolvedValue(null)
    vi.mocked(getTrainingPlanById).mockResolvedValue(null)
    mockUpcomingPlanRow(null)

    const response = await GET(makeGetRequest(), {
      params: Promise.resolve({ id: 'client-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.plan).toBeNull()
    expect(data.upcomingPlan).toBeNull()
    expect(data.scheduledFor).toBeNull()
    expect(data.clientTimezone).toBe('Europe/London')
  })

  it('upcoming row exists but full fetch fails: no phantom scheduledFor', async () => {
    vi.mocked(getTrainingPlanForDate).mockResolvedValue(null)
    vi.mocked(getTrainingPlanById).mockResolvedValue(null)
    mockUpcomingPlanRow(upcomingRow)

    const response = await GET(makeGetRequest(), {
      params: Promise.resolve({ id: 'client-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.plan).toBeNull()
    expect(data.scheduledFor).toBeNull()
  })
})
