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

// The DELETE hands the whole act to the clear service (migration 166); its
// statement semantics are pinned in nutrition-plan-clear-service.test.ts.
vi.mock('@/services/nutrition-plan-clear-service', () => ({
  clearNutritionPlansForClient: vi.fn(),
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
    effective_until: '2026-03-31',
  }),
  getLatestNutritionPlan: vi.fn().mockResolvedValue(null),
  getNextFutureNutritionPlan: vi.fn().mockResolvedValue(null),
  resolveNutritionPlacementEnd: vi.fn().mockResolvedValue('2026-03-11'),
}))

// The goal in force on the client's today: the calculator's goal and the drift
// check's, read once per request.
vi.mock('@/services/client-goals-service', () => ({
  getGoalForDate: vi.fn(),
}))

// The POST imports the class alone, to say why a save was refused; the real
// module loads supabase-admin and the trim service. The sentence comes from the
// constant, never a copy of it.
vi.mock('@/services/client-blocks-service', async () => {
  const { BLOCKS_UNREADABLE } = await import('@/lib/constants')
  return {
    BlocksUnreadableError: class BlocksUnreadableError extends Error {
      constructor() {
        super(BLOCKS_UNREADABLE)
      }
    },
  }
})

vi.mock('@/services/today-service', () => ({
  getClientTodayString: vi.fn().mockResolvedValue('2026-01-15'),
}))

// The deletion floor is TRAINING's (owner, 2026-09-11): nutrition asks no
// floor. Mocked to answer TOMORROW so a belt that consulted it again would
// refuse a save from today and fail the test below.
vi.mock('@/services/event-deletion-floor', () => ({
  resolveEventDeletionFloor: vi.fn().mockResolvedValue('2099-01-03'),
}))

import { getClientById } from '@/services/client-service'
import { generateNutritionPlan } from '@/services/nutrition-service'
import {
  createNutritionPlan,
  getNutritionPlanForDate,
  getLatestNutritionPlan,
  getNextFutureNutritionPlan,
  resolveNutritionPlacementEnd,
} from '@/services/nutrition-plan-service'
import { BlocksUnreadableError } from '@/services/client-blocks-service'
import { BLOCKS_UNREADABLE } from '@/lib/constants'
import { clearNutritionPlansForClient } from '@/services/nutrition-plan-clear-service'
import { getGoalForDate } from '@/services/client-goals-service'
import { getClientTodayString } from '@/services/today-service'
import { resolveEventDeletionFloor } from '@/services/event-deletion-floor'
import { getAuthenticatedCoachId } from '@/lib/auth-helpers'
import { GET, POST, DELETE } from './route'
import type { GoalOnDay } from '@/types/client-goals'

const mockClient = {
  id: 'client-1',
  coachId: 'coach-1',
  name: 'Test Client',
  currentWeight: 180,
  weightUnit: 'lbs' as const,
  bmr: 1700,
  tdee: 2100,
  gender: 'male' as const,
  height: 70,
  heightUnit: 'in' as const,
}

/** The goal in force on a day, as the goals service returns it. */
const goalOnDay = (overrides: Partial<GoalOnDay> = {}): GoalOnDay => ({
  id: 'goal-1',
  clientId: 'client-1',
  name: 'Lose weight',
  type: 'lose_weight',
  targetWeight: null,
  targetBodyFatPercentage: null,
  description: null,
  startsOn: '2025-12-29',
  source: 'coach',
  setBy: 'coach-1',
  createdAt: '2025-12-29T09:00:00Z',
  updatedAt: '2025-12-29T09:00:00Z',
  deadline: null,
  ...overrides,
})

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
    vi.mocked(getGoalForDate).mockResolvedValue(goalOnDay({ targetWeight: 165 }))

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

  it('prices maintenance when no goal is in force on the client\'s today — the profile holds no goal', async () => {
    vi.mocked(getClientById).mockResolvedValue({ ...mockClient, currentWeight: 175 } as never)
    vi.mocked(getGoalForDate).mockResolvedValue(null)

    const request = makeRequest(mockBody)
    await POST(request, { params: Promise.resolve({ id: 'client-1' }) })

    // The weight is still the record's (175); with no goal there is no goal
    // weight and no deadline for the calculator to solve against.
    expect(generateNutritionPlan).toHaveBeenCalledWith(
      expect.objectContaining({ currentWeightKg: 175, goalWeightKg: undefined, goalDeadline: undefined })
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

  it("uses the weight target and deadline of the goal in force on the client's today", async () => {
    vi.mocked(getGoalForDate).mockResolvedValue(
      goalOnDay({ targetWeight: 163.5, deadline: '2026-04-30' })
    )

    const request = makeRequest(mockBody)
    const response = await POST(request, { params: Promise.resolve({ id: 'client-1' }) })

    expect(getGoalForDate).toHaveBeenCalledWith('client-1', '2026-01-15')
    // The goal's kilograms flow through unconverted, with that day's deadline.
    expect(generateNutritionPlan).toHaveBeenCalledWith(
      expect.objectContaining({ goalWeightKg: 163.5, goalDeadline: '2026-04-30' })
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
    vi.mocked(getGoalForDate).mockResolvedValue(null)
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

  // Nutrition asks no floor (owner, 2026-09-11): today's targets are the
  // coach's to replace whatever the client has logged. The floor here answers
  // tomorrow — a workout logged today — and a save from today still lands.
  it('accepts a start on today whatever the client has logged — the deletion floor is not consulted', async () => {
    const request = makeRequest({ ...mockBody, effectiveFrom: '2099-01-02' })
    const response = await POST(request, { params: Promise.resolve({ id: 'client-1' }) })

    expect(response.status).toBe(200)
    expect(resolveEventDeletionFloor).not.toHaveBeenCalled()
    expect(createNutritionPlan).toHaveBeenCalledWith(
      expect.objectContaining({ effectiveFrom: '2099-01-02' })
    )
  })

  it('the default start (no effectiveFrom = today) lands the same way', async () => {
    const request = makeRequest(mockBody)
    const response = await POST(request, { params: Promise.resolve({ id: 'client-1' }) })

    expect(response.status).toBe(200)
    expect(resolveEventDeletionFloor).not.toHaveBeenCalled()
    expect(createNutritionPlan).toHaveBeenCalledTimes(1)
  })

  // A block bounds the version placed inside it, so a save that cannot read the
  // client's blocks does not know where its targets end. It is refused with the
  // sentence rather than stored without the bound.
  it("refuses the save with its own sentence when the client's blocks can't be read", async () => {
    vi.mocked(resolveNutritionPlacementEnd).mockRejectedValue(new BlocksUnreadableError())

    const request = makeRequest(mockBody)
    const response = await POST(request, { params: Promise.resolve({ id: 'client-1' }) })
    const data = await response.json()

    expect(response.status).toBe(503)
    expect(data.error).toBe(BLOCKS_UNREADABLE)
    expect(createNutritionPlan).not.toHaveBeenCalled()
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
    vi.mocked(getClientTodayString).mockResolvedValue('2026-01-15')
    vi.mocked(clearNutritionPlansForClient).mockResolvedValue({
      versionsCleared: 1, editsCleared: 0,
      versionIds: ['plan-1'],
    })
  })

  it("retires the versions the client is on, with the client's today, and succeeds", async () => {
    const response = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: 'client-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    // One act, unscoped (no block window): the calendar's own delete. The
    // floor, the day removal and the archive are the clear service's.
    expect(clearNutritionPlansForClient).toHaveBeenCalledWith('client-1', '2026-01-15')
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null)

    const response = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: 'client-1' }),
    })

    expect(response.status).toBe(401)
    expect(clearNutritionPlansForClient).not.toHaveBeenCalled()
  })

  it("returns 403 when the coach does not own the client", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue('other-coach')

    const response = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: 'client-1' }),
    })

    expect(response.status).toBe(403)
    expect(clearNutritionPlansForClient).not.toHaveBeenCalled()
  })

  it('returns 404 when no version has days left to retire', async () => {
    vi.mocked(clearNutritionPlansForClient).mockResolvedValue({ versionsCleared: 0, editsCleared: 0, versionIds: [] })

    const response = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: 'client-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No active nutrition plan to delete')
  })
})

describe('Nutrition Route GET — the three-role read (versions placed by date)', () => {
  /** A full nutrition_plans row; override the fields a state cares about. */
  function planRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'v-current',
      client_id: 'client-1',
      coach_id: 'coach-1',
      status: 'active',
      effective_from: '2026-01-01',
      effective_until: '2026-12-31',
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
    vi.mocked(getGoalForDate).mockResolvedValue(null)
    vi.mocked(getNutritionPlanForDate).mockResolvedValue(null)
    vi.mocked(getLatestNutritionPlan).mockResolvedValue(null)
    vi.mocked(getNextFutureNutritionPlan).mockResolvedValue(null)
  })

  it('single active version: covering IS the seed — active since its start, nothing queued', async () => {
    const row = planRow()
    vi.mocked(getNutritionPlanForDate).mockResolvedValue(row)
    vi.mocked(getLatestNutritionPlan).mockResolvedValue(row)

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

  it('a chain: the hero dates the EARLIEST queued change, the drawer seeds the LATEST version', async () => {
    vi.mocked(getNutritionPlanForDate).mockResolvedValue(
      planRow({ id: 'v-current', effective_until: '2026-08-31', baseline_calories: 2200 })
    )
    // The latest-starting version is the last-saved queued prescription…
    vi.mocked(getLatestNutritionPlan).mockResolvedValue(
      planRow({ id: 'v-latest', effective_from: '2026-09-15', effective_until: '2026-11-09', baseline_calories: 1800 })
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
    expect(data.calorieTarget).toBe(1800) // seeds from the LATEST version
  })

  it('queued-only: a plan exists, nothing runs yet — "Starts", seeds from the latest version', async () => {
    vi.mocked(getLatestNutritionPlan).mockResolvedValue(
      planRow({ id: 'v-queued', effective_from: '2026-09-01', effective_until: '2026-10-26', baseline_calories: 2000 })
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

  it('a version ending today still covers it: the drawer seeds from it, never defaults', async () => {
    const row = planRow({ id: 'v-ending', effective_until: '2026-08-11', baseline_calories: 2400 })
    vi.mocked(getNutritionPlanForDate).mockResolvedValue(row)
    vi.mocked(getLatestNutritionPlan).mockResolvedValue(row)

    const response = await GET(makeGetRequest(), getParams)
    const data = await response.json()

    // The seed rule: the drawer never seeds fresh defaults while hasPlan is
    // true — an untouched Regenerate must re-mint these numbers.
    expect(data.hasPlan).toBe(true)
    expect(data.hasCurrentTargets).toBe(true)
    expect(data.scheduledFor).toBeNull()
    expect(data.calorieTarget).toBe(2400)
    expect(data.workActivityLevel).toBe('moderately_active')
  })

  it('every version has ENDED: no plan — a gap is a real state (migration 166)', async () => {
    // The latest version is history; nothing covers today and nothing is
    // queued, so the tab reads as no plan and the drawer starts fresh.
    vi.mocked(getLatestNutritionPlan).mockResolvedValue(
      planRow({ id: 'v-ended', effective_until: '2026-08-10', baseline_calories: 2400 })
    )

    const response = await GET(makeGetRequest(), getParams)
    const data = await response.json()

    expect(data.hasPlan).toBe(false)
    expect(data.calorieTarget).toBeUndefined()
    expect(data).toHaveProperty('calcInputs')
  })

  it('no versions at all: explicit hasPlan false with calcInputs still served', async () => {
    const response = await GET(makeGetRequest(), getParams)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.hasPlan).toBe(false)
    expect(data).toHaveProperty('calcInputs')
    expect(data.calorieTarget).toBeUndefined()
  })

  // The drift banner compares the version the drawer will overwrite with the
  // goal in force on the client's today — its weight target and that day's
  // deadline, from one goal — and the preview prices that same goal.
  it("judges goal drift against the goal in force on the client's today, read once", async () => {
    const row = planRow({ goal_weight_kg: 81.5, goal_deadline: '2026-10-30' })
    vi.mocked(getNutritionPlanForDate).mockResolvedValue(row)
    vi.mocked(getLatestNutritionPlan).mockResolvedValue(row)
    vi.mocked(getGoalForDate).mockResolvedValue(
      goalOnDay({ targetWeight: 81.5, deadline: '2026-10-30' })
    )

    const same = await (await GET(makeGetRequest(), getParams)).json()

    expect(getGoalForDate).toHaveBeenCalledTimes(1)
    expect(getGoalForDate).toHaveBeenCalledWith('client-1', '2026-08-11')
    expect(same.goalChanged.changed).toBe(false)
    expect(same.calcInputs).toMatchObject({ goalWeightKg: 81.5, goalDeadline: '2026-10-30' })

    vi.mocked(getGoalForDate).mockResolvedValue(
      goalOnDay({ targetWeight: 79.5, deadline: '2026-10-30' })
    )
    const moved = await (await GET(makeGetRequest(), getParams)).json()

    expect(moved.goalChanged).toMatchObject({
      changed: true,
      planGoalWeightKg: 81.5,
      currentGoalWeightKg: 79.5,
    })
  })
})
