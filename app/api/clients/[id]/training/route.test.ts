import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/services/client-service', () => ({
  getClientById: vi.fn(),
}))

vi.mock('@/services/check-in-service', () => ({
  getClientCheckIns: vi.fn().mockResolvedValue({ checkIns: [] }),
}))

vi.mock('@/services/training-ai-service', () => ({
  generateTrainingPlanAI: vi.fn(),
  calculateCheckInAverages: vi.fn().mockReturnValue({}),
}))

vi.mock('@/services/coach-saved-plan-service', () => ({
  createSavedPlanFromAI: vi.fn().mockResolvedValue('saved-plan-1'),
}))

vi.mock('@/services/training-service', () => ({
  getActiveTrainingPlan: vi.fn().mockResolvedValue(null),
  promoteTrainingPlanIfReady: vi.fn().mockResolvedValue(undefined),
  getTrainingPlanById: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/auth-helpers', () => ({
  getAuthenticatedCoachId: vi.fn().mockResolvedValue('coach-1'),
}))

vi.mock('@/lib/rate-limit', () => ({
  aiRateLimit: vi.fn().mockResolvedValue(null),
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/csrf-protection', () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/validations/training', () => ({
  generateTrainingPlanSchema: {
    safeParse: vi.fn().mockReturnValue({
      success: true,
      data: { coachPrompt: 'Build a plan', preGenerationActivities: [] },
    }),
  },
}))

vi.mock('@/utils/nutrition-helpers', () => ({
  weightToKg: vi.fn((w: number) => w * 0.453592),
}))

vi.mock('@/services/body-metrics-service', () => ({
  getLatestBodyMetrics: vi.fn(),
}))

vi.mock('@/services/client-goals-service', () => ({
  getCurrentGoals: vi.fn(),
}))

vi.mock('@/lib/require-phase-selection', () => ({
  requirePhaseSelection: vi.fn().mockResolvedValue({ ok: true }),
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
import { generateTrainingPlanAI } from '@/services/training-ai-service'
import { createSavedPlanFromAI } from '@/services/coach-saved-plan-service'
import { getLatestBodyMetrics } from '@/services/body-metrics-service'
import { getCurrentGoals } from '@/services/client-goals-service'
import { POST } from './route'

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

const mockAiResult = {
  plan: { sessions: [], name: 'Test Plan' },
  rawResponse: 'raw',
}

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/clients/client-1/training', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('Training Route POST - read-switch behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getClientById).mockResolvedValue(mockClient as never)
    vi.mocked(generateTrainingPlanAI).mockResolvedValue(mockAiResult as never)
    vi.mocked(createSavedPlanFromAI).mockResolvedValue('saved-plan-1')
  })

  it('uses body_metrics and goals values when available', async () => {
    vi.mocked(getLatestBodyMetrics).mockResolvedValue({
      id: 'bm-1',
      clientId: 'client-1',
      weight: 175,
      weightUnit: 'lbs',
      bodyFatPercentage: 18,
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
      goalBodyFatPercentage: 12,
      setBy: 'coach',
      effectiveFrom: '2024-01-01T00:00:00Z',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    })

    const request = makeRequest({ coachPrompt: 'Build a plan' })
    const response = await POST(request, { params: Promise.resolve({ id: 'client-1' }) })
    const data = await response.json()

    // AI call should use body_metrics and goals values
    expect(generateTrainingPlanAI).toHaveBeenCalledWith(
      expect.objectContaining({
        client: expect.objectContaining({
          bodyFatPercentage: 18,
          goalBodyFatPercentage: 12,
          tdee: 2200,
          bmr: 1750,
        }),
      })
    )

    // Should create a saved plan (library draft) instead of client-side plan.
    // The 4th arg is the optional coach-supplied plan name — undefined when the
    // POST body doesn't include `name`.
    expect(createSavedPlanFromAI).toHaveBeenCalledWith(
      'coach-1',
      mockAiResult.plan,
      'Build a plan',
      undefined
    )

    // Response returns savedPlanId instead of plan object
    expect(data.success).toBe(true)
    expect(data.savedPlanId).toBe('saved-plan-1')
  })

  it('falls back to client fields when services return null', async () => {
    vi.mocked(getLatestBodyMetrics).mockResolvedValue(null)
    vi.mocked(getCurrentGoals).mockResolvedValue(null)

    const request = makeRequest({ coachPrompt: 'Build a plan' })
    await POST(request, { params: Promise.resolve({ id: 'client-1' }) })

    // AI call should fall back to client.* fields
    expect(generateTrainingPlanAI).toHaveBeenCalledWith(
      expect.objectContaining({
        client: expect.objectContaining({
          bodyFatPercentage: 20,
          goalBodyFatPercentage: 15,
          tdee: 2100,
          bmr: 1700,
        }),
      })
    )
  })
})
