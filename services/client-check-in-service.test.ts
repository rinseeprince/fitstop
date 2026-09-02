import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the supabase-admin module
const { getCoachUnitPreferenceMock } = vi.hoisted(() => ({
  getCoachUnitPreferenceMock: vi.fn(),
}))

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
  getNutritionSummaryForPeriod: vi.fn(),
}))

vi.mock('@/services/check-in-context-service', () => ({
  getTrainingEventDetailsForPeriod: vi.fn(),
  getExerciseSummariesForPeriod: vi.fn(),
}))

vi.mock('./client-service', () => ({
  getClientById: vi.fn(),
}))

vi.mock('@/lib/viewer-preferences', () => ({
  getCoachUnitPreference: (...a: unknown[]) => getCoachUnitPreferenceMock(...a),
}))

import { triggerAISummaryGeneration } from './client-check-in-service'

import { generateCheckInSummary } from './ai-service'
import { 
  getCheckInWithDetails, 
  updateCheckInAISummary, 
  getClientCheckIns 
} from './check-in-service'
import { getDailyLogs } from './daily-logs-service'
import { getHabitLogs } from './daily-habits-service'
import { getNutritionSummaryForPeriod } from './weekly-nutrition-service'
import { getTrainingEventDetailsForPeriod, getExerciseSummariesForPeriod } from '@/services/check-in-context-service'
import { getClientById } from './client-service'

describe('Client Check-in Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default mock for getClientById - returns null (no expected check-in day)
    vi.mocked(getClientById).mockResolvedValue(null)
    getCoachUnitPreferenceMock.mockResolvedValue('metric')
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
      vi.mocked(getNutritionSummaryForPeriod).mockResolvedValue(null)
      vi.mocked(getTrainingEventDetailsForPeriod).mockResolvedValue([])
      vi.mocked(getExerciseSummariesForPeriod).mockResolvedValue(new Map())

      // Act
      await triggerAISummaryGeneration(mockCheckInId, mockClientId, mockClientName)

      // Assert
      expect(getCheckInWithDetails).toHaveBeenCalledWith(mockCheckInId)
      expect(getClientCheckIns).toHaveBeenCalledWith(mockClientId, { limit: 5 })
      expect(generateCheckInSummary).toHaveBeenCalledWith(
        mockCurrentCheckIn,
        mockPreviousCheckIns,
        mockClientName,
        // Daily tracking resolves (all four period reads are mocked): empty logs,
        // real period bounds, no nutrition summary, no event details.
        [],
        [],
        expect.any(Date),
        expect.any(Date),
        null,
        null,
        [],
        // exerciseSummaries (Session 6.3): the mocked empty Map.
        expect.any(Map),
        // The COACH's unit — this path is client-authenticated, but the coach is
        // who reads the summary.
        'metric'
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
      vi.mocked(getNutritionSummaryForPeriod).mockResolvedValue(null)
      vi.mocked(getTrainingEventDetailsForPeriod).mockResolvedValue([])
      vi.mocked(getExerciseSummariesForPeriod).mockResolvedValue(new Map())

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
        null,
        null,
        [],
        expect.any(Map),
        'metric'
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
      vi.mocked(getNutritionSummaryForPeriod).mockResolvedValue(null)
      vi.mocked(getTrainingEventDetailsForPeriod).mockResolvedValue([])
      vi.mocked(getExerciseSummariesForPeriod).mockResolvedValue(new Map())
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
      vi.mocked(getNutritionSummaryForPeriod).mockResolvedValue(null)
      vi.mocked(getTrainingEventDetailsForPeriod).mockResolvedValue([])
      vi.mocked(getExerciseSummariesForPeriod).mockResolvedValue(new Map())

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
        null,
        null,
        [],
        expect.any(Map),
        'metric'
      )
    })
  })
})
describe('AI summary unit resolution', () => {
  it("resolves the OWNING COACH's unit, not the submitting client's", async () => {
    vi.mocked(getCheckInWithDetails).mockResolvedValue({
      id: 'check-in-123',
      clientId: 'client-123',
    } as never)
    vi.mocked(getClientCheckIns).mockResolvedValue({ checkIns: [] } as never)
    vi.mocked(getClientById).mockResolvedValue({
      id: 'client-123',
      coachId: 'coach-9',
    } as never)
    vi.mocked(generateCheckInSummary).mockResolvedValue({} as never)
    vi.mocked(updateCheckInAISummary).mockResolvedValue(undefined)
    vi.mocked(getDailyLogs).mockResolvedValue([])
    vi.mocked(getHabitLogs).mockResolvedValue([])
    getCoachUnitPreferenceMock.mockResolvedValue('imperial')

    await triggerAISummaryGeneration('check-in-123', 'client-123', 'John Doe')

    // Keyed on the COACH. This path is client-authenticated, so resolving the
    // request's principal would have given the client's unit for prose only the
    // coach ever reads.
    expect(getCoachUnitPreferenceMock).toHaveBeenCalledWith('coach-9')
    const args = vi.mocked(generateCheckInSummary).mock.calls.at(-1)!
    expect(args[args.length - 1]).toBe('imperial')
  })
})
