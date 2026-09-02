import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the supabase-admin module
vi.mock('./supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

vi.mock('./measurements-service', async (importOriginal) => {
  // The error class and the embed string stay real — updateClient throws the
  // one and every single-client read selects the other — and only the writer
  // is a stub.
  const actual = await importOriginal<typeof import('./measurements-service')>()
  return {
    ...actual,
    appendMeasurements: vi.fn().mockResolvedValue({
      rows: {},
      inserted: [],
      unchanged: [],
      energy: 'nothing_inserted',
    }),
  }
})

// Two different days on purpose, so a test can tell WHOSE calendar dated a row.
vi.mock('./today-service', () => ({
  getCoachTodayString: vi.fn().mockResolvedValue('2026-09-02'),
  getClientTodayString: vi.fn().mockResolvedValue('2026-09-01'),
}))

vi.mock('./client-start-service', () => ({
  recordClientStart: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./client-energy-service', () => ({
  recalculateClientEnergy: vi
    .fn()
    .mockResolvedValue({ status: 'written', bmr: 1800, tdee: 2160 }),
}))

vi.mock('./client-goals-service', () => ({
  updateGoals: vi.fn().mockResolvedValue({}),
}))

vi.mock('./client-intake-service', () => ({
  createIntake: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./invitation-service', () => ({
  sendInvitation: vi.fn().mockResolvedValue({ success: true }),
}))

import { supabaseAdmin } from './supabase-admin'
import { recalculateClientEnergy } from './client-energy-service'
import { appendMeasurements, ReadingRemovalUnavailableError } from './measurements-service'
import { recordClientStart } from './client-start-service'
import { getCoachTodayString, getClientTodayString } from './today-service'
import { updateGoals } from './client-goals-service'
import type { MeasurementReading } from '@/lib/measurements/day-values'
import {
  createClient,
  getClientsForCoach,
  getClientById,
  updateClient,
  deleteClient,
  updateClientCheckInConfig,
  updateClientSettings,
} from './client-service'

// Helper to create a chainable mock query
function createMockQuery(result: { data: unknown; error: unknown; count?: number }) {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: typeof result) => void) => Promise.resolve(result).then(resolve),
  }

  return mockQuery
}

// Mock client database row
function createMockClientRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'client-123',
    coach_id: 'coach-456',
    name: 'Test Client',
    email: 'test@example.com',
    avatar_url: null,
    notes: null,
    active: true,
    height: 72,
    gender: 'male',
    date_of_birth: '1990-01-01',
    goal_weight: 170,
    goal_body_fat_percentage: 12,
    bmr: 1800,
    tdee: 2400,
    check_in_frequency: 'weekly',
    check_in_frequency_days: 7,
    next_check_in_due: '2026-06-08',
    last_reminder_sent_at: null,
    reminder_preferences: null,
    total_check_ins_expected: 10,
    total_check_ins_completed: 8,
    check_in_adherence_rate: 80,
    current_streak: 3,
    longest_streak: 5,
    unit_preference: 'imperial',
    work_activity_level: 'moderate',
    training_volume_hours: '5-7',
    protein_target_g_per_kg: 2.0,
    diet_type: 'balanced',
    goal_deadline: null,
    nutrition_plan_created_date: null,
    nutrition_plan_base_weight_kg: null,
    baseline_calories: 2000,
    start_date: null,
    calorie_target: 2200,
    protein_target_g: 180,
    carb_target_g: 220,
    fat_target_g: 70,
    custom_macros_enabled: false,
    custom_protein_g: null,
    custom_carb_g: null,
    custom_fat_g: null,
    custom_calories: null,
    bmr_manual_override: null,
    tdee_manual_override: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-15T00:00:00Z',
    // The two measurement views embedded beside every single-client read —
    // "now" and "at the start", one row per metric. The four reading fields on
    // a Client come from here and from nowhere else.
    client_current_measurements: [
      { metric_key: 'weight', value: 180, recorded_on: '2026-08-30', source: 'check_in', measurement_id: 'm-now-w' },
      { metric_key: 'bodyFat', value: 15, recorded_on: '2026-08-30', source: 'check_in', measurement_id: 'm-now-bf' },
    ],
    client_baseline_measurements: [
      { metric_key: 'weight', value: 185, recorded_on: '2026-01-01', source: 'intake', measurement_id: 'm-start-w' },
      { metric_key: 'bodyFat', value: 18, recorded_on: '2026-01-01', source: 'intake', measurement_id: 'm-start-bf' },
    ],
    ...overrides,
  }
}

/** The row the measurement log reports standing for a key after an append. */
function reading(metricKey: 'weight' | 'bodyFat', value: number): MeasurementReading {
  return {
    id: `m-${metricKey}`,
    metricKey,
    value,
    date: '2026-09-02',
    recordedAt: '2026-09-02T09:00:00.000Z',
    measuredAt: null,
    source: 'intake',
    sourceId: null,
    note: null,
  }
}

describe('Client Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createClient', () => {
    it('creates a new client successfully', async () => {
      const mockClientRow = createMockClientRow()
      const mockQuery = createMockQuery({
        data: mockClientRow,
        error: null,
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const result = await createClient('coach-456', {
        name: 'Test Client',
        email: 'test@example.com',
        currentWeight: 180,
        goalWeight: 170,
      } as any)

      expect(result.id).toBe('client-123')
      expect(result.name).toBe('Test Client')
      expect(result.email).toBe('test@example.com')
      expect(result.coachId).toBe('coach-456')
      expect(supabaseAdmin.from).toHaveBeenCalledWith('clients')
    })

    it('stores the birth date it was given', async () => {
      // It was accepted by the schema and consumed by computeEnergyPair, then
      // dropped — so a manually-added client's BMR was age-correct while their
      // profile showed no age, and the next recalculation fell back to the
      // assumed 30 and produced a different number.
      const mockQuery = createMockQuery({ data: createMockClientRow(), error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await createClient('coach-456', {
        name: 'Test Client',
        email: 'test@example.com',
        dateOfBirth: '1991-06-08',
      } as any)

      const inserted = mockQuery.insert.mock.calls[0][0]
      expect(inserted.date_of_birth).toBe('1991-06-08')
    })

    it('writes a null birth date rather than omitting the column', async () => {
      const mockQuery = createMockQuery({ data: createMockClientRow(), error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await createClient('coach-456', {
        name: 'Test Client',
        email: 'test@example.com',
      } as any)

      expect(mockQuery.insert.mock.calls[0][0]).toHaveProperty('date_of_birth', null)
    })

    it('throws error for duplicate email', async () => {
      const mockQuery = createMockQuery({
        data: null,
        error: { code: '23505', message: 'Duplicate key' },
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await expect(
        createClient('coach-456', {
          name: 'Test Client',
          email: 'duplicate@example.com',
        } as any)
      ).rejects.toThrow('A client with this email already exists')
    })

    it('throws generic error for other database errors', async () => {
      const mockQuery = createMockQuery({
        data: null,
        error: { code: '42000', message: 'Unknown error' },
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await expect(
        createClient('coach-456', {
          name: 'Test Client',
          email: 'test@example.com',
        } as any)
      ).rejects.toThrow('Failed to create client')
    })

    it('writes no weight column — the first reading is an intake row in the measurement log', async () => {
      const mockQuery = createMockQuery({ data: createMockClientRow(), error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never)

      await createClient('coach-456', {
        name: 'Test Client',
        email: 'test@example.com',
        currentWeight: 180,
        currentBodyFatPercentage: 15,
      })

      const insertCall = mockQuery.insert.mock.calls[0][0]
      expect(insertCall).not.toHaveProperty('current_weight')
      expect(insertCall).not.toHaveProperty('starting_weight')
      expect(insertCall).not.toHaveProperty('current_body_fat_percentage')
      expect(insertCall).not.toHaveProperty('starting_body_fat_percentage')
      // "Now" and "at the start" are both derived from this one row, dated the
      // day the coach captured it — on the COACH's calendar, they are the setter.
      expect(getCoachTodayString).toHaveBeenCalledWith('coach-456')
      expect(appendMeasurements).toHaveBeenCalledWith({
        clientId: 'client-123',
        source: 'intake',
        recordedOn: '2026-09-02',
        values: { weight: 180, bodyFat: 15 },
      })
    })

    // The service no longer converts. It used to key on a `weightUnit` /
    // `heightUnit` tag riding on the payload; those tags are gone from
    // createClientSchema, and the add-client form converts from the coach's own
    // display units before submitting (hooks/use-unit-inputs.ts). A service that
    // still converted would double-convert everything that form sends.
    it('stores the payload verbatim — it is already canonical kg/cm', async () => {
      const mockQuery = createMockQuery({ data: createMockClientRow(), error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await createClient('coach-456', {
        name: 'Test Client',
        email: 'test@example.com',
        currentWeight: 81.6466,
        goalWeight: 77.1107,
        height: 180.34,
      } as any)

      const insertCall = mockQuery.insert.mock.calls[0][0]
      expect(insertCall.height).toBe(180.34)
      // The weight is verbatim too, at the writer it actually reaches: the
      // measurement log, never a column.
      expect(appendMeasurements).toHaveBeenCalledWith(
        expect.objectContaining({ values: expect.objectContaining({ weight: 81.6466 }) })
      )
      // The goal weight is verbatim too, but it no longer travels in the INSERT:
      // `updateGoals` is the single writer of both goal stores, so this asserts
      // no-conversion at the writer it actually reaches.
      expect(vi.mocked(updateGoals)).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ goalWeight: 77.1107 }),
        'coach-456'
      )
    })

    // Regression guard for the double-conversion this batch could reintroduce:
    // a pounds-magnitude number must land in storage unchanged, not scaled.
    it('does not scale a large weight, whatever it looks like', async () => {
      const mockQuery = createMockQuery({ data: createMockClientRow(), error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await createClient('coach-456', {
        name: 'Test Client',
        email: 'test@example.com',
        currentWeight: 180,
        height: 71,
      } as any)

      const insertCall = mockQuery.insert.mock.calls[0][0]
      expect(insertCall.height).toBe(71)
      expect(appendMeasurements).toHaveBeenCalledWith(
        expect.objectContaining({ values: expect.objectContaining({ weight: 180 }) })
      )
    })

    it('reports the reading it just recorded on the returned client', async () => {
      // The INSERT's returned row carries no embeds, so without the overlay the
      // response reports a client with no reading a moment after recording one.
      const mockQuery = createMockQuery({
        data: createMockClientRow({ client_current_measurements: [], client_baseline_measurements: [] }),
        error: null,
      })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never)
      vi.mocked(appendMeasurements).mockResolvedValueOnce({
        rows: { weight: reading('weight', 81.6466) },
        inserted: ['weight'],
        unchanged: [],
        energy: 'recomputed',
      })

      const client = await createClient('coach-456', {
        name: 'Test Client',
        email: 'test@example.com',
        currentWeight: 81.6466,
      })

      expect(client.currentWeight).toBe(81.6466)
      expect(client.currentBodyFatPercentage).toBeUndefined()
    })

    it('records no reading when neither a weight nor a body fat was given', async () => {
      const mockQuery = createMockQuery({ data: createMockClientRow(), error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never)

      await createClient('coach-456', {
        name: 'Test Client',
        email: 'test@example.com',
        setupMode: 'intake',
      })

      expect(appendMeasurements).not.toHaveBeenCalled()
    })

    it('dual-writes goals when goalWeight provided', async () => {
      const mockClientRow = createMockClientRow()
      const mockQuery = createMockQuery({ data: mockClientRow, error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await createClient('coach-456', {
        name: 'Test Client',
        email: 'test@example.com',
        goalWeight: 77.1107,
      } as any)

      // client_goals.goal_weight is canonical kg, same as clients.goal_weight.
      expect(updateGoals).toHaveBeenCalledWith(
        'client-123',
        expect.objectContaining({ goalWeight: 77.1107 }),
        'coach-456'
      )
    })

    // The swallow went with the store it fed. A client whose first reading
    // never landed is one activation refuses, and a swallowed failure here is
    // how a profile came to claim a reading no row carried.
    it('a failed reading write fails the creation rather than reporting a client with no reading', async () => {
      const mockQuery = createMockQuery({ data: createMockClientRow(), error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never)
      vi.mocked(appendMeasurements).mockRejectedValueOnce(
        new Error('Failed to record measurements: boom')
      )

      await expect(
        createClient('coach-456', {
          name: 'Test Client',
          email: 'test@example.com',
          currentWeight: 180,
        })
      ).rejects.toThrow('Failed to record measurements: boom')
    })

    // Task 0b.2 — `updateGoals` is the sole writer of both goal stores.
    it('writes no goal column in the INSERT', async () => {
      const mockQuery = createMockQuery({ data: createMockClientRow(), error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await createClient('coach-456', {
        name: 'Test Client',
        email: 'test@example.com',
        goalWeight: 77,
        goalBodyFatPercentage: 15,
      } as any)

      const insertCall = mockQuery.insert.mock.calls[0][0]
      expect(insertCall).not.toHaveProperty('goal_weight')
      expect(insertCall).not.toHaveProperty('goal_body_fat_percentage')
    })

    // The swallow that let a client's two goal stores disagree for six weeks.
    it('a failed goal write fails the creation rather than reporting success', async () => {
      const mockQuery = createMockQuery({ data: createMockClientRow(), error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)
      vi.mocked(updateGoals).mockRejectedValueOnce(new Error('goal insert failed'))

      await expect(
        createClient('coach-456', {
          name: 'Test Client',
          email: 'test@example.com',
          goalWeight: 77,
        } as any)
      ).rejects.toThrow('goal insert failed')
    })

    // The INSERT no longer returns the goal columns, so without the overlay a
    // successful creation reports a client with no goal.
    it('echoes the goal it just wrote back to the caller', async () => {
      const mockQuery = createMockQuery({ data: createMockClientRow(), error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const client = await createClient('coach-456', {
        name: 'Test Client',
        email: 'test@example.com',
        goalWeight: 77,
        goalBodyFatPercentage: 15,
      } as any)

      expect(client.goalWeight).toBe(77)
      expect(client.goalBodyFatPercentage).toBe(15)
    })
  })

  describe('getClientsForCoach', () => {
    it('returns clients with engagement levels', async () => {
      const recentCheckIn = new Date()
      recentCheckIn.setDate(recentCheckIn.getDate() - 3)

      const mockClients = [
        createMockClientRow({
          id: 'client-1',
          name: 'Active Client',
          check_ins: [{ created_at: recentCheckIn.toISOString() }],
        }),
        createMockClientRow({
          id: 'client-2',
          name: 'Inactive Client',
          check_ins: [],
        }),
      ]

      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: (resolve: (value: unknown) => void) =>
          Promise.resolve({ data: mockClients, error: null }).then(resolve),
      }

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const result = await getClientsForCoach('coach-456')

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('Active Client')
      expect(result[0].engagement).toBe('high') // Checked in within 7 days
      expect(result[1].engagement).toBe('low') // No check-ins
    })

    it('returns empty array when no clients', async () => {
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: (resolve: (value: unknown) => void) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      }

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const result = await getClientsForCoach('coach-456')

      expect(result).toEqual([])
    })

    it('throws error on database failure', async () => {
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: (resolve: (value: unknown) => void) =>
          Promise.resolve({ data: null, error: { message: 'Query failed' } }).then(resolve),
      }

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await expect(getClientsForCoach('coach-456')).rejects.toThrow(
        'Failed to fetch clients'
      )
    })

    it('calculates engagement based on last check-in date', async () => {
      const highEngagementDate = new Date()
      highEngagementDate.setDate(highEngagementDate.getDate() - 5) // 5 days ago = high

      const mediumEngagementDate = new Date()
      mediumEngagementDate.setDate(mediumEngagementDate.getDate() - 10) // 10 days ago = medium

      const lowEngagementDate = new Date()
      lowEngagementDate.setDate(lowEngagementDate.getDate() - 20) // 20 days ago = low

      const mockClients = [
        createMockClientRow({
          id: 'client-1',
          name: 'High Engagement',
          check_ins: [{ created_at: highEngagementDate.toISOString() }],
        }),
        createMockClientRow({
          id: 'client-2',
          name: 'Medium Engagement',
          check_ins: [{ created_at: mediumEngagementDate.toISOString() }],
        }),
        createMockClientRow({
          id: 'client-3',
          name: 'Low Engagement',
          check_ins: [{ created_at: lowEngagementDate.toISOString() }],
        }),
      ]

      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: (resolve: (value: unknown) => void) =>
          Promise.resolve({ data: mockClients, error: null }).then(resolve),
      }

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const result = await getClientsForCoach('coach-456')

      expect(result[0].engagement).toBe('high')
      expect(result[1].engagement).toBe('medium')
      expect(result[2].engagement).toBe('low')
    })
  })

  describe('getClientById', () => {
    it('returns client when found, with the four reading fields from the embedded views', async () => {
      // A stale column beside the embeds: the columns are ignored, the views win.
      const mockClientRow = createMockClientRow({ current_weight: 999, starting_weight: 999 })
      const mockQuery = createMockQuery({
        data: mockClientRow,
        error: null,
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never)

      const result = await getClientById('client-123')

      expect(result).not.toBeNull()
      expect(result?.id).toBe('client-123')
      expect(result?.name).toBe('Test Client')
      // The views ride along in the same round trip as the row.
      expect(mockQuery.select).toHaveBeenCalledWith(
        expect.stringContaining('client_current_measurements(')
      )
      expect(mockQuery.select).toHaveBeenCalledWith(
        expect.stringContaining('client_baseline_measurements(')
      )
      expect(result?.currentWeight).toBe(180)
      expect(result?.currentBodyFatPercentage).toBe(15)
      expect(result?.startingWeight).toBe(185)
      expect(result?.startingBodyFatPercentage).toBe(18)
    })

    it('maps a client with no reading yet to undefined, not zero', async () => {
      const mockQuery = createMockQuery({
        data: createMockClientRow({ client_current_measurements: [], client_baseline_measurements: [] }),
        error: null,
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never)

      const result = await getClientById('client-123')

      expect(result?.currentWeight).toBeUndefined()
      expect(result?.currentBodyFatPercentage).toBeUndefined()
      expect(result?.startingWeight).toBeUndefined()
      expect(result?.startingBodyFatPercentage).toBeUndefined()
    })

    it('returns null when not found', async () => {
      const mockQuery = createMockQuery({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const result = await getClientById('nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('updateClient', () => {
    it('updates client successfully', async () => {
      const mockClientRow = createMockClientRow({ name: 'Updated Name' })
      const mockQuery = createMockQuery({
        data: mockClientRow,
        error: null,
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const result = await updateClient('client-123', {
        name: 'Updated Name',
      })

      expect(result.name).toBe('Updated Name')
      expect(mockQuery.update).toHaveBeenCalled()
      expect(mockQuery.eq).toHaveBeenCalledWith('id', 'client-123')
    })

    it('only updates provided fields', async () => {
      const mockClientRow = createMockClientRow()
      const mockQuery = createMockQuery({
        data: mockClientRow,
        error: null,
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await updateClient('client-123', {
        name: 'New Name',
        // email not provided, should not be updated
      })

      const updateCall = mockQuery.update.mock.calls[0][0]
      expect(updateCall.name).toBe('New Name')
      expect(updateCall.email).toBeUndefined()
      expect(updateCall.updated_at).toBeDefined()
    })

    it('recomputes energy when the activity level changes', async () => {
      const mockQuery = createMockQuery({ data: createMockClientRow(), error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await updateClient('client-123', { workActivityLevel: 'very_active' })

      expect(recalculateClientEnergy).toHaveBeenCalledWith('client-123', {
        coachId: undefined,
      })
      expect(mockQuery.update.mock.calls[0][0].work_activity_level).toBe('very_active')
    })

    it('does not recompute energy for a name-only update', async () => {
      const mockQuery = createMockQuery({ data: createMockClientRow(), error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await updateClient('client-123', { name: 'New Name' })

      expect(recalculateClientEnergy).not.toHaveBeenCalled()
    })

    it('delegates the start DATE to its single writer and dates the baseline readings on it', async () => {
      // The origin is one column with one writer, and it is a date and nothing
      // more. What the client measured at the start is not stored beside it:
      // the Baseline fields become a coach entry dated ON the start date, which
      // the derived baseline (the reading as of that date) then reads.
      const mockQuery = createMockQuery({ data: createMockClientRow(), error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never)

      await updateClient('client-123', {
        startDate: '2026-08-14',
        startingWeight: 84,
        startingBodyFatPercentage: 21,
      }, 'coach-1')

      const updateCall = mockQuery.update.mock.calls[0][0]
      expect(updateCall).not.toHaveProperty('starting_weight')
      expect(updateCall).not.toHaveProperty('starting_body_fat_percentage')
      expect(updateCall).not.toHaveProperty('start_date')
      // Correcting a recorded baseline is not a new measurement: the current
      // values are a separate field the coach edits on its own.
      expect(updateCall).not.toHaveProperty('current_weight')

      expect(recordClientStart).toHaveBeenCalledWith('client-123', { startsOn: '2026-08-14' })
      expect(appendMeasurements).toHaveBeenCalledWith({
        clientId: 'client-123',
        source: 'coach_entry',
        recordedOn: '2026-08-14',
        values: { weight: 84, bodyFat: 21 },
        createdBy: 'coach-1',
      })
    })

    it('dates a baseline reading on the STORED start date when the PATCH carries none', async () => {
      const mockQuery = createMockQuery({
        data: createMockClientRow({ start_date: '2026-03-01' }),
        error: null,
      })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never)

      await updateClient('client-123', { startingWeight: 84 }, 'coach-1')

      expect(recordClientStart).not.toHaveBeenCalled()
      expect(appendMeasurements).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'coach_entry',
          recordedOn: '2026-03-01',
          values: { weight: 84 },
        })
      )
    })

    it('records a baseline for a client with no start date yet as an intake reading dated today', async () => {
      // Nothing to date it on before activation, so it is an `intake` row dated
      // today — the as-of rule picks it up the moment the date is set.
      const mockQuery = createMockQuery({
        data: createMockClientRow({ start_date: null }),
        error: null,
      })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never)

      await updateClient('client-123', { startingWeight: 84 }, 'coach-1')

      expect(appendMeasurements).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'intake',
          recordedOn: '2026-09-02',
          values: { weight: 84 },
        })
      )
    })

    it('does NOT recompute energy for a start-only correction', async () => {
      const mockQuery = createMockQuery({ data: createMockClientRow(), error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await updateClient('client-123', { startingWeight: 84 })

      // BMR/TDEE follow the CURRENT reading. The baseline row goes into the
      // log, and the recompute — should that row turn out to be the client's
      // newest — happens inside the append, never from here.
      expect(recalculateClientEnergy).not.toHaveBeenCalled()
    })

    it('refuses to withdraw a body fat reading BEFORE any write lands', async () => {
      // A void arrives with the correct/remove commit; until then the coach
      // reads a sentence rather than a save that silently kept the value.
      const mockQuery = createMockQuery({ data: createMockClientRow(), error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never)

      await expect(
        updateClient('client-123', { name: 'New Name', currentBodyFatPercentage: null }, 'coach-456')
      ).rejects.toThrow(ReadingRemovalUnavailableError)
      await expect(
        updateClient('client-123', { startingBodyFatPercentage: null }, 'coach-456')
      ).rejects.toThrow("A recorded start body fat can't be removed yet")

      expect(supabaseAdmin.from).not.toHaveBeenCalled()
      expect(appendMeasurements).not.toHaveBeenCalled()
    })

    it('leaves the start writer alone when no start field is present', async () => {
      const mockQuery = createMockQuery({ data: createMockClientRow(), error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await updateClient('client-123', { name: 'New Name' })

      expect(recordClientStart).not.toHaveBeenCalled()
    })

    it('persists dateOfBirth, which updateClientSchema accepts', async () => {
      // Regression: the schema accepted dateOfBirth and this mapper dropped it,
      // so a PATCH carrying a birth date returned 200 and changed nothing.
      const mockQuery = createMockQuery({
        data: createMockClientRow({ date_of_birth: '1991-04-17' }),
        error: null,
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await updateClient('client-123', { dateOfBirth: '1991-04-17' })

      const updateCall = mockQuery.update.mock.calls[0][0]
      expect(updateCall.date_of_birth).toBe('1991-04-17')
    })

    it('omits date_of_birth when dateOfBirth is not supplied', async () => {
      const mockQuery = createMockQuery({
        data: createMockClientRow(),
        error: null,
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await updateClient('client-123', { name: 'New Name' })

      const updateCall = mockQuery.update.mock.calls[0][0]
      expect('date_of_birth' in updateCall).toBe(false)
    })

    it('throws error for duplicate email', async () => {
      const mockQuery = createMockQuery({
        data: null,
        error: { code: '23505', message: 'Duplicate key' },
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await expect(
        updateClient('client-123', { email: 'duplicate@example.com' })
      ).rejects.toThrow('A client with this email already exists')
    })

    it('handles null values correctly', async () => {
      const mockClientRow = createMockClientRow({ notes: null })
      const mockQuery = createMockQuery({
        data: mockClientRow,
        error: null,
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await updateClient('client-123', {
        notes: '',
      })

      const updateCall = mockQuery.update.mock.calls[0][0]
      expect(updateCall.notes).toBe('')
    })

    it("records a current weight as a coach entry dated the COACH's today", async () => {
      const mockQuery = createMockQuery({ data: createMockClientRow(), error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never)

      await updateClient('client-123', { currentWeight: 175 }, 'coach-456')

      // Never a column: the reading is a row, and "now" is derived from it.
      expect(mockQuery.update.mock.calls[0][0]).not.toHaveProperty('current_weight')
      expect(getCoachTodayString).toHaveBeenCalledWith('coach-456')
      expect(appendMeasurements).toHaveBeenCalledWith({
        clientId: 'client-123',
        source: 'coach_entry',
        recordedOn: '2026-09-02',
        values: { weight: 175 },
        createdBy: 'coach-456',
      })
    })

    it("dates a coach entry on the CLIENT's calendar when no coach is in hand", async () => {
      const mockQuery = createMockQuery({ data: createMockClientRow(), error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never)

      await updateClient('client-123', { currentBodyFatPercentage: 14 })

      expect(getClientTodayString).toHaveBeenCalledWith('client-123')
      expect(appendMeasurements).toHaveBeenCalledWith({
        clientId: 'client-123',
        source: 'coach_entry',
        recordedOn: '2026-09-01',
        values: { bodyFat: 14 },
        createdBy: null,
      })
    })

    it('re-reads the derived fields after a reading lands, rather than echoing the pre-write row', async () => {
      // `client` was mapped from the row read BEFORE the append; "now", the
      // baseline and the pair the append may have recomputed all live in the
      // views, so the response is refreshed from a second read.
      const mockQuery = createMockQuery({ data: createMockClientRow(), error: null })
      mockQuery.single
        .mockResolvedValueOnce({ data: createMockClientRow(), error: null })
        .mockResolvedValueOnce({
          data: createMockClientRow({
            bmr: 1750,
            tdee: 2100,
            client_current_measurements: [
              { metric_key: 'weight', value: 175, recorded_on: '2026-09-02', source: 'coach_entry', measurement_id: 'm-new' },
            ],
          }),
          error: null,
        })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never)

      const client = await updateClient('client-123', { currentWeight: 175 }, 'coach-456')

      expect(client.currentWeight).toBe(175)
      expect(client.currentBodyFatPercentage).toBeUndefined()
      expect(client.bmr).toBe(1750)
      expect(client.tdee).toBe(2100)
    })

    it('does not re-read when no reading was written', async () => {
      const mockQuery = createMockQuery({ data: createMockClientRow(), error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never)

      await updateClient('client-123', { name: 'New Name' })

      expect(mockQuery.single).toHaveBeenCalledTimes(1)
    })

    it('dual-writes goals when goalWeight updated', async () => {
      const mockClientRow = createMockClientRow({ goal_weight: 165 })
      const mockQuery = createMockQuery({ data: mockClientRow, error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await updateClient('client-123', { goalWeight: 165 }, 'coach-456')

      expect(updateGoals).toHaveBeenCalledWith(
        'client-123',
        expect.objectContaining({ goalWeight: 165 }),
        'coach-456'
      )
    })

    // Task 0b.2 — the same three pins as createClient, on the update path.
    it('writes no goal column in the UPDATE', async () => {
      const mockQuery = createMockQuery({ data: createMockClientRow(), error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await updateClient(
        'client-123',
        { goalWeight: 165, goalBodyFatPercentage: 14, phone: '123' },
        'coach-456'
      )

      const updateCall = mockQuery.update.mock.calls[0][0]
      expect(updateCall).not.toHaveProperty('goal_weight')
      expect(updateCall).not.toHaveProperty('goal_body_fat_percentage')
      // The rest of the PATCH is committed independently and is unaffected.
      expect(updateCall).toHaveProperty('phone', '123')
    })

    it('a failed goal write surfaces rather than returning 200', async () => {
      const mockQuery = createMockQuery({ data: createMockClientRow(), error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)
      vi.mocked(updateGoals).mockRejectedValueOnce(new Error('goal insert failed'))

      await expect(
        updateClient('client-123', { goalWeight: 165 }, 'coach-456')
      ).rejects.toThrow('goal insert failed')
    })

    // The row is read BEFORE updateGoals moves the mirror, so without the
    // overlay a successful save echoes the old goal and renders as a no-op.
    it('echoes the new goal rather than the pre-write row', async () => {
      const mockQuery = createMockQuery({
        data: createMockClientRow({ goalWeight: 180 }),
        error: null,
      })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const client = await updateClient('client-123', { goalWeight: 165 }, 'coach-456')

      expect(client.goalWeight).toBe(165)
    })
  })

  describe('deleteClient', () => {
    it('soft deletes client by setting active to false', async () => {
      const mockQuery = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        // user_id null -> no cached auth mapping to bust
        maybeSingle: vi.fn().mockResolvedValue({ data: { user_id: null }, error: null }),
      }

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await deleteClient('client-123')

      const updateCall = mockQuery.update.mock.calls[0][0]
      expect(updateCall.active).toBe(false)
      expect(updateCall.updated_at).toBeDefined()
    })

    it('throws error on failure', async () => {
      const mockQuery = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'Delete failed' } }),
      }

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await expect(deleteClient('client-123')).rejects.toThrow(
        'Failed to delete client'
      )
    })
  })

  describe('updateClientSettings', () => {
    // Replaces the two tests that asserted weight_unit was DERIVED from
    // unitPreference. That derivation was the platform's worst data bug — it
    // flipped the tag while converting zero stored numbers, so a 180 lbs client
    // choosing Metric silently became a 180 kg client everywhere — and since
    // migration 141 the column does not exist, so writing it would PGRST204 and
    // 500 every settings save. This asserts it stays gone in both directions.
    it.each(['metric', 'imperial'] as const)(
      "writes unit_preference=%s and never derives a weight unit from it",
      async (preference) => {
        const mockQuery = createMockQuery({
          data: createMockClientRow({ unit_preference: preference }),
          error: null,
        })
        vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

        await updateClientSettings('client-123', { unitPreference: preference })

        const updateCall = mockQuery.update.mock.calls[0][0]
        expect(updateCall.unit_preference).toBe(preference)
        expect(updateCall.weight_unit).toBeUndefined()
        expect(updateCall.updated_at).toBeDefined()
      }
    )

    it('writes only timezone when only timezone is supplied', async () => {
      const mockQuery = createMockQuery({
        data: createMockClientRow({ timezone: 'America/Los_Angeles' }),
        error: null,
      })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await updateClientSettings('client-123', { timezone: 'America/Los_Angeles' })

      const updateCall = mockQuery.update.mock.calls[0][0]
      expect(updateCall.timezone).toBe('America/Los_Angeles')
      expect(updateCall.unit_preference).toBeUndefined()
      expect(updateCall.weight_unit).toBeUndefined()
    })

    it('scopes the UPDATE by client id', async () => {
      const mockQuery = createMockQuery({
        data: createMockClientRow(),
        error: null,
      })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await updateClientSettings('client-123', { unitPreference: 'metric' })

      expect(mockQuery.eq).toHaveBeenCalledWith('id', 'client-123')
    })

    it('throws when supabase returns an error', async () => {
      const mockQuery = createMockQuery({
        data: null,
        error: { message: 'connection lost' },
      })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await expect(
        updateClientSettings('client-123', { unitPreference: 'metric' }),
      ).rejects.toThrow('Failed to update client settings')
    })
  })

  describe('updateClientCheckInConfig', () => {
    it('updates check-in configuration', async () => {
      const mockClientRow = createMockClientRow({
        check_in_frequency: 'biweekly',
        check_in_frequency_days: 14,
        next_check_in_due: '2026-06-12',
      })
      const mockQuery = createMockQuery({
        data: mockClientRow,
        error: null,
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const result = await updateClientCheckInConfig('client-123', {
        checkInFrequency: 'biweekly',
        checkInFrequencyDays: 14,
        nextCheckInDue: '2026-06-12',
        reminderPreferences: { enabled: true, autoSend: false, sendBeforeHours: 24 },
      } as any)

      expect(result.checkInFrequency).toBe('biweekly')

      const updateCall = mockQuery.update.mock.calls[0][0]
      expect(updateCall.check_in_frequency).toBe('biweekly')
      expect(updateCall.check_in_frequency_days).toBe(14)
      expect(updateCall.next_check_in_due).toBe('2026-06-12')
      expect(updateCall.reminder_preferences).toEqual({ enabled: true, autoSend: false, sendBeforeHours: 24 })
    })

    it('throws error on failure', async () => {
      const mockQuery = createMockQuery({
        data: null,
        error: { message: 'Update failed' },
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await expect(
        updateClientCheckInConfig('client-123', {
          checkInFrequency: 'weekly',
          reminderPreferences: { enabled: true, autoSend: true, sendBeforeHours: 24 },
        } as any)
      ).rejects.toThrow('Failed to update check-in config')
    })
  })
})
