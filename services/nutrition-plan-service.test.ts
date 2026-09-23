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
  getSurplusSettingsForDate,
  getSurplusSettingsForClientToday,
  getNextFutureNutritionPlan,
  getLatestNutritionPlan,
  getNutritionPrescriptionsForRange,
  getNutritionPlanGrids,
  getNextNutritionVersionStartCap,
  getNutritionVersionGoalsFrom,
  getNutritionWindowsForClients,
  listNutritionPlanNotesInRange,
  resolveNutritionPlacementEnd,
} from './nutrition-plan-service'
import { BLOCKS_UNREADABLE } from '@/lib/constants'

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
    not: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
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
      includeActivityBurn: true,
      surplusAsCarbs: false,
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
    // the placement's end) — the first arity change since 139; migration 172
    // added `p_coach_note`, optional and OMITTED when the save carries none;
    // migration 196 added the version's two surplus settings, both required, so
    // the no-note payload is 27 and a note makes it 28. A mismatch
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
        'p_include_activity_burn', 'p_protein_target_g', 'p_protein_target_g_per_kg',
        'p_regeneration_reason', 'p_surplus_as_carbs',
        'p_tdee', 'p_today', 'p_training_volume_hours', 'p_work_activity_level',
      ])
      expect(sentKeys).toHaveLength(27)
      expect(sentKeys).not.toContain('p_coach_notes')
      expect(sentKeys).not.toContain('p_coach_note')
      expect(sentKeys).not.toContain('p_recalc_snapshots')
    })

    it("sends p_coach_note only when the save carries a note — the RPC's DEFAULT NULL is the empty case (migration 172)", async () => {
      // Never an explicit null: the RPC's default does the rest, and on a
      // same-day re-save an omitted note clears the version's — the note is the
      // latest save's, empty included.
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 'plan-123', error: null } as any)

      await createNutritionPlan({ ...baseParams, coachNote: 'Aggressive' })

      const sent = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as Record<string, unknown>
      expect(sent.p_coach_note).toBe('Aggressive')
      expect(Object.keys(sent)).toHaveLength(28)
    })

    it("sends the version's two surplus settings as the save states them (migration 196)", async () => {
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 'plan-123', error: null } as any)

      await createNutritionPlan({ ...baseParams, includeActivityBurn: false, surplusAsCarbs: true })

      const sent = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as Record<string, unknown>
      expect(sent.p_include_activity_burn).toBe(false)
      expect(sent.p_surplus_as_carbs).toBe(true)
    })
  })

  describe("listNutritionPlanNotesInRange — the client Program tab's notes are its versions' (migration 172)", () => {
    it('reads the ACTIVE versions starting inside the range that carry a note, oldest first, on the wire shape', async () => {
      const query = createResolverQuery({
        data: [
          { id: 'v1', effective_from: '2026-08-05', coach_note: 'Dropping calories 200.' },
          { id: 'v2', effective_from: '2026-08-19', coach_note: 'Holding here.' },
        ],
        error: null,
      })
      vi.mocked(supabaseAdmin.from).mockReturnValue(query as never)

      const notes = await listNutritionPlanNotesInRange('client-123', '2026-08-01', '2026-08-31')

      expect(supabaseAdmin.from).toHaveBeenCalledWith('nutrition_plans')
      expect(query.eq).toHaveBeenCalledWith('client_id', 'client-123')
      // An archived version takes its note with it — the residue a block drawn
      // over a deleted plan used to list.
      expect(query.eq).toHaveBeenCalledWith('status', 'active')
      expect(query.not).toHaveBeenCalledWith('coach_note', 'is', null)
      // STARTING inside the range: a version that began before the block keeps
      // its note out of it, as the date-anchored read did.
      expect(query.gte).toHaveBeenCalledWith('effective_from', '2026-08-01')
      expect(query.lte).toHaveBeenCalledWith('effective_from', '2026-08-31')
      expect(query.order).toHaveBeenCalledWith('effective_from', { ascending: true })
      expect(notes).toEqual([
        { id: 'v1', effectiveOn: '2026-08-05', body: 'Dropping calories 200.' },
        { id: 'v2', effectiveOn: '2026-08-19', body: 'Holding here.' },
      ])
    })

    it('throws on a read error rather than answering with no notes', async () => {
      vi.mocked(supabaseAdmin.from).mockReturnValue(
        createResolverQuery({ data: null, error: { message: 'boom' } }) as never
      )
      await expect(
        listNutritionPlanNotesInRange('client-123', '2026-08-01', '2026-08-31')
      ).rejects.toThrow(/boom/)
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

  describe('getSurplusSettingsForDate — the covering version\'s two settings (migration 196)', () => {
    it('reads the two settings through the same window predicate', async () => {
      const query = createResolverQuery({
        data: { include_activity_burn: false, surplus_as_carbs: true },
        error: null,
      })
      vi.mocked(supabaseAdmin.from).mockReturnValue(query as any)

      const settings = await getSurplusSettingsForDate('client-123', '2026-08-14')

      expect(query.select).toHaveBeenCalledWith('include_activity_burn, surplus_as_carbs')
      expect(query.eq).toHaveBeenCalledWith('client_id', 'client-123')
      expect(query.eq).toHaveBeenCalledWith('status', 'active')
      expect(query.lte).toHaveBeenCalledWith('effective_from', '2026-08-14')
      expect(query.gte).toHaveBeenCalledWith('effective_until', '2026-08-14')
      expect(settings).toEqual({ includeActivityBurn: false, surplusAsCarbs: true })
    })

    it('no version covers the date: the defaults a first plan starts from', async () => {
      vi.mocked(supabaseAdmin.from).mockReturnValue(createResolverQuery({ data: null, error: null }) as any)
      expect(await getSurplusSettingsForDate('client-123', '2026-08-14')).toEqual({
        includeActivityBurn: true,
        surplusAsCarbs: false,
      })
    })

    it("the client's today: resolved from the client, then read for that day", async () => {
      const query = createResolverQuery({
        data: { include_activity_burn: true, surplus_as_carbs: true },
        error: null,
      })
      vi.mocked(supabaseAdmin.from).mockReturnValue(query as any)

      const settings = await getSurplusSettingsForClientToday('client-123')

      expect(getClientTodayString).toHaveBeenCalledWith('client-123')
      expect(query.lte).toHaveBeenCalledWith('effective_from', '2024-01-17')
      expect(settings).toEqual({ includeActivityBurn: true, surplusAsCarbs: true })
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

  describe('getNutritionVersionGoalsFrom — what the out-of-date rule judges (commit 8d1)', () => {
    it('reads the active versions with a day on or after today, earliest first, with the goal each was built for', async () => {
      const query = createResolverQuery({
        data: [
          { id: 'v1', effective_from: '2026-09-01', effective_until: '2026-10-31', goal_weight_kg: 81.4, goal_deadline: '2026-11-20' },
          { id: 'v2', effective_from: '2026-11-01', effective_until: '2026-12-26', goal_weight_kg: null, goal_deadline: null },
        ],
        error: null,
      })
      vi.mocked(supabaseAdmin.from).mockReturnValue(query as any)

      const versions = await getNutritionVersionGoalsFrom('client-123', '2026-09-23')

      expect(query.select).toHaveBeenCalledWith('id, effective_from, effective_until, goal_weight_kg, goal_deadline')
      expect(query.eq).toHaveBeenCalledWith('client_id', 'client-123')
      expect(query.eq).toHaveBeenCalledWith('status', 'active')
      // A version that has ended is history and never judged.
      expect(query.gte).toHaveBeenCalledWith('effective_until', '2026-09-23')
      expect(query.order).toHaveBeenCalledWith('effective_from', { ascending: true })
      expect(versions).toEqual([
        { id: 'v1', effectiveFrom: '2026-09-01', effectiveUntil: '2026-10-31', built: { goalWeightKg: 81.4, deadline: '2026-11-20' } },
        { id: 'v2', effectiveFrom: '2026-11-01', effectiveUntil: '2026-12-26', built: { goalWeightKg: null, deadline: null } },
      ])
    })

    it('throws on a query error', async () => {
      vi.mocked(supabaseAdmin.from).mockReturnValue(
        createResolverQuery({ data: null, error: { message: 'boom' } }) as any
      )
      await expect(getNutritionVersionGoalsFrom('client-123', '2026-09-23')).rejects.toThrow(/boom/)
    })
  })

  describe('getNutritionPrescriptionsForRange — the day reader\'s version read', () => {
    it('applies the same overlap predicate and carries the three prescription fields, the save note and the two surplus settings', async () => {
      const query = createResolverQuery({
        data: [
          { id: 'v1', effective_from: '2026-06-01', effective_until: '2026-07-19', baseline_calories: 1875, protein_target_g: 152, diet_type: 'balanced', coach_note: 'Starting the cut.', include_activity_burn: true, surplus_as_carbs: false },
          { id: 'v2', effective_from: '2026-07-20', effective_until: '2026-09-13', baseline_calories: 2025, protein_target_g: 158, diet_type: 'high_carb', coach_note: null, include_activity_burn: false, surplus_as_carbs: true },
        ],
        error: null,
      })
      vi.mocked(supabaseAdmin.from).mockReturnValue(query as any)

      const versions = await getNutritionPrescriptionsForRange('client-123', '2026-07-01', '2026-08-01')

      expect(query.select).toHaveBeenCalledWith(
        'id, effective_from, effective_until, baseline_calories, protein_target_g, diet_type, coach_note, include_activity_burn, surplus_as_carbs'
      )
      expect(query.eq).toHaveBeenCalledWith('client_id', 'client-123')
      expect(query.eq).toHaveBeenCalledWith('status', 'active')
      expect(query.gte).toHaveBeenCalledWith('effective_until', '2026-07-01')
      expect(query.lte).toHaveBeenCalledWith('effective_from', '2026-08-01')
      expect(query.or).not.toHaveBeenCalled()
      expect(query.order).toHaveBeenCalledWith('effective_from', { ascending: true })
      expect(versions).toEqual([
        { id: 'v1', effectiveFrom: '2026-06-01', effectiveUntil: '2026-07-19', baselineCalories: 1875, proteinTargetG: 152, dietType: 'balanced', coachNote: 'Starting the cut.', includeActivityBurn: true, surplusAsCarbs: false },
        { id: 'v2', effectiveFrom: '2026-07-20', effectiveUntil: '2026-09-13', baselineCalories: 2025, proteinTargetG: 158, dietType: 'high_carb', coachNote: null, includeActivityBurn: false, surplusAsCarbs: true },
      ])
    })

    it('throws on a query error', async () => {
      vi.mocked(supabaseAdmin.from).mockReturnValue(
        createResolverQuery({ data: null, error: { message: 'boom' } }) as any
      )
      await expect(getNutritionPrescriptionsForRange('client-123', '2026-07-01', '2026-08-01')).rejects.toThrow(/boom/)
    })
  })

  describe('getNutritionPlanGrids — the versions\' weekday grids in one read', () => {
    it('reads every given version\'s rows in one IN query and maps them', async () => {
      const query = createResolverQuery({
        data: [
          { nutrition_plan_id: 'v1', day_of_week: 'monday', calories: 1850, protein_g: 152, carb_g: 205, fat_g: 62 },
          { nutrition_plan_id: 'v2', day_of_week: 'monday', calories: 2050, protein_g: 158, carb_g: 240, fat_g: 66 },
        ],
        error: null,
      })
      vi.mocked(supabaseAdmin.from).mockReturnValue(query as any)

      const rows = await getNutritionPlanGrids(['v1', 'v2'])

      expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
      expect(supabaseAdmin.from).toHaveBeenCalledWith('nutrition_plan_daily_targets')
      expect(query.select).toHaveBeenCalledWith('nutrition_plan_id, day_of_week, calories, protein_g, carb_g, fat_g')
      expect(query.in).toHaveBeenCalledWith('nutrition_plan_id', ['v1', 'v2'])
      expect(rows).toEqual([
        { planId: 'v1', dayOfWeek: 'monday', calories: 1850, proteinG: 152, carbG: 205, fatG: 62 },
        { planId: 'v2', dayOfWeek: 'monday', calories: 2050, proteinG: 158, carbG: 240, fatG: 66 },
      ])
    })

    it('reads nothing for no ids', async () => {
      expect(await getNutritionPlanGrids([])).toEqual([])
      expect(supabaseAdmin.from).not.toHaveBeenCalled()
    })

    it('throws on a query error', async () => {
      vi.mocked(supabaseAdmin.from).mockReturnValue(
        createResolverQuery({ data: null, error: { message: 'boom' } }) as any
      )
      await expect(getNutritionPlanGrids(['v1'])).rejects.toThrow(/boom/)
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

    it("refuses when the client's blocks can't be read — no fallback stands in for the bound", async () => {
      // A failed read knows nothing, and the caller writes after this: targets
      // stored without the block's end would run past it.
      vi.mocked(getBlockBoundForDate).mockRejectedValue(new Error(BLOCKS_UNREADABLE))
      vi.mocked(getFurthestLiveProgramEnd).mockResolvedValue('2026-12-11')
      noQueuedVersion()

      await expect(resolveNutritionPlacementEnd('client-123', START)).rejects.toThrow(
        BLOCKS_UNREADABLE
      )
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
