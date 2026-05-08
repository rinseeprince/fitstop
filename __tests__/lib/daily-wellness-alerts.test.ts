import { describe, it, expect } from 'vitest'
import { detectAlerts } from '@/lib/daily-wellness-alerts'
import type { DailyLog } from '@/types/daily-log'

describe('detectAlerts', () => {
  // Helper to create a daily log with defaults
  const createLog = (overrides: Partial<DailyLog>): DailyLog => ({
    id: 'test-id',
    clientId: 'test-client',
    date: '2024-01-01',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides
  })

  it('returns empty array for empty logs', () => {
    const alerts = detectAlerts([])
    expect(alerts).toEqual([])
  })

  it('returns no alerts for single day of data', () => {
    const logs = [
      createLog({
        date: '2024-01-01',
        mood: 4,
        energy: 8,
        stress: 6,
        nutritionAdherence: 'hit'
      })
    ]
    
    const alerts = detectAlerts(logs)
    expect(alerts).toEqual([])
  })

  describe('Mood drop detection', () => {
    it('detects mood drop of 2+ points below average for 3 consecutive days', () => {
      const logs: DailyLog[] = [
        createLog({ date: '2024-01-01', mood: 4 }),
        createLog({ date: '2024-01-02', mood: 4 }),
        createLog({ date: '2024-01-03', mood: 4 }),
        createLog({ date: '2024-01-04', mood: 4 }),
        createLog({ date: '2024-01-05', mood: 4 }),
        createLog({ date: '2024-01-06', mood: 4 }),
        createLog({ date: '2024-01-07', mood: 4 }), // 7-day avg = 4
        createLog({ date: '2024-01-08', mood: 2 }), // 2 points below avg
        createLog({ date: '2024-01-09', mood: 2 }), // 2 points below avg
        createLog({ date: '2024-01-10', mood: 2 }), // 2 points below avg - triggers alert
      ]
      
      const alerts = detectAlerts(logs)
      const moodAlert = alerts.find(a => a.type === 'mood_drop')
      
      expect(moodAlert).toBeDefined()
      expect(moodAlert?.severity).toBe('high')
      expect(moodAlert?.affectedDays).toEqual(['2024-01-08', '2024-01-09', '2024-01-10'])
    })

    it('does not trigger mood drop for only 2 consecutive days', () => {
      const logs: DailyLog[] = [
        createLog({ date: '2024-01-01', mood: 4 }),
        createLog({ date: '2024-01-02', mood: 4 }),
        createLog({ date: '2024-01-03', mood: 4 }),
        createLog({ date: '2024-01-04', mood: 4 }),
        createLog({ date: '2024-01-05', mood: 4 }),
        createLog({ date: '2024-01-06', mood: 4 }),
        createLog({ date: '2024-01-07', mood: 4 }), // 7-day avg = 4
        createLog({ date: '2024-01-08', mood: 2 }), // 2 points below avg
        createLog({ date: '2024-01-09', mood: 2 }), // 2 points below avg
        createLog({ date: '2024-01-10', mood: 4 }), // Back to normal
      ]
      
      const alerts = detectAlerts(logs)
      const moodAlert = alerts.find(a => a.type === 'mood_drop')
      
      expect(moodAlert).toBeUndefined()
    })
  })

  describe('Energy drop detection', () => {
    it('detects energy drop of 2+ points below average for 3 consecutive days', () => {
      const logs: DailyLog[] = [
        createLog({ date: '2024-01-01', energy: 8 }),
        createLog({ date: '2024-01-02', energy: 8 }),
        createLog({ date: '2024-01-03', energy: 8 }),
        createLog({ date: '2024-01-04', energy: 8 }),
        createLog({ date: '2024-01-05', energy: 8 }),
        createLog({ date: '2024-01-06', energy: 8 }),
        createLog({ date: '2024-01-07', energy: 8 }), // 7-day avg = 8
        createLog({ date: '2024-01-08', energy: 5 }), // 3 points below avg
        createLog({ date: '2024-01-09', energy: 6 }), // 2 points below avg
        createLog({ date: '2024-01-10', energy: 5 }), // 3 points below avg - triggers alert
      ]
      
      const alerts = detectAlerts(logs)
      const energyAlert = alerts.find(a => a.type === 'energy_drop')
      
      expect(energyAlert).toBeDefined()
      expect(energyAlert?.severity).toBe('high')
      expect(energyAlert?.affectedDays).toEqual(['2024-01-08', '2024-01-09', '2024-01-10'])
    })

    it('does not trigger energy drop for only 2 consecutive days', () => {
      const logs: DailyLog[] = [
        createLog({ date: '2024-01-01', energy: 8 }),
        createLog({ date: '2024-01-02', energy: 8 }),
        createLog({ date: '2024-01-03', energy: 8 }),
        createLog({ date: '2024-01-04', energy: 8 }),
        createLog({ date: '2024-01-05', energy: 8 }),
        createLog({ date: '2024-01-06', energy: 8 }),
        createLog({ date: '2024-01-07', energy: 8 }), // 7-day avg = 8
        createLog({ date: '2024-01-08', energy: 5 }), // 3 points below avg
        createLog({ date: '2024-01-09', energy: 6 }), // 2 points below avg
        createLog({ date: '2024-01-10', energy: 8 }), // Back to normal
      ]
      
      const alerts = detectAlerts(logs)
      const energyAlert = alerts.find(a => a.type === 'energy_drop')
      
      expect(energyAlert).toBeUndefined()
    })
  })

  describe('No log gap detection', () => {
    it('detects 3+ consecutive days without logs', () => {
      // Use a specific date as "today" for testing
      const mockedToday = new Date('2024-01-10T00:00:00Z')

      const logs: DailyLog[] = [
        createLog({ date: '2024-01-01' }),
        createLog({ date: '2024-01-02' }),
        createLog({ date: '2024-01-03' }),
        createLog({ date: '2024-01-04' }),
        createLog({ date: '2024-01-05' }),
        createLog({ date: '2024-01-06' }), // Last log - 4 days ago
        // Missing 01-07, 01-08, 01-09, 01-10
      ]
      
      const alerts = detectAlerts(logs, mockedToday)
      const noLogAlert = alerts.find(a => a.type === 'no_log_gap')
      
      expect(noLogAlert).toBeDefined()
      expect(noLogAlert?.severity).toBe('medium')
      expect(noLogAlert?.affectedDays.length).toBe(3)
    })

    it('does not trigger no log gap for only 2 days', () => {
      // Use a specific date as "today" for testing
      const mockedToday = new Date('2024-01-09T00:00:00Z')

      const logs: DailyLog[] = [
        createLog({ date: '2024-01-01' }),
        createLog({ date: '2024-01-02' }),
        createLog({ date: '2024-01-03' }),
        createLog({ date: '2024-01-04' }),
        createLog({ date: '2024-01-05' }),
        createLog({ date: '2024-01-06' }),
        createLog({ date: '2024-01-07' }), // Last log - 2 days ago
        // Missing 01-08, 01-09
      ]
      
      const alerts = detectAlerts(logs, mockedToday)
      const noLogAlert = alerts.find(a => a.type === 'no_log_gap')
      
      expect(noLogAlert).toBeUndefined()
    })
  })

  describe('Nutrition missed detection', () => {
    it('detects 3 consecutive days with missed nutrition', () => {
      const logs: DailyLog[] = [
        createLog({ date: '2024-01-01', nutritionAdherence: 'hit' }),
        createLog({ date: '2024-01-02', nutritionAdherence: 'partial' }),
        createLog({ date: '2024-01-03', nutritionAdherence: 'missed' }),
        createLog({ date: '2024-01-04', nutritionAdherence: 'missed' }),
        createLog({ date: '2024-01-05', nutritionAdherence: 'missed' }), // 3rd consecutive missed
      ]
      
      const alerts = detectAlerts(logs)
      const nutritionAlert = alerts.find(a => a.type === 'nutrition_missed')
      
      expect(nutritionAlert).toBeDefined()
      expect(nutritionAlert?.severity).toBe('medium')
      expect(nutritionAlert?.affectedDays).toEqual(['2024-01-03', '2024-01-04', '2024-01-05'])
    })

    it('does not trigger nutrition missed for only 2 consecutive days', () => {
      const logs: DailyLog[] = [
        createLog({ date: '2024-01-01', nutritionAdherence: 'hit' }),
        createLog({ date: '2024-01-02', nutritionAdherence: 'missed' }),
        createLog({ date: '2024-01-03', nutritionAdherence: 'missed' }),
        createLog({ date: '2024-01-04', nutritionAdherence: 'partial' }), // Not missed
      ]
      
      const alerts = detectAlerts(logs)
      const nutritionAlert = alerts.find(a => a.type === 'nutrition_missed')
      
      expect(nutritionAlert).toBeUndefined()
    })
  })

  describe('Training missed detection', () => {
    it('detects 2+ missed training events in current week', () => {
      // Mock today as a Wednesday (2024-01-10)
      const mockedToday = new Date('2024-01-10T12:00:00Z') // Wednesday

      const logs: DailyLog[] = [
        createLog({ date: '2024-01-08' }),
        createLog({ date: '2024-01-09' }),
      ]

      // Two past scheduled events = 2 misses (today's event excluded)
      const trainingEvents = [
        { client_id: 'c1', date: '2024-01-08', status: 'scheduled', estimated_calories: 300 },
        { client_id: 'c1', date: '2024-01-09', status: 'scheduled', estimated_calories: 300 },
        { client_id: 'c1', date: '2024-01-10', status: 'completed', estimated_calories: 300 },
      ]

      const alerts = detectAlerts(logs, mockedToday, trainingEvents)
      const trainingAlert = alerts.find(a => a.type === 'training_missed')

      expect(trainingAlert).toBeDefined()
      expect(trainingAlert?.severity).toBe('high')
      expect(trainingAlert?.affectedDays).toEqual(['2024-01-08', '2024-01-09'])
    })

    it('does not trigger training missed for only 1 missed session', () => {
      const mockedToday = new Date('2024-01-10T12:00:00Z') // Wednesday

      const logs: DailyLog[] = [
        createLog({ date: '2024-01-08' }),
        createLog({ date: '2024-01-09' }),
      ]

      const trainingEvents = [
        { client_id: 'c1', date: '2024-01-08', status: 'scheduled', estimated_calories: 300 },
        { client_id: 'c1', date: '2024-01-09', status: 'completed', estimated_calories: 300 },
      ]

      const alerts = detectAlerts(logs, mockedToday, trainingEvents)
      const trainingAlert = alerts.find(a => a.type === 'training_missed')

      expect(trainingAlert).toBeUndefined()
    })

    it('does not trigger when no training events exist', () => {
      const mockedToday = new Date('2024-01-10T12:00:00Z') // Wednesday

      const logs: DailyLog[] = [
        createLog({ date: '2024-01-08' }),
        createLog({ date: '2024-01-09' }),
      ]

      const alerts = detectAlerts(logs, mockedToday, [])
      const trainingAlert = alerts.find(a => a.type === 'training_missed')

      expect(trainingAlert).toBeUndefined()
    })
  })

  describe('High stress detection', () => {
    it('detects stress 8+ for 3 consecutive days', () => {
      const logs: DailyLog[] = [
        createLog({ date: '2024-01-01', stress: 7 }),
        createLog({ date: '2024-01-02', stress: 8 }), // First high stress
        createLog({ date: '2024-01-03', stress: 9 }), // Second high stress
        createLog({ date: '2024-01-04', stress: 8 }), // Third high stress - triggers
      ]
      
      const alerts = detectAlerts(logs)
      const stressAlert = alerts.find(a => a.type === 'high_stress')
      
      expect(stressAlert).toBeDefined()
      expect(stressAlert?.severity).toBe('high')
      expect(stressAlert?.affectedDays).toEqual(['2024-01-02', '2024-01-03', '2024-01-04'])
    })

    it('does not trigger high stress for only 2 consecutive days', () => {
      const logs: DailyLog[] = [
        createLog({ date: '2024-01-01', stress: 7 }),
        createLog({ date: '2024-01-02', stress: 8 }), // First high stress
        createLog({ date: '2024-01-03', stress: 9 }), // Second high stress
        createLog({ date: '2024-01-04', stress: 6 }), // Back to normal
      ]
      
      const alerts = detectAlerts(logs)
      const stressAlert = alerts.find(a => a.type === 'high_stress')
      
      expect(stressAlert).toBeUndefined()
    })
  })

  describe('Edge cases', () => {
    it('handles logs with missing wellness metrics', () => {
      const logs: DailyLog[] = [
        createLog({ date: '2024-01-01' }), // No metrics
        createLog({ date: '2024-01-02', mood: 3 }), // Only mood
        createLog({ date: '2024-01-03', energy: 7 }), // Only energy
        createLog({ date: '2024-01-04', stress: 5 }), // Only stress
      ]
      
      // Use a specific date close to the logs to avoid gap detection
      const mockedToday = new Date('2024-01-05T00:00:00Z')
      const alerts = detectAlerts(logs, mockedToday)
      expect(alerts).toEqual([]) // No alerts should trigger
    })

    it('handles multiple alerts triggering simultaneously', () => {
      const logs: DailyLog[] = [
        createLog({ date: '2024-01-01', mood: 4, stress: 5, nutritionAdherence: 'hit' }),
        createLog({ date: '2024-01-02', mood: 4, stress: 6, nutritionAdherence: 'hit' }),
        createLog({ date: '2024-01-03', mood: 4, stress: 7, nutritionAdherence: 'hit' }),
        createLog({ date: '2024-01-04', mood: 4, stress: 8, nutritionAdherence: 'missed' }),
        createLog({ date: '2024-01-05', mood: 4, stress: 9, nutritionAdherence: 'missed' }),
        createLog({ date: '2024-01-06', mood: 4, stress: 10, nutritionAdherence: 'missed' }),
        createLog({ date: '2024-01-07', mood: 4, stress: 8, nutritionAdherence: 'missed' }),
        // Now mood drops and stress stays high
        createLog({ date: '2024-01-08', mood: 2, stress: 8, nutritionAdherence: 'missed' }),
        createLog({ date: '2024-01-09', mood: 2, stress: 9, nutritionAdherence: 'missed' }),
        createLog({ date: '2024-01-10', mood: 2, stress: 8, nutritionAdherence: 'hit' }),
      ]
      
      const alerts = detectAlerts(logs)
      
      // Should have multiple alerts
      expect(alerts.length).toBeGreaterThan(1)
      
      // Check for mood drop
      const moodAlert = alerts.find(a => a.type === 'mood_drop')
      expect(moodAlert).toBeDefined()
      
      // Check for high stress
      const stressAlert = alerts.find(a => a.type === 'high_stress')
      expect(stressAlert).toBeDefined()
      
      // Check for nutrition missed
      const nutritionAlert = alerts.find(a => a.type === 'nutrition_missed')
      expect(nutritionAlert).toBeDefined()
    })
  })
})