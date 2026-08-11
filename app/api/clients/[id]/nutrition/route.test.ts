import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/services/client-service', () => ({
  getClientById: vi.fn(),
}))

vi.mock('@/services/nutrition-service', () => ({
  generateNutritionPlan: vi.fn(),
  calculateTDEE: vi.fn(),
}))

vi.mock('@/services/training-service', () => ({
  getActiveTrainingPlan: vi.fn().mockResolvedValue(null),
  // GET reads these two for `hasTrainingPlan` + the hero's title; POST/DELETE
  // never call them, but the factory must still declare the module's full
  // imported surface.
  getTrainingPlanSummaryForDate: vi.fn().mockResolvedValue(null),
  getNextFutureTrainingPlan: vi.fn().mockResolvedValue(null),
}))

// The orchestrator now PROPAGATES event-rewrite failures (previously
// swallowed), so the success-path tests must mock the rewrite as succeeding.
// getNutritionEventForDate serves the GET's `hasCurrentTargets`; this file has
// no GET tests (the whole GET chain is unmocked here), but the factory must
// declare the module's full imported surface — the behaviour is pinned at the
// consumer (nutrition-plan-hero.test.tsx).
vi.mock('@/services/nutrition-event-service', () => ({
  regenerateFutureNutritionEvents: vi.fn().mockResolvedValue(undefined),
  deleteFutureNutritionEventsForClient: vi.fn().mockResolvedValue(undefined),
  getNutritionEventForDate: vi.fn().mockResolvedValue(null),
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
}))

vi.mock('@/services/body-metrics-service', () => ({
  getLatestBodyMetrics: vi.fn(),
}))

vi.mock('@/services/client-goals-service', () => ({
  getCurrentGoals: vi.fn(),
}))

vi.mock('@/services/today-service', () => ({
  getClientTodayString: vi.fn().mockResolvedValue('2026-01-15'),
}))

import { getClientById } from '@/services/client-service'
import { generateNutritionPlan, calculateTDEE } from '@/services/nutrition-service'
import {
  createNutritionPlan,
  getNutritionPlanForDate,
} from '@/services/nutrition-plan-service'
import { deleteFutureNutritionEventsForClient } from '@/services/nutrition-event-service'
import { getLatestBodyMetrics } from '@/services/body-metrics-service'
import { getCurrentGoals } from '@/services/client-goals-service'
import { getClientTodayString } from '@/services/today-service'
import { getAuthenticatedCoachId } from '@/lib/auth-helpers'
import { POST, DELETE } from './route'

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

describe('Nutrition Route POST - read-switch behavior', () => {
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
    vi.mocked(calculateTDEE).mockReturnValue(2400)
  })

  it('uses body_metrics values when available', async () => {
    vi.mocked(getLatestBodyMetrics).mockResolvedValue({
      id: 'bm-1',
      clientId: 'client-1',
      weight: 175,
      bmr: 1750,
      tdee: 2200,
      source: 'check_in',
      recordedAt: '2024-01-15T00:00:00Z',
      createdAt: '2024-01-15T00:00:00Z',
    })
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

    // Should use body_metrics weight (175) not client weight (180). Stored
    // values are kilograms (migration 141), so it must arrive UNCONVERTED —
    // asserting the number itself catches a reintroduced conversion, which
    // asserting "a converter was called" could not.
    expect(generateNutritionPlan).toHaveBeenCalledWith(
      expect.objectContaining({ currentWeightKg: 175 })
    )
    // Should use body_metrics bmr (1750) not client bmr (1700)
    expect(generateNutritionPlan).toHaveBeenCalledWith(
      expect.objectContaining({ bmr: 1750 })
    )
    // Should use goals weight (165) not client goalWeight (170)
    const createCall = vi.mocked(createNutritionPlan).mock.calls[0][0]
    expect(createCall.bmr).toBe(1750)
  })

  it('falls back to client fields when body_metrics returns null', async () => {
    vi.mocked(getLatestBodyMetrics).mockResolvedValue(null)
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

    // Should fall back to client.currentWeight (180), unconverted.
    expect(generateNutritionPlan).toHaveBeenCalledWith(
      expect.objectContaining({ currentWeightKg: 180 })
    )
    // Should fall back to client.bmr (1700)
    expect(generateNutritionPlan).toHaveBeenCalledWith(
      expect.objectContaining({ bmr: 1700 })
    )
  })

  it('falls back to client fields when getCurrentGoals returns null', async () => {
    vi.mocked(getLatestBodyMetrics).mockResolvedValue({
      id: 'bm-1',
      clientId: 'client-1',
      weight: 175,
      bmr: 1750,
      tdee: 2200,
      source: 'check_in',
      recordedAt: '2024-01-15T00:00:00Z',
      createdAt: '2024-01-15T00:00:00Z',
    })
    vi.mocked(getCurrentGoals).mockResolvedValue(null)

    const request = makeRequest(mockBody)
    await POST(request, { params: Promise.resolve({ id: 'client-1' }) })

    // Should use body_metrics weight (175); goalWeight falls back to
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
    vi.mocked(calculateTDEE).mockReturnValue(2400)
  })

  it('uses the client goal weight', async () => {
    vi.mocked(getLatestBodyMetrics).mockResolvedValue({
      id: 'bm-1',
      clientId: 'client-1',
      weight: 175,
      bmr: 1750,
      tdee: 2200,
      source: 'check_in',
      recordedAt: '2024-01-15T00:00:00Z',
      createdAt: '2024-01-15T00:00:00Z',
    })
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
    vi.mocked(calculateTDEE).mockReturnValue(2400)
    vi.mocked(getLatestBodyMetrics).mockResolvedValue(null)
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
