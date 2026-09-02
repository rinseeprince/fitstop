import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/services/client-service', () => ({
  getClientById: vi.fn(),
}))

vi.mock('@/services/nutrition-service', () => ({
  generateNutritionPlan: vi.fn(),
}))

vi.mock('@/services/training-service', () => ({
  getActiveTrainingPlan: vi.fn().mockResolvedValue(null),
  // GET reads these two for `hasTrainingPlan` + the hero's title; POST/DELETE
  // never call them, but the factory must still declare the module's full
  // imported surface.
  getTrainingPlanSummaryForDate: vi.fn().mockResolvedValue(null),
  getNextFutureTrainingPlan: vi.fn().mockResolvedValue(null),
}))

// The orchestrator PROPAGATES event-rewrite failures (previously swallowed),
// so the success-path tests must mock the rewrite as succeeding. The GET's old
// todayEvent probe is retired (migration 144) — the covering VERSION answers
// "is anything running", so this factory no longer declares it.
vi.mock('@/services/nutrition-event-service', () => ({
  regenerateFutureNutritionEvents: vi.fn().mockResolvedValue(undefined),
  deleteFutureNutritionEventsForClient: vi.fn().mockResolvedValue(undefined),
}))

// One self-returning, THENABLE chain serves every direct supabaseAdmin read
// this file reaches: the POST's existing-plan lookup awaits .maybeSingle()
// ({ data: null } → "initial"), and the DELETE's queued-versions select awaits
// the builder itself ({ data: [], error: null } → no queued chain). The deep
// chain semantics are pinned in nutrition-plan-orchestrator.test.ts, not here.
vi.mock('@/services/supabase-admin', () => {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'gt', 'in', 'update', 'delete', 'order', 'limit']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null })
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve, reject)
  return { supabaseAdmin: { from: vi.fn().mockReturnValue(chain) } }
})

vi.mock('@/lib/auth-helpers', () => ({
  getAuthenticatedCoachId: vi.fn().mockResolvedValue('coach-1'),
}))

vi.mock('@/lib/rate-limit', () => ({
  apiRateLimit: vi.fn().mockResolvedValue(null),
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/csrf-protection', () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/validations/nutrition', () => ({
  nutritionPlanSchema: {
    safeParse: vi.fn().mockReturnValue({ success: true, data: {} }),
  },
  nutritionSettingsPatchSchema: {
    safeParse: vi.fn().mockReturnValue({ success: true, data: {} }),
  },
  validateClientForNutrition: vi.fn().mockReturnValue({ valid: true, errors: [] }),
}))

vi.mock('@/services/nutrition-plan-service', () => ({
  createNutritionPlan: vi.fn().mockResolvedValue({}),
  getNutritionPlanForDate: vi.fn().mockResolvedValue({
    id: 'plan-1',
    effective_from: '2025-12-01',
    effective_until: null,
  }),
  getOpenNutritionPlan: vi.fn().mockResolvedValue(null),
  getNextFutureNutritionPlan: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/services/client-goals-service', () => ({
  getCurrentGoals: vi.fn(),
}))

vi.mock('@/services/today-service', () => ({
  getClientTodayString: vi.fn().mockResolvedValue('2026-01-15'),
}))

import { getClientById } from '@/services/client-service'
import { generateNutritionPlan } from '@/services/nutrition-service'
import {
  createNutritionPlan,
  getNutritionPlanForDate,
  getOpenNutritionPlan,
  getNextFutureNutritionPlan,
} from '@/services/nutrition-plan-service'
import { deleteFutureNutritionEventsForClient } from '@/services/nutrition-event-service'
import { getCurrentGoals } from '@/services/client-goals-service'
import { getClientTodayString } from '@/services/today-service'
import { getAuthenticatedCoachId } from '@/lib/auth-helpers'
import { GET, POST, DELETE } from './route'

const mockClient = {
  id: 'client-1',
  coachId: 'coach-1',
  name: 'Test Client',
  currentWeight: 180,
  weightUnit: 'lbs' as const,
  bmr: 1700,
  tdee: 2100,
  goalWeight: 170,
  gender: 'male' as const,
  height: 70,
  heightUnit: 'in' as const,
}

const mockBody = {
  workActivityLevel: 'moderate',
  trainingVolumeHours: '3-5',
  proteinTargetGPerKg: 2.0,
  dietType: 'balanced',
}

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/clients/client-1/nutrition', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('Nutrition Route POST - the calculator reads the client record', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getClientById).mockResolvedValue(mockClient as never)
    vi.mocked(generateNutritionPlan).mockReturnValue({
      baselineCalories: 2000,
      tdee: 2400,
      calorieTarget: 1800,
      proteinTargetG: 160,
      carbTargetG: 200,
      fatTargetG: 60,
      adjustedTdee: 2400,
      weeklyWeightChangeKg: -0.5,
      requiredDailyDeficit: 500,
      warnings: [],
    } as never)
  })

  it('takes the weight from client.currentWeight (the newest log reading) and the energy pair from the profile', async () => {
    // `Client.currentWeight` is filled from `client_current_measurements` in
    // the same round trip as the row (getClientById); there is no second
    // weight store for the calculator to prefer.
    vi.mocked(getClientById).mockResolvedValue({ ...mockClient, currentWeight: 175 } as never)
    vi.mocked(getCurrentGoals).mockResolvedValue({
      id: 'goal-1',
      clientId: 'client-1',
      goalWeight: 165,
      setBy: 'coach',
      effectiveFrom: '2024-01-01T00:00:00Z',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    })

    const request = makeRequest(mockBody)
    await POST(request, { params: Promise.resolve({ id: 'client-1' }) })

    // The client record's currentWeight (175), which is the newest reading in
    // the measurement log. Stored values are kilograms (migration 141), so it
    // must arrive UNCONVERTED — asserting the number itself catches a
    // reintroduced conversion, which asserting "a converter was called" could
    // not.
    expect(generateNutritionPlan).toHaveBeenCalledWith(
      expect.objectContaining({ currentWeightKg: 175 })
    )
    // The energy pair is the profile's (1700): since Session 4B one helper
    // owns clients.bmr/tdee, and it recomputes when a newest reading lands.
    expect(generateNutritionPlan).toHaveBeenCalledWith(
      expect.objectContaining({ bmr: 1700 })
    )
    const createCall = vi.mocked(createNutritionPlan).mock.calls[0][0]
    expect(createCall.bmr).toBe(1700)
    expect(createCall.baseWeightKg).toBe(175)
  })

  it('falls back to the client goal fields when getCurrentGoals returns null', async () => {
    vi.mocked(getClientById).mockResolvedValue({ ...mockClient, currentWeight: 175 } as never)
    vi.mocked(getCurrentGoals).mockResolvedValue(null)

    const request = makeRequest(mockBody)
    await POST(request, { params: Promise.resolve({ id: 'client-1' }) })

    // The weight is still the record's (175); goalWeight falls back to
    // client.goalWeight (170). Both are already kilograms.
    expect(generateNutritionPlan).toHaveBeenCalledWith(
      expect.objectContaining({ currentWeightKg: 175, goalWeightKg: 170 })
    )
  })
})

describe('Nutrition Route POST - goal resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getClientById).mockResolvedValue(mockClient as never)
    vi.mocked(generateNutritionPlan).mockReturnValue({
      baselineCalories: 2000,
      tdee: 2400,
      calorieTarget: 1800,
      proteinTargetG: 160,
      carbTargetG: 200,
      fatTargetG: 60,
      adjustedTdee: 2400,
      weeklyWeightChangeKg: -0.5,
      requiredDailyDeficit: 500,
      warnings: [],
    } as never)
  })

  it('uses the client goal weight', async () => {
    vi.mocked(getCurrentGoals).mockResolvedValue({
      id: 'goal-1',
      clientId: 'client-1',
      goalWeight: 165,
      setBy: 'coach',
      effectiveFrom: '2024-01-01T00:00:00Z',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    })

    const request = makeRequest(mockBody)
    const response = await POST(request, { params: Promise.resolve({ id: 'client-1' }) })
    const data = await response.json()

    // Client goal weight (165 kg) flows through unconverted.
    expect(generateNutritionPlan).toHaveBeenCalledWith(
      expect.objectContaining({ goalWeightKg: 165 })
    )
    expect(response.status).toBe(200)
  })
})

describe('Nutrition Route POST - effectiveFrom judged against client-local today', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getClientById).mockResolvedValue(mockClient as never)
    vi.mocked(generateNutritionPlan).mockReturnValue({
      baselineCalories: 2000,
      tdee: 2400,
      calorieTarget: 1800,
      proteinTargetG: 160,
      carbTargetG: 200,
      fatTargetG: 60,
      adjustedTdee: 2400,
      weeklyWeightChangeKg: -0.5,
      requiredDailyDeficit: 500,
      warnings: [],
    } as never)
    vi.mocked(getCurrentGoals).mockResolvedValue(null)
    // Far-future dates so these tests can ONLY pass/fail via the mocked
    // client-local comparison — a real-clock UTC comparison would never
    // reject 2099 dates, so a regression to getTodayDateString() fails both.
    vi.mocked(getClientTodayString).mockResolvedValue('2099-01-02')
  })

  it("accepts effectiveFrom equal to the client's local today", async () => {
    const request = makeRequest({ ...mockBody, effectiveFrom: '2099-01-02' })
    const response = await POST(request, { params: Promise.resolve({ id: 'client-1' }) })

    expect(response.status).toBe(200)
    expect(getClientTodayString).toHaveBeenCalledWith('client-1')
  })

  it('rejects effectiveFrom before the client-local today', async () => {
    const request = makeRequest({ ...mockBody, effectiveFrom: '2099-01-01' })
    const response = await POST(request, { params: Promise.resolve({ id: 'client-1' }) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Effective date cannot be in the past')
  })
})

describe('Nutrition Route DELETE', () => {
  function makeDeleteRequest(): NextRequest {
    return new NextRequest('http://localhost/api/clients/client-1/nutrition', {
      method: 'DELETE',
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue('coach-1')
    vi.mocked(getClientById).mockResolvedValue(mockClient as never)
    vi.mocked(getNutritionPlanForDate).mockResolvedValue({
      id: 'plan-1',
      effective_from: '2025-12-01',
      effective_until: null,
    } as never)
    vi.mocked(getClientTodayString).mockResolvedValue('2026-01-15')
  })

  it('clears the CLIENT\'s events from the day after the client-local today and succeeds', async () => {
    const response = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: 'client-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    // Client-scoped (migration 144): a chain's future events may be stamped by
    // queued versions' ids, which the old plan-scoped delete missed. The
    // close/queued-delete statement semantics are pinned in
    // nutrition-plan-orchestrator.test.ts.
    expect(deleteFutureNutritionEventsForClient).toHaveBeenCalledWith('client-1', '2026-01-16')
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null)

    const response = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: 'client-1' }),
    })

    expect(response.status).toBe(401)
    expect(deleteFutureNutritionEventsForClient).not.toHaveBeenCalled()
  })

  it("returns 403 when the coach does not own the client", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue('other-coach')

    const response = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: 'client-1' }),
    })

    expect(response.status).toBe(403)
    expect(deleteFutureNutritionEventsForClient).not.toHaveBeenCalled()
  })

  it('returns 404 when no version covers today and none is queued', async () => {
    vi.mocked(getNutritionPlanForDate).mockResolvedValue(null)

    const response = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: 'client-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No active nutrition plan to delete')
    expect(deleteFutureNutritionEventsForClient).not.toHaveBeenCalled()
  })
})

describe('Nutrition Route GET — the three-role read (migration 144)', () => {
  /** A full nutrition_plans row; override the fields a state cares about. */
  function planRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'v-current',
      client_id: 'client-1',
      coach_id: 'coach-1',
      status: 'active',
      effective_from: '2026-01-01',
      effective_until: null,
      baseline_calories: 2200,
      protein_target_g: 170,
      carb_target_g: 240,
      fat_target_g: 70,
      diet_type: 'balanced',
      work_activity_level: 'moderately_active',
      protein_target_g_per_kg: 2.0,
      custom_macros_enabled: false,
      custom_calories: null,
      custom_protein_g: null,
      custom_carb_g: null,
      custom_fat_g: null,
      base_weight_kg: 84,
      bmr: 1850,
      tdee: 2700,
      goal_weight_kg: 170,
      goal_deadline: null,
      regeneration_reason: 'initial',
      name: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      ...overrides,
    } as never
  }

  function makeGetRequest(): NextRequest {
    return new NextRequest('http://localhost/api/clients/client-1/nutrition', {
      method: 'GET',
    })
  }

  const getParams = { params: Promise.resolve({ id: 'client-1' }) }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue('coach-1')
    vi.mocked(getClientById).mockResolvedValue(mockClient as never)
    vi.mocked(getClientTodayString).mockResolvedValue('2026-08-11')
    vi.mocked(getCurrentGoals).mockResolvedValue(null)
    vi.mocked(getNutritionPlanForDate).mockResolvedValue(null)
    vi.mocked(getOpenNutritionPlan).mockResolvedValue(null)
    vi.mocked(getNextFutureNutritionPlan).mockResolvedValue(null)
  })

  it('single active version: covering IS the seed — active since its start, nothing queued', async () => {
    const row = planRow()
    vi.mocked(getNutritionPlanForDate).mockResolvedValue(row)
    vi.mocked(getOpenNutritionPlan).mockResolvedValue(row)

    const response = await GET(makeGetRequest(), getParams)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.hasPlan).toBe(true)
    expect(data.hasCurrentTargets).toBe(true)
    expect(data.effectiveFrom).toBe('2026-01-01')
    expect(data.scheduledFor).toBeNull()
    expect(data.calorieTarget).toBe(2200)
    // Per-date resolution against the CLIENT's today.
    expect(getNutritionPlanForDate).toHaveBeenCalledWith('client-1', '2026-08-11')
    expect(getNextFutureNutritionPlan).toHaveBeenCalledWith('client-1', '2026-08-11')
  })

  it('a chain: the hero dates the EARLIEST queued change, the drawer seeds the LATEST (open) version', async () => {
    vi.mocked(getNutritionPlanForDate).mockResolvedValue(
      planRow({ id: 'v-current', effective_until: '2026-08-31', baseline_calories: 2200 })
    )
    // The open row is the latest-saved queued prescription…
    vi.mocked(getOpenNutritionPlan).mockResolvedValue(
      planRow({ id: 'v-latest', effective_from: '2026-09-15', baseline_calories: 1800 })
    )
    // …while the NEXT change the client will feel is the earliest future one.
    vi.mocked(getNextFutureNutritionPlan).mockResolvedValue({
      id: 'v-mid',
      effectiveFrom: '2026-09-01',
    })

    const response = await GET(makeGetRequest(), getParams)
    const data = await response.json()

    expect(data.hasPlan).toBe(true)
    expect(data.hasCurrentTargets).toBe(true)
    expect(data.effectiveFrom).toBe('2026-01-01') // covering version's start
    expect(data.scheduledFor).toBe('2026-09-01') // EARLIEST queued, not the open row's
    expect(data.calorieTarget).toBe(1800) // seeds from the OPEN (latest) version
  })

  it('queued-only chain: a plan exists, nothing runs yet — "Starts", seeds from the open version', async () => {
    vi.mocked(getOpenNutritionPlan).mockResolvedValue(
      planRow({ id: 'v-queued', effective_from: '2026-09-01', baseline_calories: 2000 })
    )
    vi.mocked(getNextFutureNutritionPlan).mockResolvedValue({
      id: 'v-queued',
      effectiveFrom: '2026-09-01',
    })

    const response = await GET(makeGetRequest(), getParams)
    const data = await response.json()

    expect(data.hasPlan).toBe(true)
    expect(data.hasCurrentTargets).toBe(false)
    expect(data.effectiveFrom).toBeNull()
    expect(data.scheduledFor).toBe('2026-09-01')
    expect(data.calorieTarget).toBe(2000)
  })

  it('post-delete same day: no open row — seeds fall back to the closed covering version, never defaults', async () => {
    vi.mocked(getNutritionPlanForDate).mockResolvedValue(
      planRow({ id: 'v-closed', effective_until: '2026-08-11', baseline_calories: 2400 })
    )

    const response = await GET(makeGetRequest(), getParams)
    const data = await response.json()

    // The D2 seed rule: the drawer never seeds fresh defaults while hasPlan is
    // true — an untouched Regenerate must re-mint these numbers.
    expect(data.hasPlan).toBe(true)
    expect(data.hasCurrentTargets).toBe(true)
    expect(data.scheduledFor).toBeNull()
    expect(data.calorieTarget).toBe(2400)
    expect(data.workActivityLevel).toBe('moderately_active')
  })

  it('no versions at all: explicit hasPlan false with calcInputs still served', async () => {
    const response = await GET(makeGetRequest(), getParams)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.hasPlan).toBe(false)
    expect(data).toHaveProperty('calcInputs')
    expect(data.calorieTarget).toBeUndefined()
  })
})
