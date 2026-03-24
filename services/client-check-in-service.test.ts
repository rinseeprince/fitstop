import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the supabase-admin module
vi.mock('./supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

// Mock the dependencies
vi.mock('./ai-service', () => ({
  generateCheckInSummary: vi.fn(),
}))

vi.mock('./check-in-service', () => ({
  getCheckInWithDetails: vi.fn(),
  updateCheckInAISummary: vi.fn(),
  getClientCheckIns: vi.fn(),
}))

vi.mock('./daily-logs-service', () => ({
  getDailyLogs: vi.fn(),
}))

vi.mock('./daily-habits-service', () => ({
  getHabitLogs: vi.fn(),
}))

vi.mock('./weekly-nutrition-service', () => ({
  getWeeklySummaries: vi.fn(),
}))

vi.mock('./client-service', () => ({
  getClientById: vi.fn(),
  updateClient: vi.fn(),
}))

vi.mock('./bmr-service', () => ({
  updateClientBMR: vi.fn(),
}))

vi.mock('./body-metrics-service', () => ({
  recordBodyMetrics: vi.fn().mockResolvedValue({}),
}))

import { triggerAISummaryGeneration, updateClientMetricsFromCheckIn } from './client-check-in-service'

import { generateCheckInSummary } from './ai-service'
import { 
  getCheckInWithDetails, 
  updateCheckInAISummary, 
  getClientCheckIns 
} from './check-in-service'
import { getDailyLogs } from './daily-logs-service'
import { getHabitLogs } from './daily-habits-service'
import { getWeeklySummaries } from './weekly-nutrition-service'
import { getClientById, updateClient } from './client-service'
import { updateClientBMR } from './bmr-service'
import { supabaseAdmin } from './supabase-admin'
import { recordBodyMetrics } from './body-metrics-service'

describe('Client Check-in Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default mock for getClientById - returns null (no expected check-in day)
    vi.mocked(getClientById).mockResolvedValue(null)
  })

  describe('triggerAISummaryGeneration', () => {
    const mockCheckInId = 'check-in-123'
    const mockClientId = 'client-456' 
    const mockClientName = 'John Doe'

    const mockCurrentCheckIn = {
      id: mockCheckInId,
      clientId: mockClientId,
      mood: 4,
      energy: 7,
      weight: 180,
      createdAt: '2024-01-15T10:00:00Z',
      // ... other check-in fields
    }

    const mockPreviousCheckIns = [
      { id: 'check-in-122', clientId: mockClientId, createdAt: '2024-01-08T10:00:00Z' },
      { id: 'check-in-121', clientId: mockClientId, createdAt: '2024-01-01T10:00:00Z' },
    ]

    const mockAISummary = {
      summary: 'Great progress this week',
      insights: ['Weight loss trend continues'],
      recommendations: ['Keep up current routine'],
      responseDraft: 'Excellent work on your goals!'
    }

    it('should successfully generate AI summary for check-in', async () => {
      // Arrange
      vi.mocked(getCheckInWithDetails).mockResolvedValue(mockCurrentCheckIn as any)
      vi.mocked(getClientCheckIns).mockResolvedValue({ 
        checkIns: [mockCurrentCheckIn, ...mockPreviousCheckIns], 
        total: 3 
      } as any)
      vi.mocked(generateCheckInSummary).mockResolvedValue(mockAISummary as any)
      vi.mocked(updateCheckInAISummary).mockResolvedValue(undefined)
      vi.mocked(getDailyLogs).mockResolvedValue([])
      vi.mocked(getHabitLogs).mockResolvedValue([])
      vi.mocked(getWeeklySummaries).mockResolvedValue([])

      // Act
      await triggerAISummaryGeneration(mockCheckInId, mockClientId, mockClientName)

      // Assert
      expect(getCheckInWithDetails).toHaveBeenCalledWith(mockCheckInId)
      expect(getClientCheckIns).toHaveBeenCalledWith(mockClientId, { limit: 5 })
      expect(generateCheckInSummary).toHaveBeenCalledWith(
        mockCurrentCheckIn,
        mockPreviousCheckIns,
        mockClientName,
        [],
        [],
        expect.any(Date),
        expect.any(Date),
        null
      )
      expect(updateCheckInAISummary).toHaveBeenCalledWith(
        mockCheckInId,
        mockAISummary
      )
    })

    it('should throw error if check-in not found', async () => {
      // Arrange
      vi.mocked(getCheckInWithDetails).mockResolvedValue(null)

      // Act & Assert
      await expect(
        triggerAISummaryGeneration(mockCheckInId, mockClientId, mockClientName)
      ).rejects.toThrow('Check-in not found')
      
      expect(getCheckInWithDetails).toHaveBeenCalledWith(mockCheckInId)
      expect(getClientCheckIns).not.toHaveBeenCalled()
      expect(generateCheckInSummary).not.toHaveBeenCalled()
      expect(updateCheckInAISummary).not.toHaveBeenCalled()
    })

    it('should filter out current check-in from previous check-ins', async () => {
      // Arrange
      const allCheckIns = [mockCurrentCheckIn, ...mockPreviousCheckIns]
      vi.mocked(getCheckInWithDetails).mockResolvedValue(mockCurrentCheckIn as any)
      vi.mocked(getClientCheckIns).mockResolvedValue({
        checkIns: allCheckIns,
        total: 3
      } as any)
      vi.mocked(generateCheckInSummary).mockResolvedValue(mockAISummary as any)
      vi.mocked(updateCheckInAISummary).mockResolvedValue(undefined)
      vi.mocked(getDailyLogs).mockResolvedValue([])
      vi.mocked(getHabitLogs).mockResolvedValue([])
      vi.mocked(getWeeklySummaries).mockResolvedValue([])

      // Act
      await triggerAISummaryGeneration(mockCheckInId, mockClientId, mockClientName)

      // Assert
      expect(generateCheckInSummary).toHaveBeenCalledWith(
        mockCurrentCheckIn,
        mockPreviousCheckIns, // Should not include current check-in
        mockClientName,
        [],
        [],
        expect.any(Date),
        expect.any(Date),
        null
      )
    })

    it('should handle errors in AI summary generation', async () => {
      // Arrange
      const mockError = new Error('AI service unavailable')
      vi.mocked(getCheckInWithDetails).mockResolvedValue(mockCurrentCheckIn as any)
      vi.mocked(getClientCheckIns).mockResolvedValue({
        checkIns: [mockCurrentCheckIn],
        total: 1
      } as any)
      vi.mocked(getDailyLogs).mockResolvedValue([])
      vi.mocked(getHabitLogs).mockResolvedValue([])
      vi.mocked(getWeeklySummaries).mockResolvedValue([])
      vi.mocked(generateCheckInSummary).mockRejectedValue(mockError)

      // Act & Assert
      await expect(
        triggerAISummaryGeneration(mockCheckInId, mockClientId, mockClientName)
      ).rejects.toThrow('AI service unavailable')
      
      expect(updateCheckInAISummary).not.toHaveBeenCalled()
    })

    it('should handle errors in check-in retrieval', async () => {
      // Arrange
      const mockError = new Error('Database connection failed')
      vi.mocked(getCheckInWithDetails).mockRejectedValue(mockError)

      // Act & Assert
      await expect(
        triggerAISummaryGeneration(mockCheckInId, mockClientId, mockClientName)
      ).rejects.toThrow('Database connection failed')
      
      expect(getClientCheckIns).not.toHaveBeenCalled()
      expect(generateCheckInSummary).not.toHaveBeenCalled()
      expect(updateCheckInAISummary).not.toHaveBeenCalled()
    })

    it('should work with no previous check-ins', async () => {
      // Arrange
      vi.mocked(getCheckInWithDetails).mockResolvedValue(mockCurrentCheckIn as any)
      vi.mocked(getClientCheckIns).mockResolvedValue({
        checkIns: [mockCurrentCheckIn], // Only current check-in
        total: 1
      } as any)
      vi.mocked(generateCheckInSummary).mockResolvedValue(mockAISummary as any)
      vi.mocked(updateCheckInAISummary).mockResolvedValue(undefined)
      vi.mocked(getDailyLogs).mockResolvedValue([])
      vi.mocked(getHabitLogs).mockResolvedValue([])
      vi.mocked(getWeeklySummaries).mockResolvedValue([])

      // Act
      await triggerAISummaryGeneration(mockCheckInId, mockClientId, mockClientName)

      // Assert
      expect(generateCheckInSummary).toHaveBeenCalledWith(
        mockCurrentCheckIn,
        [], // Empty array for no previous check-ins
        mockClientName,
        [],
        [],
        expect.any(Date),
        expect.any(Date),
        null
      )
    })
  })

  describe('updateClientMetricsFromCheckIn', () => {
    const mockClient = {
      id: 'client-456',
      name: 'Test Client',
      height: 72,
      heightUnit: 'in',
      gender: 'male',
      dateOfBirth: '1990-01-01',
      currentWeight: 180,
      weightUnit: 'lbs',
    } as any

    it('calls recordBodyMetrics after updating client metrics from check-in', async () => {
      vi.mocked(updateClient).mockResolvedValue({ ...mockClient, currentWeight: 175 })
      vi.mocked(updateClientBMR).mockReturnValue(1800)

      const mockQuery = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      }
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any)

      await updateClientMetricsFromCheckIn(mockClient, { weight: 175, bodyFatPercentage: 14 } as any, 'check-in-999')

      expect(recordBodyMetrics).toHaveBeenCalledWith({
        clientId: 'client-456',
        weight: 175,
        bodyFatPercentage: 14,
        bmr: 1800,
        tdee: 2160,
        source: 'check_in',
        sourceId: 'check-in-999',
      })
    })

    it('still updates clients table even if recordBodyMetrics fails', async () => {
      vi.mocked(updateClient).mockResolvedValue({ ...mockClient, currentWeight: 175 })
      vi.mocked(updateClientBMR).mockReturnValue(null)
      vi.mocked(recordBodyMetrics).mockRejectedValueOnce(new Error('DB down'))

      // Should not throw despite dual-write failure
      await expect(
        updateClientMetricsFromCheckIn(mockClient, { weight: 175 } as any)
      ).resolves.not.toThrow()
    })
  })
})