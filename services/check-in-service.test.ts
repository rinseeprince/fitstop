import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
} from './check-in-service'

// Mock the supabase-admin module
vi.mock('./supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

// Session 6.4: submitCheckIn now DERIVES its snapshot columns from the spine.
// Mock those service dependencies so the submit tests assert the derived values
// (and that the exercise-highlights writer is the only related-data write left —
// the session-completions writer was deleted with its dropped table).
const getClientByIdMock = vi.fn()
const getNutritionPeriodMock = vi.fn()
const getEventsForDateRangeMock = vi.fn()
const getDailyLogsMock = vi.fn()
const insertExerciseHighlightsMock = vi.fn()
const insertCheckInAnswersMock = vi.fn()
const calculateCheckInPeriodMock = vi.fn()
const resolveCheckInWindowMock = vi.fn()
const appendMeasurementsMock = vi.fn()
const buildSentSnapshotAtSendMock = vi.fn()

// The measurement log: submit writes the check-in's readings as rows stamped
// with its id. No reader folds them back — a sent check-in reports its saved
// copy (lib/check-in/sent-snapshot.ts).
vi.mock('./measurements-service', () => ({
  appendMeasurements: (...args: unknown[]) => appendMeasurementsMock(...args),
}))

// The copy a check-in saves when it is sent (migration 195), built before the
// INSERT and written in it.
vi.mock('./check-in-sent-snapshot-service', () => ({
  buildSentSnapshotAtSend: (...args: unknown[]) => buildSentSnapshotAtSendMock(...args),
}))

vi.mock('./client-service', () => ({
  getClientById: (...args: unknown[]) => getClientByIdMock(...args),
}))
vi.mock('./nutrition-period-service', () => ({
  getNutritionPeriod: (...args: unknown[]) => getNutritionPeriodMock(...args),
}))
vi.mock('./training-event-service', () => ({
  getEventsForDateRange: (...args: unknown[]) => getEventsForDateRangeMock(...args),
}))
vi.mock('./daily-logs-service', () => ({
  getDailyLogs: (...args: unknown[]) => getDailyLogsMock(...args),
}))
vi.mock('./check-in-details-service', () => ({
  insertExerciseHighlights: (...args: unknown[]) => insertExerciseHighlightsMock(...args),
  insertCheckInAnswers: (...args: unknown[]) => insertCheckInAnswersMock(...args),
  // getTrainingEventDetailsForCheckIn / getCheckInWithDetails /
  // getCheckInExerciseHighlights / getCheckInAnswers are re-exported but unused
  // by these tests; stub to keep the module mock total.
  getTrainingEventDetailsForCheckIn: vi.fn(),
  getCheckInWithDetails: vi.fn(),
  getCheckInExerciseHighlights: vi.fn(),
  getCheckInAnswers: vi.fn(),
}))

import { supabaseAdmin } from './supabase-admin'

/** A week's calendar workouts, as `getEventsForDateRange` hands them over —
 *  each with the log the read embeds, which is where the quality lives. */
function workout(
  date: string,
  quality: 'full' | 'partial' | null,
  status = quality === null ? 'scheduled' : 'completed',
) {
  return {
    id: `ev-${date}`,
    clientId: 'client-123',
    trainingPlanId: null,
    trainingSessionId: `ts-${date}`,
    date,
    sessionName: 'Session',
    sessionFocus: null,
    estimatedCalories: null,
    status,
    sessionLogId: quality === null ? null : `log-${date}`,
    log: quality === null ? null : { id: `log-${date}`, completionQuality: quality, performedSessionId: `ts-${date}`, notes: null },
    isModified: false,
    calorieSurplusPercentage: null,
    createdAt: '2026-05-08T00:00:00Z',
    updatedAt: '2026-05-08T00:00:00Z',
  }
}

/** A kernel run: two frozen rows and the figures the submit stores. */
function nutritionPeriod(summary: { onTarget: number; targetedDays: number; calorieAdherencePct: number | null }) {
  return {
    days: [
      { date: '2026-05-08', dayOfWeek: 'friday', status: 'hit', targetCalories: 2000, targetProteinG: 150, targetCarbsG: 200, targetFatG: 60, actualCalories: 2000, actualProteinG: 150, actualCarbsG: 200, actualFatG: 60 },
      { date: '2026-05-09', dayOfWeek: 'saturday', status: 'not_logged', targetCalories: 2000, targetProteinG: 150, targetCarbsG: 200, targetFatG: 60, actualCalories: null, actualProteinG: null, actualCarbsG: null, actualFatG: null },
    ],
    summary: { periodDays: 7, loggedDays: 1, judgedDays: 1, loggedNoTargetDays: 0, over: 0, under: 0, daysOnTargetPct: null, targetTotals: null, consumedOnTargetedDays: null, periodVerdict: null, perJudgedDay: null, intakePerLoggedDay: null, netCaloriesOnJudgedDays: null, ...summary },
  }
}

/**
 * A check-in's saved copy as the database hands it back (lib/check-in/sent-snapshot.ts):
 * what it reported when it was sent. `readings` fills in the rest as null.
 */
function sentCopy(readings: Record<string, number> = {}) {
  return {
    version: 1,
    day: '2026-06-14',
    readings: { weight: null, bodyFat: null, waist: null, hips: null, chest: null, arms: null, thighs: null, ...readings },
    standing: { weight: readings.weight ?? null, bodyFat: readings.bodyFat ?? null },
    goal: null,
    goalProgress: {},
    nutritionPlan: null,
    period: null,
    questions: [],
  }
}

// We mock the whole date-helpers module elsewhere is risky (the service uses
// several helpers), so instead we spy on calculateCheckInPeriod via partial mock.
vi.mock('@/lib/date-helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/date-helpers')>()
  return {
    ...actual,
    calculateCheckInPeriod: (...args: unknown[]) => calculateCheckInPeriodMock(...args),
    resolveCheckInWindow: (...args: unknown[]) => resolveCheckInWindowMock(...args),
  }
})

// Helper to create a chainable mock query
function createMockQuery(result: { data: unknown; error: unknown }) {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  }

  // Make the query itself thenable for await without .single()
  const thenableMock = Object.assign(mockQuery, {
    then: (resolve: (value: typeof result) => void) => Promise.resolve(result).then(resolve),
  })

  return thenableMock
}

describe('Check-in Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    appendMeasurementsMock.mockReset()
    appendMeasurementsMock.mockResolvedValue({
      rows: {},
      inserted: [],
      unchanged: [],
      energy: 'nothing_inserted',
    })
    buildSentSnapshotAtSendMock.mockReset()
    buildSentSnapshotAtSendMock.mockResolvedValue(sentCopy({ weight: 79.9 }))
  })

  describe('submitCheckIn (Session 6.4 spine derivation)', () => {
    // The submit writes to two tables: the check_ins INSERT, and the clients
    // UPDATE that advances the schedule (submit is one of the two writers of
    // next_check_in_due). `advanceQuery` is returned so tests can assert on it.
    let advanceQuery: {
      update: ReturnType<typeof vi.fn>
      eq: ReturnType<typeof vi.fn>
    }

    function mockInsert(
      result: { data: unknown; error: unknown },
      advanceResult: { error: unknown } = { error: null },
    ) {
      const mockInsertQuery = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(result),
        // A later write to the check-in row would succeed quietly here, so only
        // the assertions can catch it.
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      }
      const update = { update: vi.fn(), eq: vi.fn() }
      update.update.mockReturnValue(update)
      update.eq.mockReturnValue(Promise.resolve(advanceResult))
      advanceQuery = update
      vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) =>
        table === "clients" ? update : mockInsertQuery) as never)
      return mockInsertQuery
    }

    beforeEach(() => {
      getClientByIdMock.mockReset()
      getNutritionPeriodMock.mockReset()
      getEventsForDateRangeMock.mockReset()
      getEventsForDateRangeMock.mockResolvedValue([])
      getDailyLogsMock.mockReset()
      insertExerciseHighlightsMock.mockReset()
      insertCheckInAnswersMock.mockReset()
      calculateCheckInPeriodMock.mockReset()
      resolveCheckInWindowMock.mockReset()
      // Default happy-path period + client.
      getClientByIdMock.mockResolvedValue({ id: 'client-123', nextCheckInDue: '2026-06-14', startDate: '2026-01-01', timezone: 'UTC' }) // a Sunday
      resolveCheckInWindowMock.mockReturnValue({ periodStart: '2026-05-08', periodEnd: '2026-05-14' })
      getNutritionPeriodMock.mockResolvedValue(nutritionPeriod({ targetedDays: 0, onTarget: 0, calorieAdherencePct: null }))
      getDailyLogsMock.mockResolvedValue([])
    })

    it('submits a basic check-in successfully', async () => {
      const q = mockInsert({ data: { id: 'new-check-in-id' }, error: null })

      const { submitCheckIn } = await import('./check-in-service')
      const result = await submitCheckIn('client-123', { weight: 180, weightUnit: 'lbs' })

      expect(result).toBe('new-check-in-id')
      expect(supabaseAdmin.from).toHaveBeenCalledWith('check_ins')
      expect(q.insert).toHaveBeenCalled()
    })

    // ---- the saved copy: the check-in as it stands, written in the INSERT ----

    it("throws for a client it cannot find — a check-in no one's goal can be judged for", async () => {
      getClientByIdMock.mockResolvedValue(null)
      const q = mockInsert({ data: { id: 'never' }, error: null })

      const { submitCheckIn } = await import('./check-in-service')
      await expect(submitCheckIn('client-404', { weight: 80.1 })).rejects.toThrow('Client not found')
      expect(q.insert).not.toHaveBeenCalled()
      expect(buildSentSnapshotAtSendMock).not.toHaveBeenCalled()
    })

    it('writes the saved copy IN the INSERT — never a later update — with created_at the same instant it was judged at', async () => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime(new Date('2026-06-14T12:00:00Z'))
        const copy = sentCopy({ weight: 80.6, bodyFat: 17.9 })
        buildSentSnapshotAtSendMock.mockResolvedValue(copy)
        const q = mockInsert({ data: { id: 'ci-sent-1' }, error: null })

        const { submitCheckIn } = await import('./check-in-service')
        await submitCheckIn('client-123', { weight: 80.6, bodyFatPercentage: 17.9 })

        expect(q.insert).toHaveBeenCalledTimes(1)
        const inserted = q.insert.mock.calls[0][0]
        expect(inserted.sent_snapshot).toBe(copy)
        expect(inserted.created_at).toBe('2026-06-14T12:00:00.000Z')
        // One clock: the copy was judged at the row's own instant and day.
        const [input] = buildSentSnapshotAtSendMock.mock.calls[0]
        expect(input.at.toISOString()).toBe(inserted.created_at)
        expect(input.day).toBe('2026-06-14')
        // Built BEFORE the INSERT, so the row never exists without it…
        expect(buildSentSnapshotAtSendMock.mock.invocationCallOrder[0]).toBeLessThan(
          q.insert.mock.invocationCallOrder[0],
        )
        // …and no statement after the INSERT touches the check-in row: the
        // only update is the schedule advance on `clients`.
        expect(vi.mocked(supabaseAdmin.from).mock.calls.filter(([table]) => (table as string) === 'check_ins')).toHaveLength(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('hands the copy what the form reported, the stored week and its food rows, and the questions answered', async () => {
      getNutritionPeriodMock.mockResolvedValue(nutritionPeriod({ targetedDays: 2, onTarget: 1, calorieAdherencePct: 62 }))
      mockInsert({ data: { id: 'ci-sent-2' }, error: null })

      const { submitCheckIn } = await import('./check-in-service')
      await submitCheckIn('client-123', {
        weight: 80.8,
        waist: 82.3,
        customAnswers: [
          { questionId: 'q-sleep', answer: 'slept badly' },
          { questionId: 'q-blank', answer: '   ' },
          { questionId: 'q-sleep', answer: 'twice, by a retry' },
          { questionId: 'q-knee', answer: 'left knee' },
        ],
      })

      const [input] = buildSentSnapshotAtSendMock.mock.calls[0]
      expect(input.client).toEqual(expect.objectContaining({ id: 'client-123', timezone: 'UTC' }))
      expect(input.reported).toEqual({ weight: 80.8, waist: 82.3 })
      expect(input.period).toEqual({ start: '2026-05-08', end: '2026-05-14' })
      // The same kernel rows the period snapshot freezes.
      expect(input.nutritionDays).toEqual(nutritionPeriod({ targetedDays: 2, onTarget: 1, calorieAdherencePct: 62 }).days)
      // A blank answer is never stored, so its wording is not kept; a repeat is kept once.
      expect(input.answeredQuestionIds).toEqual(['q-sleep', 'q-knee'])
    })

    it('writes nothing when the copy cannot be built — a check-in never exists without it', async () => {
      buildSentSnapshotAtSendMock.mockRejectedValue(new Error('Failed to read goals: down'))
      const q = mockInsert({ data: { id: 'ci-sent-3' }, error: null })

      const { submitCheckIn } = await import('./check-in-service')
      await expect(submitCheckIn('client-123', { weight: 80.9 })).rejects.toThrow('Failed to read goals: down')
      expect(q.insert).not.toHaveBeenCalled()
      expect(appendMeasurementsMock).not.toHaveBeenCalled()
      expect(insertCheckInAnswersMock).not.toHaveBeenCalled()
    })

    // ---- the readings: rows in the measurement log, stamped with the id ----

    it('records the seven readings in the measurement log stamped with the new check-in id, never as columns', async () => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime(new Date('2026-06-14T12:00:00Z'))
        getClientByIdMock.mockResolvedValue({ nextCheckInDue: null, startDate: '2026-01-01', timezone: 'UTC' })
        const q = mockInsert({ data: { id: 'new-check-in-id' }, error: null })

        const { submitCheckIn } = await import('./check-in-service')
        await submitCheckIn('client-123', {
          weight: 80,
          bodyFatPercentage: 18,
          waist: 81,
          hips: 95,
          chest: 100,
          arms: 35,
          thighs: 55,
        })

        const inserted = q.insert.mock.calls[0][0]
        for (const column of ['weight', 'body_fat_percentage', 'waist', 'hips', 'chest', 'arms', 'thighs']) {
          expect(inserted).not.toHaveProperty(column)
        }
        // Dated the client's day, measured now, the form's bodyFatPercentage
        // under the log's bodyFat key — and stamped with the INSERT's id.
        expect(appendMeasurementsMock).toHaveBeenCalledWith({
          clientId: 'client-123',
          source: 'check_in',
          sourceId: 'new-check-in-id',
          recordedOn: '2026-06-14',
          measuredAt: '2026-06-14T12:00:00.000Z',
          values: { weight: 80, bodyFat: 18, waist: 81, hips: 95, chest: 100, arms: 35, thighs: 55 },
        })
      } finally {
        vi.useRealTimers()
      }
    })

    it("dates the readings on the CLIENT's day (Kiritimati boundary)", async () => {
      // UTC+14: at 12:00 UTC June 9 the client is already on June 10, and the
      // reading belongs to their day — the same day the stored period is on.
      vi.useFakeTimers()
      try {
        vi.setSystemTime(new Date('2026-06-09T12:00:00Z'))
        getClientByIdMock.mockResolvedValue({
          nextCheckInDue: null,
          startDate: '2026-01-01',
          timezone: 'Pacific/Kiritimati',
        })
        mockInsert({ data: { id: 'ci' }, error: null })

        const { submitCheckIn } = await import('./check-in-service')
        await submitCheckIn('client-123', { weight: 80 })

        expect(appendMeasurementsMock).toHaveBeenCalledWith(
          expect.objectContaining({ recordedOn: '2026-06-10' }),
        )
      } finally {
        vi.useRealTimers()
      }
    })

    it('writes nothing to the log when the form carries no reading', async () => {
      mockInsert({ data: { id: 'ci' }, error: null })

      const { submitCheckIn } = await import('./check-in-service')
      await submitCheckIn('client-123', { notes: 'reflection' })

      expect(appendMeasurementsMock).not.toHaveBeenCalled()
    })

    it('does NOT swallow a failed readings write — the check-in stands, the POST does not', async () => {
      // The same seam as the answers below (CONVENTIONS section 2 item 13),
      // and placed FIRST: nothing else runs on a check-in whose readings did
      // not land — here, the schedule advance the client would otherwise get.
      mockInsert({ data: { id: 'ci' }, error: null })
      appendMeasurementsMock.mockRejectedValueOnce(new Error('Failed to record measurements: boom'))

      const { submitCheckIn } = await import('./check-in-service')

      await expect(
        submitCheckIn('client-123', { weight: 80 }),
      ).rejects.toThrow('Failed to record measurements: boom')
      expect(advanceQuery.update).not.toHaveBeenCalled()
    })

    // The database backstop (migration 156). The write path checks the gate
    // first, so reaching a 23505 means two submissions raced — the double-tap
    // the constraint exists for. A client must never be shown the raw
    // Postgres text (CONVENTIONS §10).
    it('translates the duplicate-period constraint into a sentence a client can read', async () => {
      mockInsert({
        data: null,
        error: {
          code: '23505',
          message:
            'duplicate key value violates unique constraint "idx_check_ins_client_period_unique"',
        },
      })

      const { submitCheckIn } = await import('./check-in-service')
      await expect(
        submitCheckIn('client-123', { weight: 180, weightUnit: 'lbs' }),
      ).rejects.toThrow('You have already checked in for this period.')
    })

    it('still surfaces other insert failures with their cause', async () => {
      mockInsert({ data: null, error: { code: '42501', message: 'permission denied' } })

      const { submitCheckIn } = await import('./check-in-service')
      await expect(
        submitCheckIn('client-123', { weight: 180, weightUnit: 'lbs' }),
      ).rejects.toThrow('permission denied')
    })

    // ---- the SECOND writer of clients.next_check_in_due ----------------
    // The coach's date picker is the first. Nothing else may write it.

    it('advances the schedule by one frequency step from the due date it satisfies', async () => {
      // Time is pinned: an unpinned "today" would leave the fixture's due date
      // lapsed and the roll below would move it before the step is applied.
      vi.useFakeTimers()
      try {
        vi.setSystemTime(new Date('2026-06-14T12:00:00Z'))
        getClientByIdMock.mockResolvedValue({
          nextCheckInDue: '2026-06-14',
          checkInFrequency: 'weekly',
          startDate: '2026-01-01',
          timezone: 'UTC',
        })
        mockInsert({ data: { id: 'new-check-in-id' }, error: null })

        const { submitCheckIn } = await import('./check-in-service')
        await submitCheckIn('client-123', { weight: 180, weightUnit: 'lbs' })

        expect(advanceQuery.update).toHaveBeenCalledWith(
          expect.objectContaining({ next_check_in_due: '2026-06-21' }),
        )
        expect(advanceQuery.eq).toHaveBeenCalledWith('id', 'client-123')
      } finally {
        vi.useRealTimers()
      }
    })

    it('advances a fortnightly client by a fortnight, not a week', async () => {
      // The derivation this replaced ignored frequency entirely and handed
      // every client a weekly period.
      vi.useFakeTimers()
      try {
        vi.setSystemTime(new Date('2026-06-14T12:00:00Z'))
        getClientByIdMock.mockResolvedValue({
          nextCheckInDue: '2026-06-14',
          checkInFrequency: 'biweekly',
          startDate: '2026-01-01',
          timezone: 'UTC',
        })
        mockInsert({ data: { id: 'new-check-in-id' }, error: null })

        const { submitCheckIn } = await import('./check-in-service')
        await submitCheckIn('client-123', { weight: 180, weightUnit: 'lbs' })

        expect(advanceQuery.update).toHaveBeenCalledWith(
          expect.objectContaining({ next_check_in_due: '2026-06-28' }),
        )
      } finally {
        vi.useRealTimers()
      }
    })

    it('advances from the LIVE due date when the stored one has lapsed', async () => {
      // A client answering a check-in whose date lapsed weeks ago must advance
      // from the one they actually satisfied, not from a dead date — otherwise
      // the schedule stays permanently behind.
      vi.useFakeTimers()
      try {
        vi.setSystemTime(new Date('2026-06-16T12:00:00Z'))
        getClientByIdMock.mockResolvedValue({
          nextCheckInDue: '2026-05-24', // lapsed: rolls to 06-14
          checkInFrequency: 'weekly',
          startDate: '2026-01-01',
          timezone: 'UTC',
        })
        mockInsert({ data: { id: 'new-check-in-id' }, error: null })

        const { submitCheckIn } = await import('./check-in-service')
        await submitCheckIn('client-123', { weight: 180, weightUnit: 'lbs' })

        expect(advanceQuery.update).toHaveBeenCalledWith(
          expect.objectContaining({ next_check_in_due: '2026-06-21' }),
        )
      } finally {
        vi.useRealTimers()
      }
    })

    it('writes no schedule at all for a client who has none', async () => {
      getClientByIdMock.mockResolvedValue({ nextCheckInDue: null, startDate: '2026-01-01' })
      mockInsert({ data: { id: 'new-check-in-id' }, error: null })

      const { submitCheckIn } = await import('./check-in-service')
      await submitCheckIn('client-123', { weight: 180, weightUnit: 'lbs' })

      expect(advanceQuery.update).not.toHaveBeenCalled()
    })

    it('still returns the check-in when the advance fails, and says so', async () => {
      // The check-in is the client's work; the schedule is bookkeeping. A
      // failed advance leaves a visible, self-healing divergence (the lapse
      // roll moves them on within the grace window) rather than throwing away
      // a check-in the client just filled in.
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      getClientByIdMock.mockResolvedValue({
        nextCheckInDue: '2026-06-14',
        checkInFrequency: 'weekly',
        startDate: '2026-01-01',
      })
      mockInsert({ data: { id: 'new-check-in-id' }, error: null }, { error: { message: 'boom' } })

      const { submitCheckIn } = await import('./check-in-service')
      await expect(
        submitCheckIn('client-123', { weight: 180, weightUnit: 'lbs' }),
      ).resolves.toBe('new-check-in-id')
      expect(spy).toHaveBeenCalledWith(
        'Check-in submitted but the schedule did not advance:',
        'boom',
      )
      spy.mockRestore()
    })

    it("anchors the STORED period to the client's local today (London 23:30Z boundary)", async () => {
      // 23:30 UTC June 9 = 00:30 BST June 10. The persisted period_start/end
      // are read forever by coach-side derivations, so the window passed to
      // resolveCheckInWindow must be the client-local day. getTodayInTimezone
      // is real here (the partial date-helpers mock only replaces the two
      // window fns); the suite is pinned to TZ=UTC so a regression to the
      // server clock fails on any host.
      vi.useFakeTimers()
      try {
        vi.setSystemTime(new Date('2026-06-09T23:30:00Z'))
        getClientByIdMock.mockResolvedValue({
          nextCheckInDue: '2026-06-10', // a Wednesday
          startDate: '2026-01-01',
          timezone: 'Europe/London',
        })
        mockInsert({ data: { id: 'new-check-in-id' }, error: null })

        const { submitCheckIn } = await import('./check-in-service')
        await submitCheckIn('client-123', { weight: 180, weightUnit: 'lbs' })

        const todayArg = resolveCheckInWindowMock.mock.calls[0][0] as Date
        expect(todayArg.getDate()).toBe(10)
        expect(resolveCheckInWindowMock).toHaveBeenCalledWith(
          expect.any(Date),
          'wednesday',
          '2026-01-01',
        )
      } finally {
        vi.useRealTimers()
      }
    })

    it('DERIVES snapshot columns from the spine, not the form body', async () => {
      getEventsForDateRangeMock.mockResolvedValue([
        workout('2026-05-08', 'full'),
        workout('2026-05-09', 'full'),
        workout('2026-05-10', 'full'),
        workout('2026-05-11', 'full'),
        workout('2026-05-12', null),
      ])
      getNutritionPeriodMock.mockResolvedValue(nutritionPeriod({ onTarget: 5, targetedDays: 7, calorieAdherencePct: 71.4 }))
      getDailyLogsMock.mockResolvedValue([
        { date: '2026-05-08', mood: 4, energy: 8, sleep: 7, stress: 3, soreness: 6 },
        { date: '2026-05-09', mood: 2, energy: 6, sleep: 5, stress: 5, soreness: 2 },
      ])

      const q = mockInsert({ data: { id: 'ci' }, error: null })

      const { submitCheckIn } = await import('./check-in-service')
      // Form body carries bogus session/nutrition/mood values that MUST be ignored.
      await submitCheckIn('client-123', {
        mood: 99,
        energy: 99,
        sleep: 99,
        stress: 99,
        workoutsCompleted: 99,
        adherencePercentage: 99,
        nutritionAdherence: { daysOnTarget: 99 },
        notes: 'reflection',
      } as any)

      const inserted = q.insert.mock.calls[0][0]
      expect(inserted.workouts_completed).toBe(4) // from the week's workouts, not 99
      expect(inserted.nutrition_days_on_target).toBe(5) // from nutrition summary, not 99
      expect(inserted.adherence_percentage).toBe(71) // rounded, capped 0-100
      // Wellness averaged via calculateMetricAverages over the period rows.
      expect(inserted.mood).toBe(3) // round((4+2)/2)
      expect(inserted.energy).toBe(7) // round((8+6)/2)
      expect(inserted.sleep).toBe(6) // round((7+5)/2)
      expect(inserted.stress).toBe(4) // round((3+5)/2)
      expect(inserted.soreness).toBe(4) // round((6+2)/2)
      // The qualitative reflection is preserved.
      expect(inserted.notes).toBe('reflection')
      // Period persisted.
      expect(inserted.period_start).toBe('2026-05-08')
      expect(inserted.period_end).toBe('2026-05-14')
      // The ONE kernel run (Pin 1) and getDailyLogs (Pin 2), over the stored period.
      expect(getNutritionPeriodMock).toHaveBeenCalledWith('client-123', '2026-05-08', '2026-05-14')
      expect(getDailyLogsMock).toHaveBeenCalledWith('client-123', '2026-05-08', '2026-05-14')
    })

    // The stored column counts every workout the client LOGGED — a partial one
    // is a workout they did — and the frozen rows beside it keep each one's
    // quality, so the breakdown survives without a second count.
    it('counts a partly completed workout towards the stored figure', async () => {
      getEventsForDateRangeMock.mockResolvedValue([
        workout('2026-05-08', 'full'),
        workout('2026-05-09', 'partial'),
        workout('2026-05-10', 'partial'),
        workout('2026-05-11', null),
      ])
      const q = mockInsert({ data: { id: 'ci' }, error: null })

      const { submitCheckIn } = await import('./check-in-service')
      await submitCheckIn('client-123', {})

      expect(q.insert.mock.calls[0][0].workouts_completed).toBe(3)
    })

    it('stores a workout logged before the link existed as a full completion', async () => {
      // 227 such rows on dev: completed, with no log to have recorded a quality.
      getEventsForDateRangeMock.mockResolvedValue([
        { ...workout('2026-05-08', null), status: 'completed' },
      ])
      const q = mockInsert({ data: { id: 'ci' }, error: null })

      const { submitCheckIn } = await import('./check-in-service')
      await submitCheckIn('client-123', {})

      expect(q.insert.mock.calls[0][0].workouts_completed).toBe(1)
    })

    it('freezes the period snapshot in the INSERT, from the SAME kernel run as the columns', async () => {
      const period = nutritionPeriod({ onTarget: 5, targetedDays: 7, calorieAdherencePct: 71.4 })
      getNutritionPeriodMock.mockResolvedValue(period)
      const q = mockInsert({ data: { id: 'ci' }, error: null })

      const { submitCheckIn } = await import('./check-in-service')
      await submitCheckIn('client-123', {})

      const inserted = q.insert.mock.calls[0][0]
      // The frozen nutrition rows ARE the rows the count above was taken from.
      expect(inserted.period_snapshot.nutrition).toEqual(period.days)
      // The training schedule covers every day of the stored period.
      expect(inserted.period_snapshot.training).toHaveLength(7)
      expect(inserted.period_snapshot.training[0]).toMatchObject({ date: '2026-05-08', status: 'rest' })
      expect(typeof inserted.period_snapshot.generatedAt).toBe('string')
      expect(getEventsForDateRangeMock).toHaveBeenCalledWith('client-123', '2026-05-08', '2026-05-14')
    })

    it('stores NO on-target count when no day of the period had a target — a day with no target is in no ratio', async () => {
      getNutritionPeriodMock.mockResolvedValue(nutritionPeriod({ onTarget: 0, targetedDays: 0, calorieAdherencePct: null }))
      const q = mockInsert({ data: { id: 'ci' }, error: null })

      const { submitCheckIn } = await import('./check-in-service')
      await submitCheckIn('client-123', {})

      const inserted = q.insert.mock.calls[0][0]
      expect(inserted.nutrition_days_on_target).toBeUndefined()
      expect(inserted.adherence_percentage).toBeUndefined()
    })

    it('inserts NO soreness snapshot when the period logged none (decision C: no fabricated default)', async () => {
      getNutritionPeriodMock.mockResolvedValue(nutritionPeriod({ onTarget: 5, targetedDays: 7, calorieAdherencePct: 71.4 }))
      getDailyLogsMock.mockResolvedValue([
        { date: '2026-05-08', mood: 4, energy: 8, sleep: 7, stress: 3 },
      ])

      const q = mockInsert({ data: { id: 'ci' }, error: null })

      const { submitCheckIn } = await import('./check-in-service')
      await submitCheckIn('client-123', { notes: 'reflection' } as any)

      const inserted = q.insert.mock.calls[0][0]
      // Siblings keep their existing derivation/fallback semantics...
      expect(inserted.mood).toBe(4)
      // ...but soreness is never fabricated: undefined -> NULL snapshot, not 5.
      expect(inserted.soreness).toBeUndefined()
    })

    it('caps adherence_percentage at 100', async () => {
      getNutritionPeriodMock.mockResolvedValue(nutritionPeriod({ onTarget: 7, targetedDays: 7, calorieAdherencePct: 142 }))
      const q = mockInsert({ data: { id: 'ci' }, error: null })

      const { submitCheckIn } = await import('./check-in-service')
      await submitCheckIn('client-123', {})

      expect(q.insert.mock.calls[0][0].adherence_percentage).toBe(100)
    })

    it('writes only exercise highlights as related data (the session-completions writer is gone)', async () => {
      mockInsert({ data: { id: 'ci' }, error: null })

      const { submitCheckIn } = await import('./check-in-service')
      await submitCheckIn('client-123', {
        exerciseHighlights: [
          { exerciseName: 'Squat', highlightType: 'pr' },
        ],
      } as any)

      // No session-completions writer exists anymore — assert the highlights one
      // is the only related-data write.
      expect(insertExerciseHighlightsMock).toHaveBeenCalledTimes(1)
    })

    it('writes the custom answers against the new check-in id', async () => {
      mockInsert({ data: { id: 'ci' }, error: null })

      const { submitCheckIn } = await import('./check-in-service')
      await submitCheckIn('client-123', {
        customAnswers: [{ questionId: 'q-a', answer: 'yes' }],
      } as any)

      expect(insertCheckInAnswersMock).toHaveBeenCalledWith('ci', [
        { questionId: 'q-a', answer: 'yes' },
      ])
    })

    it('writes no answers when the form asks no questions', async () => {
      mockInsert({ data: { id: 'ci' }, error: null })

      const { submitCheckIn } = await import('./check-in-service')
      await submitCheckIn('client-123', { customAnswers: [] } as any)

      expect(insertCheckInAnswersMock).not.toHaveBeenCalled()
    })

    it('does NOT swallow an answers-insert failure — unlike the highlights writer', async () => {
      // The seam this documents (CONVENTIONS section 2 item 13): the check-in row
      // has already committed, so a throw here leaves it standing WITHOUT its
      // answers and the client's retry meets migration 156's period-unique
      // constraint. Surfacing it is still the right call — silently losing a
      // client's typed answers is worse than a visible failure.
      mockInsert({ data: { id: 'ci' }, error: null })
      insertCheckInAnswersMock.mockRejectedValueOnce(new Error('Failed to save your answers: boom'))

      const { submitCheckIn } = await import('./check-in-service')

      await expect(
        submitCheckIn('client-123', {
          customAnswers: [{ questionId: 'q-a', answer: 'yes' }],
        } as any),
      ).rejects.toThrow(/Failed to save your answers/)
    })

    it('still swallows an exercise-highlights failure, which is the deliberate asymmetry', async () => {
      mockInsert({ data: { id: 'ci' }, error: null })
      insertExerciseHighlightsMock.mockRejectedValueOnce(new Error('boom'))

      const { submitCheckIn } = await import('./check-in-service')

      await expect(
        submitCheckIn('client-123', {
          exerciseHighlights: [{ exerciseName: 'Squat', highlightType: 'pr' }],
        } as any),
      ).resolves.toBe('ci')
    })

    it('throws error when submission fails', async () => {
      mockInsert({ data: null, error: { message: 'Insert failed' } })

      const { submitCheckIn } = await import('./check-in-service')

      await expect(submitCheckIn('client-123', {})).rejects.toThrow(
        'Failed to submit check-in: Insert failed'
      )
    })
  })

  describe('getCheckInById', () => {
    it('returns check-in when found, reporting the readings its saved copy holds — one read, no log', async () => {
      const mockQuery = createMockQuery({
        data: {
          id: 'check-in-123',
          client_id: 'client-456',
          status: 'pending',
          mood: 4,
          energy: 7,
          // A stale column beside the copy: ignored, the copy is the report.
          weight: 999,
          // What it reported when it was sent — the form's bodyFatPercentage
          // lives under the copy's bodyFat key.
          sent_snapshot: sentCopy({ weight: 80.2, bodyFat: 18.3, waist: 81.4 }),
          created_at: '2024-01-15T00:00:00Z',
          updated_at: '2024-01-15T00:00:00Z',
        },
        error: null,
      })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const { getCheckInById } = await import('./check-in-service')
      const result = await getCheckInById('check-in-123')

      expect(result).not.toBeNull()
      expect(result?.id).toBe('check-in-123')
      expect(result?.clientId).toBe('client-456')
      expect(result?.mood).toBe(4)
      expect(result?.weight).toBe(80.2)
      expect(result?.bodyFatPercentage).toBe(18.3)
      expect(result?.waist).toBe(81.4)
      expect(result?.hips).toBeUndefined()
      expect(result?.sentSnapshot?.readings.weight).toBe(80.2)
      // The check_ins row is the only read: the measurement log is not asked.
      expect(vi.mocked(supabaseAdmin.from).mock.calls.map((call) => call[0])).toEqual(['check_ins'])
    })

    it('returns null when not found', async () => {
      const mockQuery = createMockQuery({
        data: null,
        error: { message: 'Not found' },
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const { getCheckInById } = await import('./check-in-service')
      const result = await getCheckInById('nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('getClientCheckIns', () => {
    it('returns paginated check-ins', async () => {
      const mockData = [
        {
          id: 'check-in-1',
          client_id: 'client-123',
          status: 'reviewed',
          created_at: '2024-01-15T00:00:00Z',
          updated_at: '2024-01-15T00:00:00Z',
        },
        {
          id: 'check-in-2',
          client_id: 'client-123',
          status: 'pending',
          sent_snapshot: sentCopy({ weight: 79.1 }),
          created_at: '2024-01-08T00:00:00Z',
          updated_at: '2024-01-08T00:00:00Z',
        },
      ]

      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        then: (resolve: (value: unknown) => void) =>
          Promise.resolve({ data: mockData, error: null, count: 10 }).then(resolve),
      }

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const { getClientCheckIns } = await import('./check-in-service')
      const result = await getClientCheckIns('client-123', { limit: 10, offset: 0 })

      expect(result.checkIns).toHaveLength(2)
      expect(result.total).toBe(10)
      expect(result.checkIns[0].id).toBe('check-in-1')
      // Each row reports its own saved copy: none on the first, 79.1 on the
      // second — and the page costs one read, never a log read per page.
      expect(vi.mocked(supabaseAdmin.from).mock.calls.map((call) => call[0])).toEqual(['check_ins'])
      expect(result.checkIns[0].weight).toBeUndefined()
      expect(result.checkIns[1].weight).toBe(79.1)
    })

    it('filters by status when provided', async () => {
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: (resolve: (value: unknown) => void) =>
          Promise.resolve({ data: [], error: null, count: 0 }).then(resolve),
      }

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const { getClientCheckIns } = await import('./check-in-service')
      await getClientCheckIns('client-123', { status: 'pending' })

      // eq should be called twice - once for client_id, once for status
      expect(mockQuery.eq).toHaveBeenCalledTimes(2)
    })

    it('keyset first page (no cursor) fetches limit+1 and returns a nextCursor when more exist', async () => {
      // 3 rows returned for limit 2 → a further page exists.
      const rows = [
        { id: '11111111-1111-4111-8111-111111111111', client_id: 'c', status: 'reviewed', created_at: '2024-01-15T00:00:00Z', updated_at: '2024-01-15T00:00:00Z' },
        { id: '22222222-2222-4222-8222-222222222222', client_id: 'c', status: 'reviewed', created_at: '2024-01-08T00:00:00Z', updated_at: '2024-01-08T00:00:00Z' },
        { id: '33333333-3333-4333-8333-333333333333', client_id: 'c', status: 'reviewed', created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' },
      ]
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: (resolve: (value: unknown) => void) =>
          Promise.resolve({ data: rows, error: null }).then(resolve),
      }
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const { getClientCheckIns } = await import('./check-in-service')
      const result = await getClientCheckIns('c', { limit: 2, keyset: true })

      expect(mockQuery.or).not.toHaveBeenCalled() // first page has no predicate
      expect(mockQuery.limit).toHaveBeenCalledWith(3) // limit + 1
      // A keyset page pays for no count unless a caller opts in.
      expect(mockQuery.select).toHaveBeenCalledWith('*', undefined)
      expect(result.checkIns).toHaveLength(2) // extra row trimmed
      expect(result.checkIns.map((c) => c.id)).toEqual([
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ])
      // nextCursor points at the last RETURNED row, not the peeked extra.
      expect(result.nextCursor).toEqual({
        createdAt: '2024-01-08T00:00:00Z',
        id: '22222222-2222-4222-8222-222222222222',
      })
    })

    it('keyset follow-up applies the (created_at,id) predicate and ends with nextCursor null', async () => {
      const rows = [
        { id: '44444444-4444-4444-8444-444444444444', client_id: 'c', status: 'reviewed', created_at: '2023-12-25T00:00:00Z', updated_at: '2023-12-25T00:00:00Z' },
      ]
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: (resolve: (value: unknown) => void) =>
          Promise.resolve({ data: rows, error: null }).then(resolve),
      }
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const { getClientCheckIns } = await import('./check-in-service')
      const cursor = { createdAt: '2024-01-01T00:00:00Z', id: '33333333-3333-4333-8333-333333333333' }
      const result = await getClientCheckIns('c', { limit: 2, cursor })

      // Exact .or string: created_at < cursor OR (created_at = cursor AND id < cursor.id)
      expect(mockQuery.or).toHaveBeenCalledWith(
        'created_at.lt.2024-01-01T00:00:00Z,and(created_at.eq.2024-01-01T00:00:00Z,id.lt.33333333-3333-4333-8333-333333333333)'
      )
      expect(result.checkIns).toHaveLength(1)
      expect(result.nextCursor).toBeNull() // fewer than limit+1 rows → no further page
    })

    it('pages across a created_at tie, splitting by id with no overlap (simulated DB ordering)', async () => {
      const { getClientCheckIns } = await import('./check-in-service')

      // Page 1: two rows sharing the same created_at, newest id first (limit 2, peek 1 extra).
      const page1 = [
        { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', client_id: 'c', status: 'reviewed', created_at: '2024-02-01T10:00:00Z', updated_at: '2024-02-01T10:00:00Z' },
        { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', client_id: 'c', status: 'reviewed', created_at: '2024-02-01T10:00:00Z', updated_at: '2024-02-01T10:00:00Z' },
        { id: '99999999-9999-4999-8999-999999999999', client_id: 'c', status: 'reviewed', created_at: '2024-02-01T10:00:00Z', updated_at: '2024-02-01T10:00:00Z' },
      ]
      const q1 = {
        select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
        then: (r: (v: unknown) => void) => Promise.resolve({ data: page1, error: null }).then(r),
      }
      vi.mocked(supabaseAdmin.from).mockReturnValue(q1 as any)
      const r1 = await getClientCheckIns('c', { limit: 2, keyset: true })
      expect(r1.checkIns.map((c) => c.id)).toEqual([
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ])
      expect(r1.nextCursor).toEqual({ createdAt: '2024-02-01T10:00:00Z', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })

      // Page 2 with that cursor: the id-tiebreak predicate excludes the page-1 ids.
      const page2 = [
        { id: '99999999-9999-4999-8999-999999999999', client_id: 'c', status: 'reviewed', created_at: '2024-02-01T10:00:00Z', updated_at: '2024-02-01T10:00:00Z' },
      ]
      const q2 = {
        select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
        then: (r: (v: unknown) => void) => Promise.resolve({ data: page2, error: null }).then(r),
      }
      vi.mocked(supabaseAdmin.from).mockReturnValue(q2 as any)
      const r2 = await getClientCheckIns('c', { limit: 2, cursor: r1.nextCursor! })

      expect(q2.or).toHaveBeenCalledWith(
        'created_at.lt.2024-02-01T10:00:00Z,and(created_at.eq.2024-02-01T10:00:00Z,id.lt.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa)'
      )
      // No overlap with page 1.
      const page1Ids = new Set(r1.checkIns.map((c) => c.id))
      expect(r2.checkIns.some((c) => page1Ids.has(c.id))).toBe(false)
      expect(r2.checkIns.map((c) => c.id)).toEqual(['99999999-9999-4999-8999-999999999999'])
    })

    it('takes an exact count alongside a keyset page when withTotal is set', async () => {
      // The coach list asks for this on its FIRST page only, because the
      // Check-ins tab's rail renders the history count.
      const rows = [
        { id: '55555555-5555-4555-8555-555555555555', client_id: 'c', status: 'reviewed', created_at: '2024-03-01T00:00:00Z', updated_at: '2024-03-01T00:00:00Z' },
        { id: '66666666-6666-4666-8666-666666666666', client_id: 'c', status: 'reviewed', created_at: '2024-02-01T00:00:00Z', updated_at: '2024-02-01T00:00:00Z' },
        { id: '77777777-7777-4777-8777-777777777777', client_id: 'c', status: 'reviewed', created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' },
      ]
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: (resolve: (value: unknown) => void) =>
          Promise.resolve({ data: rows, error: null, count: 22 }).then(resolve),
      }
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const { getClientCheckIns } = await import('./check-in-service')
      const result = await getClientCheckIns('c', { limit: 2, keyset: true, withTotal: true })

      expect(mockQuery.select).toHaveBeenCalledWith('*', { count: 'exact' })
      expect(result.total).toBe(22)
      // Still a keyset page: trimmed to the limit, with a cursor onward.
      expect(result.checkIns).toHaveLength(2)
      expect(result.nextCursor).toEqual({
        createdAt: '2024-02-01T00:00:00Z',
        id: '66666666-6666-4666-8666-666666666666',
      })
    })
  })

  describe('getPreviousCheckIn', () => {
    it("reports the previous check-in's readings from its own saved copy", async () => {
      const current = { id: 'ci-2', client_id: 'client-456', status: 'pending', sent_snapshot: sentCopy({ weight: 80.7 }), created_at: '2024-01-15T00:00:00Z', updated_at: '2024-01-15T00:00:00Z' }
      const previous = { id: 'ci-1', client_id: 'client-456', status: 'reviewed', sent_snapshot: sentCopy({ weight: 81.6 }), created_at: '2024-01-08T00:00:00Z', updated_at: '2024-01-08T00:00:00Z' }
      const mockQuery = createMockQuery({ data: current, error: null })
      mockQuery.single
        .mockResolvedValueOnce({ data: current, error: null })
        .mockResolvedValueOnce({ data: previous, error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never)

      const { getPreviousCheckIn } = await import('./check-in-service')
      const result = await getPreviousCheckIn('client-456', 'ci-2')

      expect(mockQuery.lt).toHaveBeenCalledWith('created_at', '2024-01-15T00:00:00Z')
      expect(result?.id).toBe('ci-1')
      expect(result?.weight).toBe(81.6)
    })
  })

  describe('updateCheckInAISummary', () => {
    const review = {
      summary: 'Great progress!',
      watchItems: [{ type: 'win' as const, text: 'Slept well all week' }],
      themes: ['sleep', 'consistency'],
      coachActions: [{ priority: 'high' as const, text: 'Keep it up' }],
      clientMessage: 'Draft message',
    }

    // The conditional promotion ends in .select('id') (the rows it matched);
    // the reviewed-row fallback ends in .eq('id', …) and is awaited via `then`.
    function makeChain(promoted: unknown[]) {
      const q = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue({ data: promoted, error: null }),
        then: (resolve: (v: unknown) => void) =>
          Promise.resolve({ data: null, error: null }).then(resolve),
      }
      vi.mocked(supabaseAdmin.from).mockReturnValue(q as any)
      return q
    }

    it('promotes an unreviewed check-in to ai_processed in one conditional update', async () => {
      const q = makeChain([{ id: 'check-in-123' }])
      const { updateCheckInAISummary } = await import('./check-in-service')

      await updateCheckInAISummary('check-in-123', review)

      expect(q.update).toHaveBeenCalledTimes(1)
      const updateCall = q.update.mock.calls[0][0]
      expect(updateCall.ai_summary).toBe('Great progress!')
      expect(updateCall.ai_response_draft).toBe('Draft message')
      expect(updateCall.ai_insights._version).toBe(3)
      expect(updateCall.status).toBe('ai_processed')
      expect(q.eq).toHaveBeenCalledWith('id', 'check-in-123')
      expect(q.in).toHaveBeenCalledWith('status', ['pending', 'ai_processed'])
    })

    it('refreshes the review on a reviewed check-in and leaves its status alone (D0.2)', async () => {
      const q = makeChain([])
      const { updateCheckInAISummary } = await import('./check-in-service')

      await updateCheckInAISummary('check-in-123', review)

      expect(q.update).toHaveBeenCalledTimes(2)
      const fallback = q.update.mock.calls[1][0]
      expect(fallback).not.toHaveProperty('status')
      expect(fallback.ai_summary).toBe('Great progress!')
      expect(fallback.ai_insights._version).toBe(3)
      expect(fallback.ai_processed_at).toEqual(expect.any(String))
      expect(q.eq).toHaveBeenLastCalledWith('id', 'check-in-123')
    })

    it('throws when the update fails, without attempting the fallback', async () => {
      const q = makeChain([])
      q.select.mockResolvedValue({ data: null, error: { message: 'boom' } })
      const { updateCheckInAISummary } = await import('./check-in-service')

      await expect(updateCheckInAISummary('check-in-123', review)).rejects.toThrow(
        'Failed to update AI summary: boom'
      )
      expect(q.update).toHaveBeenCalledTimes(1)
    })
  })

  describe('updateCheckInResponse', () => {
    it('updates coach response and sets reviewed status', async () => {
      const mockQuery = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: {}, error: null }),
      }

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const { updateCheckInResponse } = await import('./check-in-service')

      await updateCheckInResponse('check-in-123', 'Great work this week!')

      const updateCall = mockQuery.update.mock.calls[0][0]
      expect(updateCall.coach_response).toBe('Great work this week!')
      expect(updateCall.status).toBe('reviewed')
      expect(updateCall.coach_reviewed_at).toBeDefined()
    })
  })
})

describe('getClientCheckIns — the upTo bound (commit 8b)', () => {
  const AT = '2026-05-31T12:00:00+00:00'

  function boundedQuery() {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => void) =>
        Promise.resolve({ data: [], error: null, count: 0 }).then(resolve),
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('bounds the offset path to created_at <= upTo — the review\'s trend is the check-ins up to the one under review', async () => {
    const q = boundedQuery()
    vi.mocked(supabaseAdmin.from).mockReturnValue(q as never)

    const { getClientCheckIns } = await import('./check-in-service')
    await getClientCheckIns('c', { limit: 10, upTo: AT })

    expect(q.lte).toHaveBeenCalledWith('created_at', AT)
    expect(q.limit).toHaveBeenCalledWith(10)
    expect(q.or).not.toHaveBeenCalled()
  })

  it('bounds the keyset path the same way, beside the cursor predicate', async () => {
    const q = boundedQuery()
    vi.mocked(supabaseAdmin.from).mockReturnValue(q as never)

    const { getClientCheckIns } = await import('./check-in-service')
    await getClientCheckIns('c', { limit: 2, keyset: true, upTo: AT })

    expect(q.lte).toHaveBeenCalledWith('created_at', AT)
    expect(q.limit).toHaveBeenCalledWith(3)
  })

  it('applies no bound when none is asked for', async () => {
    const q = boundedQuery()
    vi.mocked(supabaseAdmin.from).mockReturnValue(q as never)

    const { getClientCheckIns } = await import('./check-in-service')
    await getClientCheckIns('c', { limit: 10 })

    expect(q.lte).not.toHaveBeenCalled()
  })
})
