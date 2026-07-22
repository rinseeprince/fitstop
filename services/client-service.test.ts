import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the supabase-admin module
vi.mock('./supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

vi.mock('./body-metrics-service', () => ({
  recordBodyMetrics: vi.fn().mockResolvedValue({}),
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
import { recordBodyMetrics } from './body-metrics-service'
import { updateGoals } from './client-goals-service'
import {
  createClient,
  getClientsForCoach,
  getClientById,
  updateClient,
  deleteClient,
  permanentlyDeleteClient,
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
    height_unit: 'in',
    gender: 'male',
    date_of_birth: '1990-01-01',
    goal_weight: 170,
    goal_body_fat_percentage: 12,
    weight_unit: 'lbs',
    current_weight: 180,
    current_body_fat_percentage: 15,
    bmr: 1800,
    tdee: 2400,
    check_in_frequency: 'weekly',
    check_in_frequency_days: 7,
    expected_check_in_day: 'monday',
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
    starting_weight: 185,
    starting_body_fat_percentage: 18,
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
    ...overrides,
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
        weightUnit: 'lbs',
        heightUnit: 'in',
      } as any)

      expect(result.id).toBe('client-123')
      expect(result.name).toBe('Test Client')
      expect(result.email).toBe('test@example.com')
      expect(result.coachId).toBe('coach-456')
      expect(supabaseAdmin.from).toHaveBeenCalledWith('clients')
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
          weightUnit: 'lbs',
          heightUnit: 'in',
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
          weightUnit: 'lbs',
          heightUnit: 'in',
        } as any)
      ).rejects.toThrow('Failed to create client')
    })

    it('sets starting values from current values', async () => {
      const mockQuery = createMockQuery({
        data: createMockClientRow(),
        error: null,
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await createClient('coach-456', {
        name: 'Test Client',
        email: 'test@example.com',
        currentWeight: 180,
        currentBodyFatPercentage: 15,
        weightUnit: 'lbs',
        heightUnit: 'in',
      } as any)

      expect(mockQuery.insert).toHaveBeenCalled()
      const insertCall = mockQuery.insert.mock.calls[0][0]
      expect(insertCall.current_weight).toBe(180)
      expect(insertCall.starting_weight).toBe(180)
      expect(insertCall.current_body_fat_percentage).toBe(15)
      expect(insertCall.starting_body_fat_percentage).toBe(15)
    })

    it('dual-writes body metrics when currentWeight provided', async () => {
      const mockClientRow = createMockClientRow()
      const mockQuery = createMockQuery({ data: mockClientRow, error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await createClient('coach-456', {
        name: 'Test Client',
        email: 'test@example.com',
        currentWeight: 180,
        weightUnit: 'lbs',
        heightUnit: 'in',
      } as any)

      expect(recordBodyMetrics).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'client-123',
          weight: 180,
          source: 'intake_sync',
        })
      )
    })

    it('dual-writes goals when goalWeight provided', async () => {
      const mockClientRow = createMockClientRow()
      const mockQuery = createMockQuery({ data: mockClientRow, error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await createClient('coach-456', {
        name: 'Test Client',
        email: 'test@example.com',
        goalWeight: 170,
        weightUnit: 'lbs',
        heightUnit: 'in',
      } as any)

      expect(updateGoals).toHaveBeenCalledWith(
        'client-123',
        expect.objectContaining({ goalWeight: 170 }),
        'coach-456'
      )
    })

    it('does not fail if dual-write throws', async () => {
      const mockClientRow = createMockClientRow()
      const mockQuery = createMockQuery({ data: mockClientRow, error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)
      vi.mocked(recordBodyMetrics).mockRejectedValueOnce(new Error('fail'))

      await expect(
        createClient('coach-456', {
          name: 'Test Client',
          email: 'test@example.com',
          currentWeight: 180,
          weightUnit: 'lbs',
          heightUnit: 'in',
        } as any)
      ).resolves.toBeDefined()
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
    it('returns client when found', async () => {
      const mockClientRow = createMockClientRow()
      const mockQuery = createMockQuery({
        data: mockClientRow,
        error: null,
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const result = await getClientById('client-123')

      expect(result).not.toBeNull()
      expect(result?.id).toBe('client-123')
      expect(result?.name).toBe('Test Client')
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

    it('dual-writes body metrics when currentWeight updated', async () => {
      const mockClientRow = createMockClientRow({ current_weight: 175 })
      const mockQuery = createMockQuery({ data: mockClientRow, error: null })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await updateClient('client-123', { currentWeight: 175 })

      expect(recordBodyMetrics).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'client-123',
          weight: 175,
          source: 'metrics_api',
        })
      )
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

  describe('permanentlyDeleteClient', () => {
    it('permanently deletes client', async () => {
      const mockQuery = {
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: {}, error: null }),
      }

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await permanentlyDeleteClient('client-123')

      expect(mockQuery.delete).toHaveBeenCalled()
      expect(mockQuery.eq).toHaveBeenCalledWith('id', 'client-123')
    })

    it('throws error on failure', async () => {
      const mockQuery = {
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: null, error: { message: 'Delete failed' } }),
      }

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await expect(permanentlyDeleteClient('client-123')).rejects.toThrow(
        'Failed to permanently delete client'
      )
    })
  })

  describe('updateClientSettings', () => {
    it("derives weight_unit='kg' when unitPreference is 'metric'", async () => {
      const mockQuery = createMockQuery({
        data: createMockClientRow({ unit_preference: 'metric', weight_unit: 'kg' }),
        error: null,
      })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await updateClientSettings('client-123', { unitPreference: 'metric' })

      const updateCall = mockQuery.update.mock.calls[0][0]
      expect(updateCall.unit_preference).toBe('metric')
      expect(updateCall.weight_unit).toBe('kg')
      expect(updateCall.updated_at).toBeDefined()
    })

    it("derives weight_unit='lbs' when unitPreference is 'imperial'", async () => {
      const mockQuery = createMockQuery({
        data: createMockClientRow({ unit_preference: 'imperial', weight_unit: 'lbs' }),
        error: null,
      })
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await updateClientSettings('client-123', { unitPreference: 'imperial' })

      const updateCall = mockQuery.update.mock.calls[0][0]
      expect(updateCall.unit_preference).toBe('imperial')
      expect(updateCall.weight_unit).toBe('lbs')
    })

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
        expected_check_in_day: 'friday',
      })
      const mockQuery = createMockQuery({
        data: mockClientRow,
        error: null,
      })

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      const result = await updateClientCheckInConfig('client-123', {
        checkInFrequency: 'biweekly',
        checkInFrequencyDays: 14,
        expectedCheckInDay: 'friday',
        reminderPreferences: { enabled: true, autoSend: false, sendBeforeHours: 24 },
      } as any)

      expect(result.checkInFrequency).toBe('biweekly')

      const updateCall = mockQuery.update.mock.calls[0][0]
      expect(updateCall.check_in_frequency).toBe('biweekly')
      expect(updateCall.check_in_frequency_days).toBe(14)
      expect(updateCall.expected_check_in_day).toBe('friday')
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
