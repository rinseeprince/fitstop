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
  archiveTrainingPlan: vi.fn().mockResolvedValue(undefined),
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

vi.mock('@/services/client-goals-service', () => ({
  getCurrentGoals: vi.fn(),
}))

vi.mock('@/services/training-event-service', () => ({
  cancelFutureEventsForPlan: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/services/nutrition-event-service', () => ({
  cascadeNutritionAfterTrainingChange: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/services/event-deletion-floor', () => ({
  // The one shared answer to "from which day may events be removed?" — its own
  // rules are proved in services/event-deletion-floor.test.ts.
  resolveEventDeletionFloor: vi.fn().mockResolvedValue('2026-01-16'),
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
import { supabaseAdmin } from '@/services/supabase-admin'
import { cancelFutureEventsForPlan } from '@/services/training-event-service'
import { cascadeNutritionAfterTrainingChange } from '@/services/nutrition-event-service'
import { resolveEventDeletionFloor } from '@/services/event-deletion-floor'
import { GET, DELETE } from './route'

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
  effectiveUntil: '2026-02-15',
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

// ===========================================================================
// DELETE — "Delete the training plan": retires every program the client is on
// and removes their upcoming sessions.
// ===========================================================================

describe('Training Route DELETE - the shared deletion floor', () => {
  const wirePlans = (ids: string[]) => {
    const chain: Record<string, unknown> = {}
    Object.assign(chain, {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      is: vi.fn(() => chain),
      neq: vi.fn().mockResolvedValue({ data: ids.map((id) => ({ id })), error: null }),
    })
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as never)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getClientById).mockResolvedValue(mockClient as never)
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue('2026-01-16')
  })

  const call = () =>
    DELETE(new NextRequest('http://localhost/api/clients/client-1/training', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'client-1' }),
    })

  it('clears from the FLOOR, not from the client-local today', async () => {
    // The client logged today, so the floor is tomorrow. Passing `today` here
    // would delete a session on a day they have already trained.
    wirePlans(['plan-41'])

    const response = await call()

    expect(response.status).toBe(200)
    expect(cancelFutureEventsForPlan).toHaveBeenCalledWith('plan-41', '2026-01-16')
    expect(resolveEventDeletionFloor).toHaveBeenCalledWith('client-1', '2026-01-15')
  })

  it('resolves the floor ONCE however many programs it retires', async () => {
    // Round trips stay constant, not per-plan (CONVENTIONS §2 item 7).
    wirePlans(['plan-63', 'plan-64', 'plan-65'])

    await call()

    expect(resolveEventDeletionFloor).toHaveBeenCalledTimes(1)
    expect(cancelFutureEventsForPlan).toHaveBeenCalledTimes(3)
  })

  it('still cascades nutrition from TODAY — a regenerate replaces, it never empties', async () => {
    // Only removals need the floor. Nutrition on the floored-out day is
    // rewritten with the same numbers, which is why it is safe.
    wirePlans(['plan-88'])

    await call()

    expect(cascadeNutritionAfterTrainingChange).toHaveBeenCalledWith(
      'client-1',
      expect.objectContaining({ kind: 'from', from: '2026-01-15' }),
      expect.any(String)
    )
  })
})
