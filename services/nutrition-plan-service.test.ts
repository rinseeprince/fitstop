import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

vi.mock('@/utils/nutrition-helpers', () => ({
  calculateDailyMacros: vi.fn().mockReturnValue({ proteinG: 180, carbsG: 220, fatG: 70 }),
  DAYS_OF_WEEK: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
}))

vi.mock('./today-service', () => ({
  getClientTodayString: vi.fn().mockResolvedValue('2024-01-17'),
}))

import { supabaseAdmin } from './supabase-admin'
import { getClientTodayString } from './today-service'
import {
  createNutritionPlan,
  getNutritionPlanForDate,
  getNutritionPlanIdForDate,
  getNextFutureNutritionPlan,
} from './nutrition-plan-service'

/**
 * Chain stub for the date resolvers: every filter/order method self-returns,
 * maybeSingle resolves the given result. Mock-level only — the three-branch
 * RPC semantics are proven by the live behavioral probe, not here; these pin
 * the QUERY SHAPE (the coversDate window predicate, the status filter, the
 * ordering) so a refactor cannot silently drop a clause.
 */
function createResolverQuery(result: { data: unknown; error: { message: string } | null }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
}

describe('Nutrition Plan Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getClientTodayString).mockResolvedValue('2024-01-17')
  })

  describe('createNutritionPlan', () => {
    const baseParams = {
      clientId: 'client-123',
      coachId: 'coach-456',
      clientToday: '2024-01-17',
      workActivityLevel: 'moderate',
      trainingVolumeHours: '5-7',
      proteinTargetGPerKg: 2.0,
      dietType: 'balanced' as const,
      goalWeightKg: 75,
      goalDeadline: '2025-06-01',
      baselineCalories: 2000,
      proteinTargetG: 180,
      carbTargetG: 220,
      fatTargetG: 70,
      baseWeightKg: 80,
      bmr: 1800,
      tdee: 2400,
      customMacrosEnabled: false,
      customCalories: null,
      customProteinG: null,
      customCarbG: null,
      customFatG: null,
      regenerationReason: 'initial',
      trainingPlan: null,
    }

    it('is the RPC and nothing else — a plan save writes no table of its own', async () => {
      // The plan row snapshots bmr/tdee through the RPC args; that snapshot IS
      // the provenance. The TDEE dual-write that used to follow the RPC went
      // with its store, so a second write here is a regression, not a belt.
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 'plan-123', error: null } as any)

      const id = await createNutritionPlan(baseParams)

      expect(id).toBe('plan-123')
      expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(1)
      expect(supabaseAdmin.from).not.toHaveBeenCalled()
    })

    it('threads the caller-supplied clientToday to the RPC as p_today — never recomputes it', async () => {
      // Single-source invariant (migration 144): the RPC's belt raises when
      // effectiveFrom < p_today, so p_today must be the SAME string the
      // route's past-date guard judged. A second getClientTodayString call
      // here could straddle client midnight and fail a save the route
      // accepted. This pins both halves: the threaded value reaches the RPC,
      // and this service performs no today lookup of its own.
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 'plan-123', error: null } as any)

      await createNutritionPlan({
        ...baseParams,
        clientToday: '2026-06-10',
        effectiveFrom: '2026-06-10',
      })

      expect(getClientTodayString).not.toHaveBeenCalled()
      expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
        'create_nutrition_plan_atomic',
        expect.objectContaining({
          p_effective_from: '2026-06-10',
          p_today: '2026-06-10',
        })
      )
    })

    // Two belts, deliberately comparing against different things.
    // COMPILE time: `satisfies CreateNutritionPlanRpcPayload` in
    // nutrition-plan-service.ts checks the payload against types/database.ts,
    // so a key the payload adds, drops or renames no longer builds. That
    // replaced the `as never` casts, which checked nothing at all (Session 5).
    // RUNTIME, here: this list is an independent, hand-transcribed record of
    // migration 144's 24 arguments. The compile check trusts types/database.ts
    // to be a faithful mirror of the live function; this one does not, so it
    // still fires when the SIGNATURE is what moved — regenerating the mirror
    // against a changed database drags the payload along with it, and an arity
    // change then has to be re-pinned here deliberately instead of riding in
    // unnoticed. It stays at 24 (identical to 139's — the close-and-insert
    // rewrite kept the arity, and Session 5 removed the casts without moving
    // it). A mismatch either belt misses is a PGRST202: PostgREST cannot
    // resolve the overload, createNutritionPlan returns null, and every plan
    // save fails while tsc, eslint and vitest all stay green.
    it('sends no arguments the RPC does not declare', async () => {
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 'plan-123', error: null } as any)

      await createNutritionPlan(baseParams)

      const sentKeys = Object.keys(
        vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as Record<string, unknown>
      ).sort()

      expect(sentKeys).toEqual([
        'p_base_weight_kg', 'p_baseline_calories', 'p_bmr', 'p_carb_target_g',
        'p_client_id', 'p_coach_id', 'p_custom_calories', 'p_custom_carb_g',
        'p_custom_fat_g', 'p_custom_macros_enabled', 'p_custom_protein_g',
        'p_daily_targets', 'p_diet_type', 'p_effective_from', 'p_fat_target_g',
        'p_goal_deadline', 'p_goal_weight_kg', 'p_protein_target_g',
        'p_protein_target_g_per_kg', 'p_regeneration_reason', 'p_tdee',
        'p_today', 'p_training_volume_hours', 'p_work_activity_level',
      ])
      expect(sentKeys).toHaveLength(24)
      expect(sentKeys).not.toContain('p_coach_notes')
      expect(sentKeys).not.toContain('p_recalc_snapshots')
    })
  })

  describe('getNutritionPlanForDate — the covering-version resolver', () => {
    const ROW = { id: 'v2', client_id: 'client-123', effective_from: '2026-08-01', effective_until: null }

    it('applies the coversDate window predicate, the active filter, and training-identical ordering', async () => {
      const query = createResolverQuery({ data: ROW, error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(query as any)

      const row = await getNutritionPlanForDate('client-123', '2026-08-11')

      expect(supabaseAdmin.from).toHaveBeenCalledWith('nutrition_plans')
      expect(query.select).toHaveBeenCalledWith('*')
      expect(query.eq).toHaveBeenCalledWith('client_id', 'client-123')
      expect(query.eq).toHaveBeenCalledWith('status', 'active')
      // The shared window predicate (services/training-plan-window.ts) —
      // both halves, pinned as strings so a hand-rolled rewrite fails here.
      expect(query.lte).toHaveBeenCalledWith('effective_from', '2026-08-11')
      expect(query.or).toHaveBeenCalledWith('effective_until.gte.2026-08-11,effective_until.is.null')
      expect(query.order).toHaveBeenNthCalledWith(1, 'effective_from', { ascending: false })
      expect(query.order).toHaveBeenNthCalledWith(2, 'created_at', { ascending: false })
      expect(query.limit).toHaveBeenCalledWith(1)
      expect(row).toEqual(ROW)
    })

    it('resolves null when no version covers the date', async () => {
      vi.mocked(supabaseAdmin.from).mockReturnValue(createResolverQuery({ data: null, error: null }) as any)
      expect(await getNutritionPlanForDate('client-123', '2026-08-11')).toBeNull()
    })

    it('throws on a query error instead of masking it as "no plan"', async () => {
      vi.mocked(supabaseAdmin.from).mockReturnValue(
        createResolverQuery({ data: null, error: { message: 'boom' } }) as any
      )
      await expect(getNutritionPlanForDate('client-123', '2026-08-11')).rejects.toThrow(/boom/)
    })
  })

  describe('getNutritionPlanIdForDate — the id-only twin', () => {
    it('selects only the id through the same window predicate and returns it', async () => {
      const query = createResolverQuery({ data: { id: 'v2' }, error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(query as any)

      const id = await getNutritionPlanIdForDate('client-123', '2026-08-11')

      expect(query.select).toHaveBeenCalledWith('id')
      expect(query.eq).toHaveBeenCalledWith('status', 'active')
      expect(query.lte).toHaveBeenCalledWith('effective_from', '2026-08-11')
      expect(query.or).toHaveBeenCalledWith('effective_until.gte.2026-08-11,effective_until.is.null')
      expect(id).toBe('v2')
    })

    it('resolves null (never throws) when no version covers the date', async () => {
      vi.mocked(supabaseAdmin.from).mockReturnValue(createResolverQuery({ data: null, error: null }) as any)
      expect(await getNutritionPlanIdForDate('client-123', '2026-08-11')).toBeNull()
    })
  })

  describe('getNextFutureNutritionPlan — the window-flipped twin', () => {
    it('takes the EARLIEST strictly-future active version, newest-created on a tie', async () => {
      const query = createResolverQuery({
        data: { id: 'v3', effective_from: '2026-09-01' },
        error: null,
      })
      vi.mocked(supabaseAdmin.from).mockReturnValue(query as any)

      const next = await getNextFutureNutritionPlan('client-123', '2026-08-11')

      expect(query.eq).toHaveBeenCalledWith('status', 'active')
      expect(query.gt).toHaveBeenCalledWith('effective_from', '2026-08-11')
      expect(query.order).toHaveBeenNthCalledWith(1, 'effective_from', { ascending: true })
      expect(query.order).toHaveBeenNthCalledWith(2, 'created_at', { ascending: false })
      expect(query.limit).toHaveBeenCalledWith(1)
      expect(next).toEqual({ id: 'v3', effectiveFrom: '2026-09-01' })
    })

    it('resolves null when nothing is queued', async () => {
      vi.mocked(supabaseAdmin.from).mockReturnValue(createResolverQuery({ data: null, error: null }) as any)
      expect(await getNextFutureNutritionPlan('client-123', '2026-08-11')).toBeNull()
    })

    it('throws on a query error', async () => {
      vi.mocked(supabaseAdmin.from).mockReturnValue(
        createResolverQuery({ data: null, error: { message: 'boom' } }) as any
      )
      await expect(getNextFutureNutritionPlan('client-123', '2026-08-11')).rejects.toThrow(/boom/)
    })
  })
})
