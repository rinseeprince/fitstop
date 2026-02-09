import { describe, it, expect, vi, beforeEach } from 'vitest'
import { triggerAISummaryGeneration } from './client-check-in-service'

// Mock the dependencies
vi.mock('./ai-service', () => ({
  generateCheckInSummary: vi.fn(),
}))

vi.mock('./check-in-service', () => ({
  getCheckInWithDetails: vi.fn(),
  updateCheckInAISummary: vi.fn(),
  getClientCheckIns: vi.fn(),
}))

import { generateCheckInSummary } from './ai-service'
import { 
  getCheckInWithDetails, 
  updateCheckInAISummary, 
  getClientCheckIns 
} from './check-in-service'

describe('Client Check-in Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      // ... other check-in fields
    }

    const mockPreviousCheckIns = [
      { id: 'check-in-122', clientId: mockClientId },
      { id: 'check-in-121', clientId: mockClientId },
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

      // Act
      await triggerAISummaryGeneration(mockCheckInId, mockClientId, mockClientName)

      // Assert
      expect(getCheckInWithDetails).toHaveBeenCalledWith(mockCheckInId)
      expect(getClientCheckIns).toHaveBeenCalledWith(mockClientId, { limit: 5 })
      expect(generateCheckInSummary).toHaveBeenCalledWith(
        mockCurrentCheckIn,
        mockPreviousCheckIns,
        mockClientName
      )
      expect(updateCheckInAISummary).toHaveBeenCalledWith(
        mockCheckInId,
        mockAISummary.summary,
        mockAISummary.insights,
        mockAISummary.recommendations,
        mockAISummary.responseDraft
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

      // Act
      await triggerAISummaryGeneration(mockCheckInId, mockClientId, mockClientName)

      // Assert
      expect(generateCheckInSummary).toHaveBeenCalledWith(
        mockCurrentCheckIn,
        mockPreviousCheckIns, // Should not include current check-in
        mockClientName
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

      // Act
      await triggerAISummaryGeneration(mockCheckInId, mockClientId, mockClientName)

      // Assert
      expect(generateCheckInSummary).toHaveBeenCalledWith(
        mockCurrentCheckIn,
        [], // Empty array for no previous check-ins
        mockClientName
      )
    })
  })
})