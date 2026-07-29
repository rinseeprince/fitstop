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
}))

// The orchestrator now PROPAGATES event-rewrite failures (previously
// swallowed), so the success-path tests must mock the rewrite as succeeding.
vi.mock('@/services/nutrition-event-service', () => ({
  regenerateFutureNutritionEvents: vi.fn().mockResolvedValue(undefined),
  deleteFutureNutritionEventsForPlan: vi.fn().mockResolvedValue(undefined),
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

vi.mock('@/utils/nutrition-helpers', () => ({
  weightToKg: vi.fn((w: number) => w * 0.453592),
}))

vi.mock('@/utils/build-daily-targets', () => ({
  buildDailyTargetsFromPlan: vi.fn(),
}))

vi.mock('@/services/nutrition-plan-service', () => ({
  createNutritionPlan: vi.fn().mockResolvedValue({}),
  archiveNutritionPlan: vi.fn().mockResolvedValue(undefined),
  getActiveNutritionPlanId: vi.fn().mockResolvedValue('plan-1'),
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
  archiveNutritionPlan,
  getActiveNutritionPlanId,
} from '@/services/nutrition-plan-service'
import { deleteFutureNutritionEventsForPlan } from '@/services/nutrition-event-service'
import { getLatestBodyMetrics } from '@/services/body-metrics-service'
import { getCurrentGoals } from '@/services/client-goals-service'
import { weightToKg } from '@/utils/nutrition-helpers'
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
      weightUnit: 'lbs',
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

    // Should use body_metrics weight (175) not client weight (180)
    expect(weightToKg).toHaveBeenCalledWith(175, 'lbs')
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

    // Should fall back to client.currentWeight (180)
    expect(weightToKg).toHaveBeenCalledWith(180, 'lbs')
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
      weightUnit: 'lbs',
      bmr: 1750,
      tdee: 2200,
      source: 'check_in',
      recordedAt: '2024-01-15T00:00:00Z',
      createdAt: '2024-01-15T00:00:00Z',
    })
    vi.mocked(getCurrentGoals).mockResolvedValue(null)

    const request = makeRequest(mockBody)
    await POST(request, { params: Promise.resolve({ id: 'client-1' }) })

    // Should use body_metrics weight (175)
    expect(weightToKg).toHaveBeenCalledWith(175, 'lbs')
    // goalWeight falls back to client.goalWeight (170) -> converted to kg
    const goalWeightKgCall = vi.mocked(weightToKg).mock.calls.find(
      (call) => call[0] === 170
    )
    expect(goalWeightKgCall).toBeTruthy()
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
      weightUnit: 'lbs',
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

    // Client goal weight (165 lbs) converted via weightToKg
    expect(weightToKg).toHaveBeenCalledWith(165, 'lbs')
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
    vi.mocked(getActiveNutritionPlanId).mockResolvedValue('plan-1')
    vi.mocked(getClientTodayString).mockResolvedValue('2026-01-15')
  })

  it('archives the plan and clears its events from the day after the client-local today', async () => {
    const response = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: 'client-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(deleteFutureNutritionEventsForPlan).toHaveBeenCalledWith('plan-1', '2026-01-16')
    expect(archiveNutritionPlan).toHaveBeenCalledWith('plan-1')
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null)

    const response = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: 'client-1' }),
    })

    expect(response.status).toBe(401)
    expect(archiveNutritionPlan).not.toHaveBeenCalled()
  })

  it("returns 403 when the coach does not own the client", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue('other-coach')

    const response = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: 'client-1' }),
    })

    expect(response.status).toBe(403)
    expect(deleteFutureNutritionEventsForPlan).not.toHaveBeenCalled()
    expect(archiveNutritionPlan).not.toHaveBeenCalled()
  })

  it('returns 404 when there is no active plan', async () => {
    vi.mocked(getActiveNutritionPlanId).mockResolvedValue(null)

    const response = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: 'client-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No active nutrition plan to delete')
    expect(archiveNutritionPlan).not.toHaveBeenCalled()
  })
})
