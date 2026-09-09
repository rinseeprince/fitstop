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

// The end resolver's two declared bounds are other services' questions; stubbed
// so this suite pins the PRECEDENCE between them, not their queries.
vi.mock('./client-blocks-service', () => ({
  getBlockBoundForDate: vi.fn(),
}))
vi.mock('./training-service', () => ({
  getFurthestLiveProgramEnd: vi.fn(),
}))

import { supabaseAdmin } from './supabase-admin'
import { getClientTodayString } from './today-service'
import { getBlockBoundForDate } from './client-blocks-service'
import { getFurthestLiveProgramEnd } from './training-service'
import {
  createNutritionPlan,
  getNutritionPlanForDate,
  getNutritionPlanIdForDate,
  getNextFutureNutritionPlan,
  getLatestNutritionPlan,
  getActiveNutritionPlanVersionsOverlapping,
  getNextNutritionVersionStartCap,
  getNutritionWindowsForClients,
  resolveNutritionPlacementEnd,
} from './nutrition-plan-service'

/**
 * Chain stub for the date resolvers: every filter/order method self-returns,
 * maybeSingle resolves the given result, and the chain is thenable so an
 * awaited builder (the overlapping read) resolves it too. Mock-level only —
 * the RPC's own semantics are proven by the live behavioral probe, not here;
 * these pin the QUERY SHAPE (the coversDate window predicate, the status
 * filter, the ordering) so a refactor cannot silently drop a clause.
 */
function createResolverQuery(result: { data: unknown; error: { message: string } | null }) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: undefined as unknown,
  }
  Object.defineProperty(query, 'then', {
    value: (resolve: (value: typeof result) => void) => Promise.resolve(result).then(resolve),
  })
  return query
}

describe('Nutrition Plan Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getClientTodayString).mockResolvedValue('2024-01-17')
    vi.mocked(getBlockBoundForDate).mockResolvedValue(null)
    vi.mocked(getFurthestLiveProgramEnd).mockResolvedValue(null)
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
      effectiveUntil: '2024-03-13',
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
      // Single-source invariant: the RPC's belt raises when effectiveFrom <
      // p_today, so p_today must be the SAME string the route's past-date
      // guard judged. A second getClientTodayString call here could straddle
      // client midnight and fail a save the route accepted. This pins both
      // halves: the threaded value reaches the RPC, and this service performs
      // no today lookup of its own.
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

    it("hands the RPC the placement's end verbatim — the row IS the window (migration 166)", async () => {
      // The orchestrator resolves the end once and threads it here; the RPC
      // stores it, and every regenerate reads it off the row. Nothing in this
      // service recomputes or widens it.
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 'plan-123', error: null } as any)

      await createNutritionPlan({ ...baseParams, effectiveUntil: '2024-02-28' })

      expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
        'create_nutrition_plan_atomic',
        expect.objectContaining({ p_effective_until: '2024-02-28' })
      )
    })

    // Two belts, deliberately comparing against different things.
    // COMPILE time: `satisfies CreateNutritionPlanRpcPayload` in
    // nutrition-plan-service.ts checks the payload against types/database.ts,
    // so a key the payload adds, drops or renames no longer builds. That
    // replaced the `as never` casts, which checked nothing at all (Session 5).
    // RUNTIME, here: this list is an independent, hand-transcribed record of
    // migration 166's 25 arguments. The compile check trusts types/database.ts
    // to be a faithful mirror of the live function; this one does not, so it
    // still fires when the SIGNATURE is what moved — regenerating the mirror
    // against a changed database drags the payload along with it, and an arity
    // change then has to be re-pinned here deliberately instead of riding in
    // unnoticed. It moved from 24 to 25 with migration 166 (`p_effective_until`,
    // the placement's end) — the first arity change since 139. A mismatch
    // either belt misses is a PGRST202: PostgREST cannot resolve the overload,
    // createNutritionPlan returns null, and every plan save fails while tsc,
    // eslint and vitest all stay green.
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
        'p_daily_targets', 'p_diet_type', 'p_effective_from', 'p_effective_until',
        'p_fat_target_g', 'p_goal_deadline', 'p_goal_weight_kg',
        'p_protein_target_g', 'p_protein_target_g_per_kg', 'p_regeneration_reason',
        'p_tdee', 'p_today', 'p_training_volume_hours', 'p_work_activity_level',
      ])
      expect(sentKeys).toHaveLength(25)
      expect(sentKeys).not.toContain('p_coach_notes')
      expect(sentKeys).not.toContain('p_recalc_snapshots')
    })
  })

  describe('getNutritionPlanForDate — the covering-version resolver', () => {
    const ROW = { id: 'v2', client_id: 'client-123', effective_from: '2026-08-01', effective_until: '2026-09-25' }

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
      // The `is.null` arm is training's (its placed plans never write an end);
      // a nutrition row never matches it since migration 166, harmlessly.
      expect(query.lte).toHaveBeenCalledWith('effective_from', '2026-08-11')
      expect(query.gte).toHaveBeenCalledWith('effective_until', '2026-08-11')
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
      expect(query.gte).toHaveBeenCalledWith('effective_until', '2026-08-11')
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

  describe('getLatestNutritionPlan — the drawer seed (migration 166)', () => {
    it('takes the latest-starting ACTIVE version, newest-created on a tie — a plain ordering, no open-row lookup', async () => {
      const query = createResolverQuery({ data: { id: 'v9', effective_from: '2026-10-07' }, error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(query as any)

      const latest = await getLatestNutritionPlan('client-123')

      expect(query.select).toHaveBeenCalledWith('*')
      expect(query.eq).toHaveBeenCalledWith('client_id', 'client-123')
      expect(query.eq).toHaveBeenCalledWith('status', 'active')
      expect(query.order).toHaveBeenNthCalledWith(1, 'effective_from', { ascending: false })
      expect(query.order).toHaveBeenNthCalledWith(2, 'created_at', { ascending: false })
      expect(query.limit).toHaveBeenCalledWith(1)
      // No open row exists any more: nothing filters on effective_until IS NULL.
      expect(query.is).not.toHaveBeenCalled()
      expect(latest).toEqual({ id: 'v9', effective_from: '2026-10-07' })
    })

    it('resolves null when the client has no active version at all', async () => {
      vi.mocked(supabaseAdmin.from).mockReturnValue(createResolverQuery({ data: null, error: null }) as any)
      expect(await getLatestNutritionPlan('client-123')).toBeNull()
    })

    it('throws on a query error', async () => {
      vi.mocked(supabaseAdmin.from).mockReturnValue(
        createResolverQuery({ data: null, error: { message: 'boom' } }) as any
      )
      await expect(getLatestNutritionPlan('client-123')).rejects.toThrow(/boom/)
    })
  })

  describe('getActiveNutritionPlanVersionsOverlapping — the segmentation primitive', () => {
    const ROWS = [
      { id: 'v1', effective_from: '2026-06-01', effective_until: '2026-07-19' },
      { id: 'v2', effective_from: '2026-07-20', effective_until: '2026-09-13' },
    ]

    it('bounds both ends of a range: effective_until >= start AND effective_from <= end, earliest first', async () => {
      const query = createResolverQuery({ data: ROWS, error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(query as any)

      const versions = await getActiveNutritionPlanVersionsOverlapping('client-123', '2026-07-01', '2026-08-01')

      expect(query.eq).toHaveBeenCalledWith('status', 'active')
      expect(query.gte).toHaveBeenCalledWith('effective_until', '2026-07-01')
      expect(query.lte).toHaveBeenCalledWith('effective_from', '2026-08-01')
      // Every version has an end: no `is.null` arm anywhere in the predicate.
      expect(query.or).not.toHaveBeenCalled()
      expect(query.order).toHaveBeenCalledWith('effective_from', { ascending: true })
      expect(versions).toEqual([
        { id: 'v1', effectiveFrom: '2026-06-01', effectiveUntil: '2026-07-19' },
        { id: 'v2', effectiveFrom: '2026-07-20', effectiveUntil: '2026-09-13' },
      ])
    })

    it('with no end, takes every version reaching the start or later — no upper bound', async () => {
      const query = createResolverQuery({ data: ROWS, error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(query as any)

      await getActiveNutritionPlanVersionsOverlapping('client-123', '2026-07-01')

      expect(query.gte).toHaveBeenCalledWith('effective_until', '2026-07-01')
      expect(query.lte).not.toHaveBeenCalled()
    })

    it('throws on a query error', async () => {
      vi.mocked(supabaseAdmin.from).mockReturnValue(
        createResolverQuery({ data: null, error: { message: 'boom' } }) as any
      )
      await expect(getActiveNutritionPlanVersionsOverlapping('client-123', '2026-07-01')).rejects.toThrow(/boom/)
    })
  })

  describe('getNextNutritionVersionStartCap — training\'s getNextPlanStartCap, for nutrition', () => {
    it('is the day before the next STRICTLY later active version', async () => {
      const query = createResolverQuery({ data: { effective_from: '2026-07-15' }, error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(query as any)

      const cap = await getNextNutritionVersionStartCap('client-123', '2026-07-01')

      expect(query.eq).toHaveBeenCalledWith('status', 'active')
      // Strict: a version starting the same day is the one the RPC replaces in
      // place, not a cap.
      expect(query.gt).toHaveBeenCalledWith('effective_from', '2026-07-01')
      expect(query.order).toHaveBeenCalledWith('effective_from', { ascending: true })
      expect(cap).toBe('2026-07-14')
    })

    it('is null when a version starting here would be the last', async () => {
      vi.mocked(supabaseAdmin.from).mockReturnValue(createResolverQuery({ data: null, error: null }) as any)
      expect(await getNextNutritionVersionStartCap('client-123', '2026-07-01')).toBeNull()
    })

    it('throws on a query error', async () => {
      vi.mocked(supabaseAdmin.from).mockReturnValue(
        createResolverQuery({ data: null, error: { message: 'boom' } }) as any
      )
      await expect(getNextNutritionVersionStartCap('client-123', '2026-07-01')).rejects.toThrow(/boom/)
    })
  })

  // =========================================================================
  // The placement's end (migration 166) — resolved ONCE at save, the way
  // resolvePlacementWindowEnd decides a training window, then stored on the
  // row. Precedence, then the cap.
  // =========================================================================
  describe('getNutritionWindowsForClients — the attention feed\'s cross-client read', () => {
    it('maps every active version to its stored window, in one chunked read', async () => {
      const calls: Record<string, unknown[][]> = {}
      const q: Record<string, unknown> = {}
      for (const method of ['select', 'in', 'eq', 'order', 'range']) {
        q[method] = vi.fn((...args: unknown[]) => {
          ;(calls[method] ??= []).push(args)
          return q
        })
      }
      Object.defineProperty(q, 'then', {
        value: (resolve: (v: { data: unknown[]; error: null }) => void) =>
          Promise.resolve({
            data: [
              { id: 'v1', client_id: 'c1', effective_from: '2026-02-02', effective_until: '2026-03-01' },
              { id: 'v2', client_id: 'c2', effective_from: '2026-01-05', effective_until: '2026-02-01' },
            ],
            error: null,
          }).then(resolve),
      })
      vi.mocked(supabaseAdmin.from).mockReturnValue(q as never)

      expect(await getNutritionWindowsForClients(['c1', 'c2'])).toEqual([
        { clientId: 'c1', start: '2026-02-02', end: '2026-03-01' },
        { clientId: 'c2', start: '2026-01-05', end: '2026-02-01' },
      ])
      // An archived version governs nothing, so a deleted plan stops the alert.
      expect(calls.eq).toEqual([['status', 'active']])
      expect(calls.in).toEqual([['client_id', ['c1', 'c2']]])
    })

    it('reads nothing for no ids', async () => {
      vi.mocked(supabaseAdmin.from).mockClear()
      expect(await getNutritionWindowsForClients([])).toEqual([])
      expect(supabaseAdmin.from).not.toHaveBeenCalled()
    })
  })

  describe('resolveNutritionPlacementEnd', () => {
    const START = '2026-09-04'

    /** No queued version: the cap read finds nothing. */
    function noQueuedVersion() {
      vi.mocked(supabaseAdmin.from).mockReturnValue(createResolverQuery({ data: null, error: null }) as any)
    }

    it('the block covering the start wins, even when a program runs longer', async () => {
      // Precedence, not a maximum: the block IS the coach's declared bound, so a
      // program overrunning it does not stretch the window.
      vi.mocked(getBlockBoundForDate).mockResolvedValue({ kind: 'covering', endsOn: '2026-11-06' })
      vi.mocked(getFurthestLiveProgramEnd).mockResolvedValue('2027-01-15')
      noQueuedVersion()

      expect(await resolveNutritionPlacementEnd('client-123', START)).toBe('2026-11-06')
      expect(getBlockBoundForDate).toHaveBeenCalledWith('client-123', START)
    })

    it("caps the program fallback at the day before the next block when the start is in a gap", async () => {
      // The furthest program runs to 2026-12-11, but the next block opens on
      // 2026-10-01: targets saved in the gap stop the day before it, so a block
      // the coach has not priced never carries these numbers.
      vi.mocked(getBlockBoundForDate).mockResolvedValue({ kind: 'next', startsOn: '2026-10-01' })
      vi.mocked(getFurthestLiveProgramEnd).mockResolvedValue('2026-12-11')
      noQueuedVersion()

      expect(await resolveNutritionPlacementEnd('client-123', START)).toBe('2026-09-30')
    })

    it('caps the eight-week fallback the same way', async () => {
      vi.mocked(getBlockBoundForDate).mockResolvedValue({ kind: 'next', startsOn: '2026-09-20' })
      noQueuedVersion()

      expect(await resolveNutritionPlacementEnd('client-123', START)).toBe('2026-09-19')
    })

    it('a next block past the fallback changes nothing — a cap, never a length', async () => {
      vi.mocked(getBlockBoundForDate).mockResolvedValue({ kind: 'next', startsOn: '2027-01-01' })
      vi.mocked(getFurthestLiveProgramEnd).mockResolvedValue('2026-12-11')
      noQueuedVersion()

      expect(await resolveNutritionPlacementEnd('client-123', START)).toBe('2026-12-11')
    })

    it("falls to the furthest live program's end when no block covers the start", async () => {
      vi.mocked(getFurthestLiveProgramEnd).mockResolvedValue('2026-12-11')
      noQueuedVersion()

      expect(await resolveNutritionPlacementEnd('client-123', START)).toBe('2026-12-11')
      expect(getFurthestLiveProgramEnd).toHaveBeenCalledWith('client-123', START)
    })

    it('falls to exactly eight weeks when the client has neither', async () => {
      noQueuedVersion()
      // 2026-09-04 + 56 days, both ends inclusive of the placement.
      expect(await resolveNutritionPlacementEnd('client-123', START)).toBe('2026-10-30')
    })

    it('is capped at the day before the next queued version', async () => {
      vi.mocked(getBlockBoundForDate).mockResolvedValue({ kind: 'covering', endsOn: '2026-11-06' })
      vi.mocked(supabaseAdmin.from).mockReturnValue(
        createResolverQuery({ data: { effective_from: '2026-10-12' }, error: null }) as any
      )

      expect(await resolveNutritionPlacementEnd('client-123', START)).toBe('2026-10-11')
    })

    it('a queued version past the declared bound changes nothing', async () => {
      vi.mocked(getBlockBoundForDate).mockResolvedValue({ kind: 'covering', endsOn: '2026-11-06' })
      vi.mocked(supabaseAdmin.from).mockReturnValue(
        createResolverQuery({ data: { effective_from: '2026-11-20' }, error: null }) as any
      )

      expect(await resolveNutritionPlacementEnd('client-123', START)).toBe('2026-11-06')
    })
  })
})
