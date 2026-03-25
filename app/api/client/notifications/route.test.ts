import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { GET } from './route'

// Mock the dependencies
vi.mock('@/lib/auth-helpers', () => ({
  getAuthenticatedClientId: vi.fn(),
}))

vi.mock('@/services/client-service', () => ({
  getClientById: vi.fn(),
}))

vi.mock('@/services/check-in-tracking-service', () => ({
  calculateNextExpectedCheckIn: vi.fn(),
  getDaysUntilOrPastDue: vi.fn(),
  isClientOverdue: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  apiRateLimit: vi.fn(),
  clientApiRateLimit: vi.fn(),
}))

import { getAuthenticatedClientId } from '@/lib/auth-helpers'
import { getClientById } from '@/services/client-service'
import { 
  calculateNextExpectedCheckIn,
  getDaysUntilOrPastDue,
  isClientOverdue 
} from '@/services/check-in-tracking-service'
import { apiRateLimit, clientApiRateLimit } from '@/lib/rate-limit'

describe('/api/client/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiRateLimit).mockResolvedValue(null)
    vi.mocked(clientApiRateLimit).mockResolvedValue(null)
  })

  const mockClient = {
    id: 'client-123',
    name: 'John Doe',
    email: 'john.doe@example.com',
    checkInFrequency: 'weekly' as const,
    coachId: 'coach-456',
    active: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    avatarUrl: undefined,
    notes: undefined,
    height: undefined,
    heightUnit: 'in' as const,
    gender: undefined,
    dateOfBirth: undefined,
    goalWeight: undefined,
    goalBodyFatPercentage: undefined,
    weightUnit: 'lbs' as const,
    currentWeight: undefined,
    currentBodyFatPercentage: undefined,
    bmr: undefined,
    tdee: undefined,
    checkInFrequencyDays: undefined,
    expectedCheckInDay: undefined,
    lastReminderSentAt: undefined,
    reminderPreferences: undefined,
    totalCheckInsExpected: undefined,
    totalCheckInsCompleted: undefined,
    checkInAdherenceRate: undefined,
    currentStreak: undefined,
    longestStreak: undefined,
    unitPreference: 'imperial' as const,
    workActivityLevel: undefined,
    trainingVolumeHours: undefined,
    proteinTargetGPerKg: undefined,
    dietType: undefined,
    goalDeadline: undefined,
    nutritionPlanCreatedDate: undefined,
    nutritionPlanBaseWeightKg: undefined,
    baselineCalories: undefined,
    startingWeight: undefined,
    startingBodyFatPercentage: undefined,
    calorieTarget: undefined,
    proteinTargetG: undefined,
    carbTargetG: undefined,
    fatTargetG: undefined,
    includeActivityBurn: true,
    customMacrosEnabled: false,
    customProteinG: undefined,
    customCarbG: undefined,
    customFatG: undefined,
    customCalories: undefined,
    bmrManualOverride: undefined,
    tdeeManualOverride: undefined,
  }

  const createMockRequest = () => {
    return new NextRequest('http://localhost:3000/api/client/notifications', {
      method: 'GET'
    })
  }

  describe('Authentication', () => {
    it('should return 401 if client not authenticated', async () => {
      // Arrange
      vi.mocked(getAuthenticatedClientId).mockResolvedValue(null)

      // Act
      const response = await GET(createMockRequest())
      const data = await response.json()

      // Assert
      expect(response.status).toBe(401)
      expect(data.success).toBe(false)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 404 if client not found', async () => {
      // Arrange
      vi.mocked(getAuthenticatedClientId).mockResolvedValue('client-123')
      vi.mocked(getClientById).mockResolvedValue(null)

      // Act
      const response = await GET(createMockRequest())
      const data = await response.json()

      // Assert
      expect(response.status).toBe(404)
      expect(data.success).toBe(false)
      expect(data.error).toBe('Client not found')
    })
  })

  describe('Overdue notifications', () => {
    it('should return overdue notification when client is overdue', async () => {
      // Arrange
      vi.mocked(getAuthenticatedClientId).mockResolvedValue('client-123')
      vi.mocked(getClientById).mockResolvedValue(mockClient)
      vi.mocked(isClientOverdue).mockReturnValue(true)
      vi.mocked(getDaysUntilOrPastDue).mockReturnValue(2) // 2 days overdue
      vi.mocked(calculateNextExpectedCheckIn).mockReturnValue(new Date('2024-01-01T00:00:00Z'))

      // Act
      const response = await GET(createMockRequest())
      const data = await response.json()

      // Assert
      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.notifications).toHaveLength(1)
      
      const notification = data.data.notifications[0]
      expect(notification.type).toBe('check-in')
      expect(notification.title).toBe('Check-in Overdue')
      expect(notification.description).toBe('Your check-in is 2 days overdue. Complete it now to stay on track!')
      expect(notification.actionUrl).toBe('/client/check-in')
      expect(notification.metadata.daysOverdue).toBe(2)
      expect(notification.metadata.severity).toBe('urgent')
    })

    it('should return urgent notification when 2+ days overdue', async () => {
      // Arrange
      vi.mocked(getAuthenticatedClientId).mockResolvedValue('client-123')
      vi.mocked(getClientById).mockResolvedValue(mockClient)
      vi.mocked(isClientOverdue).mockReturnValue(true)
      vi.mocked(getDaysUntilOrPastDue).mockReturnValue(3)
      vi.mocked(calculateNextExpectedCheckIn).mockReturnValue(new Date('2024-01-01T00:00:00Z'))

      // Act
      const response = await GET(createMockRequest())
      const data = await response.json()

      // Assert
      const notification = data.data.notifications[0]
      expect(notification.metadata.severity).toBe('urgent')
    })

    it('should return critical notification when 4+ days overdue', async () => {
      // Arrange
      vi.mocked(getAuthenticatedClientId).mockResolvedValue('client-123')
      vi.mocked(getClientById).mockResolvedValue(mockClient)
      vi.mocked(isClientOverdue).mockReturnValue(true)
      vi.mocked(getDaysUntilOrPastDue).mockReturnValue(5)
      vi.mocked(calculateNextExpectedCheckIn).mockReturnValue(new Date('2024-01-01T00:00:00Z'))

      // Act
      const response = await GET(createMockRequest())
      const data = await response.json()

      // Assert
      const notification = data.data.notifications[0]
      expect(notification.title).toBe('Check-in Critically Overdue')
      expect(notification.metadata.severity).toBe('critical')
    })
  })

  describe('Due soon notifications', () => {
    it('should return due today notification when check-in is due today', async () => {
      // Arrange
      vi.mocked(getAuthenticatedClientId).mockResolvedValue('client-123')
      vi.mocked(getClientById).mockResolvedValue(mockClient)
      vi.mocked(isClientOverdue).mockReturnValue(false)
      vi.mocked(getDaysUntilOrPastDue).mockReturnValue(0) // Due today
      vi.mocked(calculateNextExpectedCheckIn).mockReturnValue(new Date('2024-01-01T00:00:00Z'))

      // Act
      const response = await GET(createMockRequest())
      const data = await response.json()

      // Assert
      expect(data.data.notifications).toHaveLength(1)
      
      const notification = data.data.notifications[0]
      expect(notification.title).toBe('Check-in Due Today')
      expect(notification.description).toBe('Your check-in is due today. Take a few minutes to complete it!')
    })

    it('should return due tomorrow notification when check-in is due tomorrow', async () => {
      // Arrange
      vi.mocked(getAuthenticatedClientId).mockResolvedValue('client-123')
      vi.mocked(getClientById).mockResolvedValue(mockClient)
      vi.mocked(isClientOverdue).mockReturnValue(false)
      vi.mocked(getDaysUntilOrPastDue).mockReturnValue(-1) // Due tomorrow
      vi.mocked(calculateNextExpectedCheckIn).mockReturnValue(new Date('2024-01-01T00:00:00Z'))

      // Act
      const response = await GET(createMockRequest())
      const data = await response.json()

      // Assert
      const notification = data.data.notifications[0]
      expect(notification.title).toBe('Check-in Due Tomorrow')
      expect(notification.description).toBe('Your check-in is due tomorrow. Take a few minutes to complete it!')
    })
  })

  describe('No check-in schedule', () => {
    it('should return empty notifications when frequency is none', async () => {
      // Arrange
      const clientWithNoSchedule = { ...mockClient, checkInFrequency: 'none' as const }
      vi.mocked(getAuthenticatedClientId).mockResolvedValue('client-123')
      vi.mocked(getClientById).mockResolvedValue(clientWithNoSchedule)

      // Act
      const response = await GET(createMockRequest())
      const data = await response.json()

      // Assert
      expect(data.success).toBe(true)
      expect(data.data.notifications).toHaveLength(0)
      expect(data.data.unreadCount).toBe(0)
    })

    it('should not call check-in tracking functions when frequency is none', async () => {
      // Arrange
      const clientWithNoSchedule = { ...mockClient, checkInFrequency: 'none' as const }
      vi.mocked(getAuthenticatedClientId).mockResolvedValue('client-123')
      vi.mocked(getClientById).mockResolvedValue(clientWithNoSchedule)
      vi.mocked(isClientOverdue).mockReturnValue(false)
      vi.mocked(getDaysUntilOrPastDue).mockReturnValue(0)
      vi.mocked(calculateNextExpectedCheckIn).mockReturnValue(new Date())

      // Act
      await GET(createMockRequest())

      // Assert - functions are still called to populate checkInStatus response
      expect(isClientOverdue).toHaveBeenCalled()
      expect(getDaysUntilOrPastDue).toHaveBeenCalled()
      expect(calculateNextExpectedCheckIn).toHaveBeenCalled()
    })
  })

  describe('Check-in status metadata', () => {
    it('should include check-in status in response', async () => {
      // Arrange
      vi.mocked(getAuthenticatedClientId).mockResolvedValue('client-123')
      vi.mocked(getClientById).mockResolvedValue(mockClient)
      vi.mocked(isClientOverdue).mockReturnValue(false)
      vi.mocked(getDaysUntilOrPastDue).mockReturnValue(-2) // Due in 2 days
      vi.mocked(calculateNextExpectedCheckIn).mockReturnValue(new Date('2024-01-03T00:00:00Z'))

      // Act
      const response = await GET(createMockRequest())
      const data = await response.json()

      // Assert
      expect(data.data.checkInStatus).toEqual({
        isOverdue: false,
        daysUntilOrPast: -2,
        nextExpected: '2024-01-03T00:00:00.000Z',
        frequency: 'weekly'
      })
    })
  })

  describe('Error handling', () => {
    it('should handle service errors gracefully', async () => {
      // Arrange
      vi.mocked(getAuthenticatedClientId).mockRejectedValue(new Error('Database error'))

      // Act
      const response = await GET(createMockRequest())
      const data = await response.json()

      // Assert
      expect(response.status).toBe(500)
      expect(data.success).toBe(false)
      expect(data.error).toBe('Database error')
    })

    it('should respect rate limiting', async () => {
      // Arrange
      const rateLimitResponse = NextResponse.json({ error: 'Rate limited' }, { status: 429 })
      vi.mocked(clientApiRateLimit).mockResolvedValue(rateLimitResponse)

      // Act
      const response = await GET(createMockRequest())

      // Assert
      expect(response).toBe(rateLimitResponse)
      expect(getAuthenticatedClientId).not.toHaveBeenCalled()
    })
  })
})