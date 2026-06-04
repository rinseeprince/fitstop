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
}))

vi.mock('@/services/body-metrics-service', () => ({
  getLatestBodyMetrics: vi.fn(),
}))

vi.mock('@/services/client-goals-service', () => ({
  getCurrentGoals: vi.fn(),
}))

vi.mock('@/lib/require-phase-selection', () => ({
  requirePhaseSelection: vi.fn(),
}))

import { getClientById } from '@/services/client-service'
import { generateNutritionPlan, calculateTDEE } from '@/services/nutrition-service'
import { createNutritionPlan } from '@/services/nutrition-plan-service'
import { getLatestBodyMetrics } from '@/services/body-metrics-service'
import { getCurrentGoals } from '@/services/client-goals-service'
import { weightToKg } from '@/utils/nutrition-helpers'
import { requirePhaseSelection } from '@/lib/require-phase-selection'
import { POST } from './route'

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
    vi.mocked(requirePhaseSelection).mockResolvedValue({
      ok: true as const,
      phaseId: undefined,
      phaseGoalWeight: undefined,
      phaseGoalBodyFatPercentage: undefined,
      phaseStartDate: undefined,
      phaseEndDate: undefined,
      phaseStatus: undefined,
    })
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

describe('Nutrition Route POST - phase goal resolution', () => {
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

  it('uses phase goal weight when phaseGoalWeight is set (goalSource: phase)', async () => {
    vi.mocked(requirePhaseSelection).mockResolvedValue({
      ok: true as const,
      phaseId: 'phase-1',
      phaseGoalWeight: 70,
      phaseGoalBodyFatPercentage: 12,
      phaseStartDate: '2024-01-15',
      phaseEndDate: '2024-06-01',
      phaseStatus: 'active' as const,
    })
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

    // Phase goal (70 kg) used directly, not client goal (165 lbs)
    expect(generateNutritionPlan).toHaveBeenCalledWith(
      expect.objectContaining({ goalWeightKg: 70 })
    )
    expect(createNutritionPlan).toHaveBeenCalledWith(
      expect.objectContaining({ goalWeightKg: 70, goalDeadline: '2024-06-01' })
    )
    expect(data.goalSource).toBe('phase')
  })

  it('uses phase maintenance when phaseGoalWeight is null (goalSource: phase, no client fallback)', async () => {
    // Session 7.8 phase-is-king: an active phase with a NULL weight is maintenance.
    // It does NOT fall back to the client goal, and the deadline is the phase's.
    vi.mocked(requirePhaseSelection).mockResolvedValue({
      ok: true as const,
      phaseId: 'phase-1',
      phaseGoalWeight: null,
      phaseGoalBodyFatPercentage: null,
      phaseStartDate: '2024-01-15',
      phaseEndDate: '2024-06-01',
      phaseStatus: 'active' as const,
    })
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

    // Body deadline is supplied but MUST be ignored — the phase scope owns it.
    const request = makeRequest({ ...mockBody, goalDeadline: '2024-12-01' })
    const response = await POST(request, { params: Promise.resolve({ id: 'client-1' }) })
    const data = await response.json()

    // Client goal weight (165) is NOT converted — no fallback while a phase is active.
    expect(weightToKg).not.toHaveBeenCalledWith(165, 'lbs')
    // Maintenance (null weight) + the PHASE deadline, not the request body deadline.
    expect(createNutritionPlan).toHaveBeenCalledWith(
      expect.objectContaining({ goalWeightKg: null, goalDeadline: '2024-06-01' })
    )
    expect(data.goalSource).toBe('phase')
  })

  it('falls back to client goal when no roadmap (phaseGoalWeight undefined)', async () => {
    vi.mocked(requirePhaseSelection).mockResolvedValue({
      ok: true as const,
      phaseId: undefined,
      phaseGoalWeight: undefined,
      phaseGoalBodyFatPercentage: undefined,
      phaseStartDate: undefined,
      phaseEndDate: undefined,
      phaseStatus: undefined,
    })
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
    expect(data.goalSource).toBe('client')
  })
})

describe('Nutrition Route POST - active phase guard', () => {
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

  it('returns 400 when phase is planned (not active)', async () => {
    vi.mocked(requirePhaseSelection).mockResolvedValue({
      ok: true as const,
      phaseId: 'phase-1',
      phaseGoalWeight: 70,
      phaseGoalBodyFatPercentage: null,
      phaseStartDate: '2024-01-15',
      phaseEndDate: '2024-06-01',
      phaseStatus: 'planned' as const,
    })

    const request = makeRequest(mockBody)
    const response = await POST(request, { params: Promise.resolve({ id: 'client-1' }) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Nutrition plans can only be created for the active phase')
  })

  it('succeeds when phase is active', async () => {
    vi.mocked(requirePhaseSelection).mockResolvedValue({
      ok: true as const,
      phaseId: 'phase-1',
      phaseGoalWeight: 70,
      phaseGoalBodyFatPercentage: null,
      phaseStartDate: '2024-01-15',
      phaseEndDate: '2024-06-01',
      phaseStatus: 'active' as const,
    })
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

    expect(response.status).toBe(200)
  })

  it('succeeds when no roadmap (phaseId undefined, phaseStatus undefined)', async () => {
    vi.mocked(requirePhaseSelection).mockResolvedValue({
      ok: true as const,
      phaseId: undefined,
      phaseGoalWeight: undefined,
      phaseGoalBodyFatPercentage: undefined,
      phaseStartDate: undefined,
      phaseEndDate: undefined,
      phaseStatus: undefined,
    })
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

    expect(response.status).toBe(200)
  })
})
