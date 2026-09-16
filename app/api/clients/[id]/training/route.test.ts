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

vi.mock('@/services/client-goals-service', () => ({
  getCurrentGoals: vi.fn(),
}))

vi.mock('@/services/training-event-service', () => ({
  cancelFutureEventsForPlan: vi.fn().mockResolvedValue(undefined),
  cancelFutureEventsForPlans: vi.fn().mockResolvedValue(undefined),
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
import { cancelFutureEventsForPlans } from '@/services/training-event-service'
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

// Fixed dates after the mocked client-today (2026-01-15): the route resolves a
// queued plan by effective_from > the day it asks about. The lookup is the
// shared getNextFutureTrainingPlan (which owns the deleted/archived
// exclusions), so the route test stubs the service rather than a query chain —
// the predicate is covered where it lives, in the service.
const upcomingRow = {
  id: 'plan-upcoming',
  effectiveFrom: '2026-01-19',
  effectiveUntil: '2026-02-15',
  name: 'Scheduled Plan',
  splitType: 'full_body',
  frequencyPerWeek: 3,
  programDurationWeeks: 4,
}

const behindRow = {
  id: 'plan-behind',
  effectiveFrom: '2026-02-16',
  effectiveUntil: '2026-03-15',
  name: 'Strength',
  splitType: 'upper_lower',
  frequencyPerWeek: 4,
  programDurationWeeks: 4,
}

/** The queued plan starting after each day: the first after today, and the
 *  one behind it. */
function mockQueued(afterToday: typeof upcomingRow | null, behind: typeof behindRow | null = null): void {
  vi.mocked(getNextFutureTrainingPlan).mockImplementation((_clientId, date) =>
    Promise.resolve(
      date === '2026-01-15' ? afterToday : date === upcomingRow.effectiveFrom ? behind : null
    )
  )
}

function makeGetRequest(): NextRequest {
  return new NextRequest('http://localhost/api/clients/client-1/training')
}

const get = async () => {
  const response = await GET(makeGetRequest(), { params: Promise.resolve({ id: 'client-1' }) })
  return { response, data: await response.json() }
}

describe('Training Route GET - the hero\'s program and the one after it', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getClientById).mockResolvedValue({
      ...mockClient,
      timezone: 'Europe/London',
    } as never)
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue('2026-01-15')
  })

  it('running + queued: the running program, with the queued one next', async () => {
    vi.mocked(getTrainingPlanForDate).mockResolvedValue(activePlan as never)
    mockQueued(upcomingRow)

    const { response, data } = await get()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.plan.id).toBe('plan-active')
    expect(data.nextPlan).toEqual({ id: 'plan-upcoming', name: 'Scheduled Plan', effectiveFrom: '2026-01-19' })
    // The running program is already whole; the queued one is only named.
    expect(getTrainingPlanById).not.toHaveBeenCalled()
  })

  it('queued only: the first queued program, with the one queued behind it next', async () => {
    vi.mocked(getTrainingPlanForDate).mockResolvedValue(null)
    vi.mocked(getTrainingPlanById).mockResolvedValue(upcomingFullPlan as never)
    mockQueued(upcomingRow, behindRow)

    const { data } = await get()

    expect(data.plan.id).toBe('plan-upcoming')
    expect(data.nextPlan).toEqual({ id: 'plan-behind', name: 'Strength', effectiveFrom: '2026-02-16' })
    expect(getTrainingPlanById).toHaveBeenCalledWith('plan-upcoming')
    expect(getNextFutureTrainingPlan).toHaveBeenCalledWith('client-1', '2026-01-19')
  })

  it('one queued program and nothing behind it: no next program', async () => {
    vi.mocked(getTrainingPlanForDate).mockResolvedValue(null)
    vi.mocked(getTrainingPlanById).mockResolvedValue(upcomingFullPlan as never)
    mockQueued(upcomingRow, null)

    const { data } = await get()

    expect(data.plan.id).toBe('plan-upcoming')
    expect(data.nextPlan).toBeNull()
  })

  it('no plans at all: no program and no next one, the days still answered', async () => {
    vi.mocked(getTrainingPlanForDate).mockResolvedValue(null)
    mockQueued(null)

    const { response, data } = await get()

    expect(response.status).toBe(200)
    expect(data.plan).toBeNull()
    expect(data.nextPlan).toBeNull()
    expect(data.clientToday).toBe('2026-01-15')
    expect(data.clientTimezone).toBe('Europe/London')
  })

  it('a queued row whose full read fails: no phantom program, and no next one either', async () => {
    vi.mocked(getTrainingPlanForDate).mockResolvedValue(null)
    vi.mocked(getTrainingPlanById).mockResolvedValue(null)
    mockQueued(upcomingRow, behindRow)

    const { response, data } = await get()

    expect(response.status).toBe(200)
    expect(data.plan).toBeNull()
    expect(data.nextPlan).toBeNull()
  })

  it("carries the client's today and the deletion floor resolved from it", async () => {
    vi.mocked(getTrainingPlanForDate).mockResolvedValue(activePlan as never)
    mockQueued(null)
    // The client has logged a workout today, so a program can start tomorrow.
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue('2026-01-16')

    const { data } = await get()

    expect(resolveEventDeletionFloor).toHaveBeenCalledWith('client-1', '2026-01-15')
    expect(data.clientToday).toBe('2026-01-15')
    expect(data.planStartFloor).toBe('2026-01-16')
    expect(data).not.toHaveProperty('scheduledFor')
    expect(data).not.toHaveProperty('upcomingPlan')
  })
})

// ===========================================================================
// DELETE — "Delete the training plan": retires every program the client is on
// and removes their upcoming sessions.
// ===========================================================================

describe('Training Route DELETE - the shared deletion floor', () => {
  /** Every program is running: started before today, reaching past it. The
   *  chain is thenable so the read, the cap and the archive all resolve. */
  const wirePlans = (ids: string[]) => {
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'neq', 'gte', 'lte', 'in', 'update']) {
      chain[m] = vi.fn(() => chain)
    }
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({
        data: ids.map((id) => ({ id, effective_from: '2026-01-01', effective_until: '2026-03-01' })),
        error: null,
      }).then(resolve)
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
    expect(cancelFutureEventsForPlans).toHaveBeenCalledWith(['plan-41'], '2026-01-16')
    expect(resolveEventDeletionFloor).toHaveBeenCalledWith('client-1', '2026-01-15')
  })

  it('resolves the floor ONCE and cancels ONCE however many programs it retires', async () => {
    // Round trips stay constant, not per-plan (CONVENTIONS §2 item 7).
    wirePlans(['plan-63', 'plan-64', 'plan-65'])

    await call()

    expect(resolveEventDeletionFloor).toHaveBeenCalledTimes(1)
    expect(cancelFutureEventsForPlans).toHaveBeenCalledTimes(1)
    expect(cancelFutureEventsForPlans).toHaveBeenCalledWith(['plan-63', 'plan-64', 'plan-65'], '2026-01-16')
  })
})
