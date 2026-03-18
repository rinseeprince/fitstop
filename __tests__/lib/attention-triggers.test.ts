import { describe, it, expect } from 'vitest'
import {
  evaluateMoodEnergyDrop,
  evaluateLoggingGap,
  evaluateNutritionMisses,
  evaluateTrainingMisses,
  evaluateHighStress,
  evaluateHabitDropoff,
  evaluateActivityCalMismatch
} from '@/lib/attention-triggers'
import type { DailyLog } from '@/types/daily-log'
import type { DailyHabit, DailyHabitLog } from '@/types/daily-habit'

describe('attention-triggers', () => {
  describe('evaluateMoodEnergyDrop', () => {
    it('should detect mood drop when 3 consecutive days are 2+ points below 7-day average', () => {
      const logs: DailyLog[] = [
        // Baseline period (7 days with mood around 4-5)
        { id: '1', clientId: 'c1', date: '2024-01-01', mood: 4, createdAt: '', updatedAt: '' },
        { id: '2', clientId: 'c1', date: '2024-01-02', mood: 5, createdAt: '', updatedAt: '' },
        { id: '3', clientId: 'c1', date: '2024-01-03', mood: 4, createdAt: '', updatedAt: '' },
        { id: '4', clientId: 'c1', date: '2024-01-04', mood: 5, createdAt: '', updatedAt: '' },
        { id: '5', clientId: 'c1', date: '2024-01-05', mood: 4, createdAt: '', updatedAt: '' },
        { id: '6', clientId: 'c1', date: '2024-01-06', mood: 4, createdAt: '', updatedAt: '' },
        { id: '7', clientId: 'c1', date: '2024-01-07', mood: 5, createdAt: '', updatedAt: '' },
        // Drop period (mood drops to 2, which is 2+ points below average of ~4.4)
        { id: '8', clientId: 'c1', date: '2024-01-08', mood: 2, createdAt: '', updatedAt: '' },
        { id: '9', clientId: 'c1', date: '2024-01-09', mood: 2, createdAt: '', updatedAt: '' },
        { id: '10', clientId: 'c1', date: '2024-01-10', mood: 2, createdAt: '', updatedAt: '' },
      ]

      const result = evaluateMoodEnergyDrop(logs, 'mood')
      
      expect(result).not.toBeNull()
      expect(result?.type).toBe('mood_drop')
      expect(result?.severity).toBe('high')
      expect(result?.affectedDays).toHaveLength(3)
      expect(result?.affectedDays).toContain('2024-01-08')
      expect(result?.metricData).toBeDefined()
    })

    it('should not trigger when drop is less than 2 points', () => {
      const logs: DailyLog[] = [
        // Baseline period (mood around 4-5)
        { id: '1', clientId: 'c1', date: '2024-01-01', mood: 4, createdAt: '', updatedAt: '' },
        { id: '2', clientId: 'c1', date: '2024-01-02', mood: 5, createdAt: '', updatedAt: '' },
        { id: '3', clientId: 'c1', date: '2024-01-03', mood: 4, createdAt: '', updatedAt: '' },
        { id: '4', clientId: 'c1', date: '2024-01-04', mood: 5, createdAt: '', updatedAt: '' },
        { id: '5', clientId: 'c1', date: '2024-01-05', mood: 4, createdAt: '', updatedAt: '' },
        { id: '6', clientId: 'c1', date: '2024-01-06', mood: 4, createdAt: '', updatedAt: '' },
        { id: '7', clientId: 'c1', date: '2024-01-07', mood: 5, createdAt: '', updatedAt: '' },
        // Small drop (mood 3 is only 1.4 points below average)
        { id: '8', clientId: 'c1', date: '2024-01-08', mood: 3, createdAt: '', updatedAt: '' },
        { id: '9', clientId: 'c1', date: '2024-01-09', mood: 3, createdAt: '', updatedAt: '' },
        { id: '10', clientId: 'c1', date: '2024-01-10', mood: 3, createdAt: '', updatedAt: '' },
      ]

      const result = evaluateMoodEnergyDrop(logs, 'mood')
      expect(result).toBeNull()
    })

    it('should handle insufficient data gracefully', () => {
      const logs: DailyLog[] = [
        { id: '1', clientId: 'c1', date: '2024-01-01', mood: 4, createdAt: '', updatedAt: '' },
        { id: '2', clientId: 'c1', date: '2024-01-02', mood: 3, createdAt: '', updatedAt: '' },
      ]

      const result = evaluateMoodEnergyDrop(logs, 'mood')
      expect(result).toBeNull()
    })

    it('should work for energy metric as well', () => {
      const logs: DailyLog[] = [
        // Baseline period (energy around 8)
        { id: '1', clientId: 'c1', date: '2024-01-01', energy: 8, createdAt: '', updatedAt: '' },
        { id: '2', clientId: 'c1', date: '2024-01-02', energy: 8, createdAt: '', updatedAt: '' },
        { id: '3', clientId: 'c1', date: '2024-01-03', energy: 8, createdAt: '', updatedAt: '' },
        { id: '4', clientId: 'c1', date: '2024-01-04', energy: 8, createdAt: '', updatedAt: '' },
        { id: '5', clientId: 'c1', date: '2024-01-05', energy: 8, createdAt: '', updatedAt: '' },
        { id: '6', clientId: 'c1', date: '2024-01-06', energy: 8, createdAt: '', updatedAt: '' },
        { id: '7', clientId: 'c1', date: '2024-01-07', energy: 8, createdAt: '', updatedAt: '' },
        // Drop period (energy drops to 5)
        { id: '8', clientId: 'c1', date: '2024-01-08', energy: 5, createdAt: '', updatedAt: '' },
        { id: '9', clientId: 'c1', date: '2024-01-09', energy: 5, createdAt: '', updatedAt: '' },
        { id: '10', clientId: 'c1', date: '2024-01-10', energy: 5, createdAt: '', updatedAt: '' },
      ]

      const result = evaluateMoodEnergyDrop(logs, 'energy')
      
      expect(result).not.toBeNull()
      expect(result?.type).toBe('energy_drop')
      expect(result?.severity).toBe('high')
    })

    it('should NOT trigger when streak is followed by recovery', () => {
      const logs: DailyLog[] = [
        // Baseline period
        { id: '1', clientId: 'c1', date: '2024-01-01', mood: 4, createdAt: '', updatedAt: '' },
        { id: '2', clientId: 'c1', date: '2024-01-02', mood: 5, createdAt: '', updatedAt: '' },
        { id: '3', clientId: 'c1', date: '2024-01-03', mood: 4, createdAt: '', updatedAt: '' },
        { id: '4', clientId: 'c1', date: '2024-01-04', mood: 5, createdAt: '', updatedAt: '' },
        { id: '5', clientId: 'c1', date: '2024-01-05', mood: 4, createdAt: '', updatedAt: '' },
        { id: '6', clientId: 'c1', date: '2024-01-06', mood: 4, createdAt: '', updatedAt: '' },
        { id: '7', clientId: 'c1', date: '2024-01-07', mood: 5, createdAt: '', updatedAt: '' },
        // Drop period
        { id: '8', clientId: 'c1', date: '2024-01-08', mood: 2, createdAt: '', updatedAt: '' },
        { id: '9', clientId: 'c1', date: '2024-01-09', mood: 2, createdAt: '', updatedAt: '' },
        { id: '10', clientId: 'c1', date: '2024-01-10', mood: 2, createdAt: '', updatedAt: '' },
        // Recovery - mood returns to normal
        { id: '11', clientId: 'c1', date: '2024-01-11', mood: 4, createdAt: '', updatedAt: '' },
        { id: '12', clientId: 'c1', date: '2024-01-12', mood: 5, createdAt: '', updatedAt: '' },
        { id: '13', clientId: 'c1', date: '2024-01-13', mood: 4, createdAt: '', updatedAt: '' },
      ]

      const result = evaluateMoodEnergyDrop(logs, 'mood')
      expect(result).toBeNull()
    })
  })

  describe('evaluateLoggingGap', () => {
    it('should detect 3+ consecutive days without logs', () => {
      const logs: DailyLog[] = [
        { id: '1', clientId: 'c1', date: '2024-01-01', createdAt: '', updatedAt: '' },
        { id: '2', clientId: 'c1', date: '2024-01-05', createdAt: '', updatedAt: '' },
      ]
      const dateRange = { start: '2024-01-01', end: '2024-01-10' }

      const result = evaluateLoggingGap(logs, dateRange)
      
      expect(result).not.toBeNull()
      expect(result?.type).toBe('no_log_gap')
      expect(result?.severity).toBe('medium')
      expect(result?.affectedDays).toHaveLength(3)
    })

    it('should not trigger for 2-day gap', () => {
      const logs: DailyLog[] = [
        { id: '1', clientId: 'c1', date: '2024-01-01', createdAt: '', updatedAt: '' },
        { id: '2', clientId: 'c1', date: '2024-01-03', createdAt: '', updatedAt: '' },
        { id: '3', clientId: 'c1', date: '2024-01-05', createdAt: '', updatedAt: '' },
      ]
      const dateRange = { start: '2024-01-01', end: '2024-01-05' }

      const result = evaluateLoggingGap(logs, dateRange)
      expect(result).toBeNull()
    })

    it('should handle empty logs', () => {
      const logs: DailyLog[] = []
      const dateRange = { start: '2024-01-01', end: '2024-01-10' }

      const result = evaluateLoggingGap(logs, dateRange)
      expect(result).toBeNull()
    })
  })

  describe('evaluateNutritionMisses', () => {
    it('should detect 3 consecutive days of missed nutrition', () => {
      const logs: DailyLog[] = [
        { id: '1', clientId: 'c1', date: '2024-01-01', nutritionAdherence: 'hit', createdAt: '', updatedAt: '' },
        { id: '2', clientId: 'c1', date: '2024-01-02', nutritionAdherence: 'missed', createdAt: '', updatedAt: '' },
        { id: '3', clientId: 'c1', date: '2024-01-03', nutritionAdherence: 'missed', createdAt: '', updatedAt: '' },
        { id: '4', clientId: 'c1', date: '2024-01-04', nutritionAdherence: 'missed', createdAt: '', updatedAt: '' },
      ]

      const result = evaluateNutritionMisses(logs)
      
      expect(result).not.toBeNull()
      expect(result?.type).toBe('nutrition_missed')
      expect(result?.severity).toBe('medium')
      expect(result?.affectedDays).toHaveLength(3)
    })

    it('should not trigger for non-consecutive misses', () => {
      const logs: DailyLog[] = [
        { id: '1', clientId: 'c1', date: '2024-01-01', nutritionAdherence: 'missed', createdAt: '', updatedAt: '' },
        { id: '2', clientId: 'c1', date: '2024-01-02', nutritionAdherence: 'hit', createdAt: '', updatedAt: '' },
        { id: '3', clientId: 'c1', date: '2024-01-03', nutritionAdherence: 'missed', createdAt: '', updatedAt: '' },
        { id: '4', clientId: 'c1', date: '2024-01-04', nutritionAdherence: 'missed', createdAt: '', updatedAt: '' },
      ]

      const result = evaluateNutritionMisses(logs)
      expect(result).toBeNull()
    })

    it('should NOT trigger when nutrition misses are followed by hits', () => {
      const logs: DailyLog[] = [
        { id: '1', clientId: 'c1', date: '2024-01-01', nutritionAdherence: 'missed', createdAt: '', updatedAt: '' },
        { id: '2', clientId: 'c1', date: '2024-01-02', nutritionAdherence: 'missed', createdAt: '', updatedAt: '' },
        { id: '3', clientId: 'c1', date: '2024-01-03', nutritionAdherence: 'missed', createdAt: '', updatedAt: '' },
        // Recovery - nutrition back on track
        { id: '4', clientId: 'c1', date: '2024-01-04', nutritionAdherence: 'hit', createdAt: '', updatedAt: '' },
        { id: '5', clientId: 'c1', date: '2024-01-05', nutritionAdherence: 'hit', createdAt: '', updatedAt: '' },
        { id: '6', clientId: 'c1', date: '2024-01-06', nutritionAdherence: 'partial', createdAt: '', updatedAt: '' },
      ]

      const result = evaluateNutritionMisses(logs)
      expect(result).toBeNull()
    })
  })

  describe('evaluateHighStress', () => {
    it('should detect 3 consecutive days of high stress (8+)', () => {
      const logs: DailyLog[] = [
        { id: '1', clientId: 'c1', date: '2024-01-01', stress: 5, createdAt: '', updatedAt: '' },
        { id: '2', clientId: 'c1', date: '2024-01-02', stress: 8, createdAt: '', updatedAt: '' },
        { id: '3', clientId: 'c1', date: '2024-01-03', stress: 9, createdAt: '', updatedAt: '' },
        { id: '4', clientId: 'c1', date: '2024-01-04', stress: 8, createdAt: '', updatedAt: '' },
      ]

      const result = evaluateHighStress(logs)
      
      expect(result).not.toBeNull()
      expect(result?.type).toBe('high_stress')
      expect(result?.severity).toBe('high')
      expect(result?.affectedDays).toHaveLength(3)
    })

    it('should not trigger for stress below 8', () => {
      const logs: DailyLog[] = [
        { id: '1', clientId: 'c1', date: '2024-01-01', stress: 7, createdAt: '', updatedAt: '' },
        { id: '2', clientId: 'c1', date: '2024-01-02', stress: 7, createdAt: '', updatedAt: '' },
        { id: '3', clientId: 'c1', date: '2024-01-03', stress: 7, createdAt: '', updatedAt: '' },
      ]

      const result = evaluateHighStress(logs)
      expect(result).toBeNull()
    })

    it('should NOT trigger when high stress is followed by normal stress', () => {
      const logs: DailyLog[] = [
        { id: '1', clientId: 'c1', date: '2024-01-01', stress: 8, createdAt: '', updatedAt: '' },
        { id: '2', clientId: 'c1', date: '2024-01-02', stress: 9, createdAt: '', updatedAt: '' },
        { id: '3', clientId: 'c1', date: '2024-01-03', stress: 8, createdAt: '', updatedAt: '' },
        // Recovery - stress returns to normal
        { id: '4', clientId: 'c1', date: '2024-01-04', stress: 4, createdAt: '', updatedAt: '' },
        { id: '5', clientId: 'c1', date: '2024-01-05', stress: 3, createdAt: '', updatedAt: '' },
        { id: '6', clientId: 'c1', date: '2024-01-06', stress: 2, createdAt: '', updatedAt: '' },
      ]

      const result = evaluateHighStress(logs)
      expect(result).toBeNull()
    })
  })

  describe('evaluateHabitDropoff', () => {
    it('should detect when completion rate < 50% for 5+ of last 7 days', () => {
      const habits: DailyHabit[] = [
        { id: 'h1', coachId: 'c1', clientId: 'cl1', name: 'Habit 1', isBoolean: true, isActive: true, sortOrder: 0, createdAt: '2024-01-01T00:00:00Z', updatedAt: '' },
        { id: 'h2', coachId: 'c1', clientId: 'cl1', name: 'Habit 2', isBoolean: true, isActive: true, sortOrder: 1, createdAt: '2024-01-01T00:00:00Z', updatedAt: '' },
      ]
      
      const habitLogs: DailyHabitLog[] = [
        // Day 1: 0/2 = 0%
        // Day 2: 0/2 = 0%
        // Day 3: 1/2 = 50%
        { id: 'l1', dailyHabitId: 'h1', clientId: 'cl1', date: '2024-01-03', completed: true, createdAt: '', updatedAt: '' },
        // Day 4: 0/2 = 0%
        // Day 5: 0/2 = 0%
        // Day 6: 2/2 = 100%
        { id: 'l2', dailyHabitId: 'h1', clientId: 'cl1', date: '2024-01-06', completed: true, createdAt: '', updatedAt: '' },
        { id: 'l3', dailyHabitId: 'h2', clientId: 'cl1', date: '2024-01-06', completed: true, createdAt: '', updatedAt: '' },
        // Day 7: 0/2 = 0%
        // Total: 5 days < 50% (days 1,2,4,5,7)
      ]

      const result = evaluateHabitDropoff(habitLogs, habits)
      
      expect(result).not.toBeNull()
      expect(result?.type).toBe('habit_dropoff')
      expect(result?.severity).toBe('medium')
      expect(result?.affectedDays).toHaveLength(5)
    })

    it('should use created_at to determine denominator', () => {
      // Mock today to be a specific date for consistent testing
      const mockToday = new Date('2024-01-10T00:00:00Z')
      const originalDate = global.Date
      global.Date = class extends originalDate {
        constructor(...args: any[]) {
          if (args.length === 0) {
            // @ts-expect-error -- testing with invalid input
            super(mockToday.toISOString())
          } else {
            // @ts-expect-error -- testing with invalid input
            super(...args)
          }
        }
        static now() {
          return mockToday.getTime()
        }
      } as any
      
      const habits: DailyHabit[] = [
        // Habit created 3 days ago (2024-01-07)
        { id: 'h1', coachId: 'c1', clientId: 'cl1', name: 'Habit 1', isBoolean: true, isActive: true, sortOrder: 0, createdAt: '2024-01-07T00:00:00Z', updatedAt: '' },
      ]
      
      const habitLogs: DailyHabitLog[] = [
        // Habit was completed on 2 of the 4 days it existed
        { id: 'l1', dailyHabitId: 'h1', clientId: 'cl1', date: '2024-01-07', completed: true, createdAt: '', updatedAt: '' },
        { id: 'l2', dailyHabitId: 'h1', clientId: 'cl1', date: '2024-01-09', completed: true, createdAt: '', updatedAt: '' },
      ]

      const result = evaluateHabitDropoff(habitLogs, habits)
      
      // Restore original Date
      global.Date = originalDate
      
      // Only 4 days should be considered (Jan 7-10), not 7
      // With 2/4 days having completion (50%), it shouldn't trigger
      expect(result).toBeNull()
    })

    it('should handle no habits or logs', () => {
      const result1 = evaluateHabitDropoff([], [])
      expect(result1).toBeNull()
      
      const habits: DailyHabit[] = [
        { id: 'h1', coachId: 'c1', clientId: 'cl1', name: 'Habit 1', isBoolean: true, isActive: true, sortOrder: 0, createdAt: '2024-01-01T00:00:00Z', updatedAt: '' },
      ]
      const result2 = evaluateHabitDropoff([], habits)
      expect(result2).toBeNull()
    })
  })

  describe('evaluateActivityCalMismatch', () => {
    it('should detect when client eats as if they completed skipped activities', () => {
      // Use recent dates within 28-day window
      const today = new Date()
      const date1 = new Date(today)
      date1.setDate(today.getDate() - 10)
      const date2 = new Date(today)
      date2.setDate(today.getDate() - 5)
      
      const logs: DailyLog[] = [
        {
          id: '1',
          clientId: 'c1',
          date: date1.toISOString().split('T')[0],
          caloriesConsumed: 2400,  // Ate full target despite skipping activity
          targetCalories: 2400,    // Target includes all planned activities
          trainingData: {
            sessionCompleted: true,
            trainingSessionId: 's1',
            trainingSessionName: 'Session 1',
            isAlternativeSession: false,
            activityStatuses: {
              'a1': { completed: false, activityName: 'Running', estimatedCalories: 400 },
              'a2': { completed: true, activityName: 'Walking', estimatedCalories: 100 }
            },
            unplannedActivities: []
          },
          createdAt: '',
          updatedAt: ''
        },
        {
          id: '2',
          clientId: 'c1',
          date: date2.toISOString().split('T')[0],
          caloriesConsumed: 2500,  // Ate full target despite skipping activity
          targetCalories: 2500,    // Target includes all planned activities
          trainingData: {
            sessionCompleted: true,
            trainingSessionId: 's1',
            trainingSessionName: 'Session 1',
            isAlternativeSession: false,
            activityStatuses: {
              'a1': { completed: false, activityName: 'Running', estimatedCalories: 500 },
            },
            unplannedActivities: []
          },
          createdAt: '',
          updatedAt: ''
        }
      ]

      const result = evaluateActivityCalMismatch(logs)
      
      expect(result).not.toBeNull()
      expect(result?.type).toBe('activity_cal_mismatch')
      expect(result?.severity).toBe('high')
      expect(result?.affectedDays).toHaveLength(2)
    })

    it('should properly read .completed field, not use object as truthy check', () => {
      const logs: DailyLog[] = [
        {
          id: '1',
          clientId: 'c1',
          date: '2024-01-01',
          caloriesConsumed: 2000,
          targetCalories: 2000,
          trainingData: {
            sessionCompleted: true,
            trainingSessionId: 's1',
            trainingSessionName: 'Session 1',
            isAlternativeSession: false,
            activityStatuses: {
              // This object exists but completed is false
              'a1': { completed: false, activityName: 'Running', estimatedCalories: 400 },
            },
            unplannedActivities: []
          },
          createdAt: '',
          updatedAt: ''
        }
      ]

      // Client ate exactly their target, didn't account for skipped activity
      // This should NOT trigger because they didn't overeat
      const result = evaluateActivityCalMismatch(logs)
      expect(result).toBeNull()
    })

    it('should not trigger for less than 2 days', () => {
      const logs: DailyLog[] = [
        {
          id: '1',
          clientId: 'c1',
          date: '2024-01-01',
          caloriesConsumed: 2500,
          targetCalories: 2000,
          trainingData: {
            sessionCompleted: true,
            trainingSessionId: 's1',
            trainingSessionName: 'Session 1',
            isAlternativeSession: false,
            activityStatuses: {
              'a1': { completed: false, activityName: 'Running', estimatedCalories: 400 },
            },
            unplannedActivities: []
          },
          createdAt: '',
          updatedAt: ''
        }
      ]

      const result = evaluateActivityCalMismatch(logs)
      expect(result).toBeNull()
    })
  })

  describe('evaluateTrainingMisses', () => {
    it('should detect 2+ missed training sessions in current week', () => {
      // Mock current date to a Wednesday
      const logs: DailyLog[] = [
        {
          id: '1',
          clientId: 'c1',
          date: new Date().toISOString().split('T')[0], // Today
          trainingData: {
            sessionCompleted: false,
            trainingSessionId: 's1',
            trainingSessionName: 'Session 1',
            isAlternativeSession: false,
            activityStatuses: {},
            unplannedActivities: []
          },
          createdAt: '',
          updatedAt: ''
        },
        {
          id: '2',
          clientId: 'c1',
          date: new Date(Date.now() - 86400000).toISOString().split('T')[0], // Yesterday
          trainingData: {
            sessionCompleted: false,
            trainingSessionId: 's2',
            trainingSessionName: 'Session 2',
            isAlternativeSession: false,
            activityStatuses: {},
            unplannedActivities: []
          },
          createdAt: '',
          updatedAt: ''
        }
      ]

      const result = evaluateTrainingMisses(logs, 3) // 3 sessions planned per week
      
      expect(result).not.toBeNull()
      expect(result?.type).toBe('training_missed')
      expect(result?.severity).toBe('high')
      expect(result?.affectedDays).toHaveLength(2)
    })

    it('should not trigger for 1 missed session', () => {
      const logs: DailyLog[] = [
        {
          id: '1',
          clientId: 'c1',
          date: new Date().toISOString().split('T')[0],
          trainingData: {
            sessionCompleted: false,
            trainingSessionId: 's1',
            trainingSessionName: 'Session 1',
            isAlternativeSession: false,
            activityStatuses: {},
            unplannedActivities: []
          },
          createdAt: '',
          updatedAt: ''
        }
      ]

      const result = evaluateTrainingMisses(logs, 3)
      expect(result).toBeNull()
    })

    it('should only count sessions with trainingSessionId set', () => {
      const logs: DailyLog[] = [
        {
          id: '1',
          clientId: 'c1',
          date: new Date().toISOString().split('T')[0],
          trainingData: {
            sessionCompleted: false,
            trainingSessionId: null, // No session was scheduled
            trainingSessionName: null,
            isAlternativeSession: false,
            activityStatuses: {},
            unplannedActivities: []
          },
          createdAt: '',
          updatedAt: ''
        }
      ]

      const result = evaluateTrainingMisses(logs, 3)
      expect(result).toBeNull()
    })
  })

  describe('evaluateActivityCalMismatch', () => {
    it('should not trigger when mismatches are old (none in last 7 days)', () => {
      const now = new Date('2024-01-25')
      const logs: DailyLog[] = [
        // Old mismatches 15+ days ago
        {
          id: '1',
          clientId: 'c1',
          date: '2024-01-05',
          caloriesConsumed: 2500,
          targetCalories: 2500,
          trainingData: {
            sessionCompleted: false,
            trainingSessionId: 'session1',
            trainingSessionName: 'Upper Body',
            isAlternativeSession: false,
            activityStatuses: {
              'activity1': { completed: false, activityName: 'Activity 1', estimatedCalories: 300 }
            },
            unplannedActivities: []
          },
          createdAt: '',
          updatedAt: ''
        },
        {
          id: '2',
          clientId: 'c1',
          date: '2024-01-06',
          caloriesConsumed: 2500,
          targetCalories: 2500,
          trainingData: {
            sessionCompleted: false,
            trainingSessionId: 'session2',
            trainingSessionName: 'Lower Body',
            isAlternativeSession: false,
            activityStatuses: {
              'activity1': { completed: false, activityName: 'Activity 1', estimatedCalories: 250 }
            },
            unplannedActivities: []
          },
          createdAt: '',
          updatedAt: ''
        },
        {
          id: '3',
          clientId: 'c1',
          date: '2024-01-07',
          caloriesConsumed: 2500,
          targetCalories: 2500,
          trainingData: {
            sessionCompleted: false,
            trainingSessionId: 'session3',
            trainingSessionName: 'Core',
            isAlternativeSession: false,
            activityStatuses: {
              'activity1': { completed: false, activityName: 'Activity 1', estimatedCalories: 200 }
            },
            unplannedActivities: []
          },
          createdAt: '',
          updatedAt: ''
        },
        // Recent logs with no mismatches
        {
          id: '4',
          clientId: 'c1',
          date: '2024-01-24',
          caloriesConsumed: 2200,
          targetCalories: 2500,
          trainingData: {
            sessionCompleted: true,
            trainingSessionId: 'session4',
            trainingSessionName: 'Upper Body',
            isAlternativeSession: false,
            activityStatuses: {
              'activity1': { completed: true, activityName: 'Activity 1', estimatedCalories: 300 }
            },
            unplannedActivities: []
          },
          createdAt: '',
          updatedAt: ''
        }
      ]

      const result = evaluateActivityCalMismatch(logs, now)
      expect(result).toBeNull()
    })

    it('should trigger when at least one mismatch is in last 7 days', () => {
      const now = new Date('2024-01-25')
      const logs: DailyLog[] = [
        // Old mismatch
        {
          id: '1',
          clientId: 'c1',
          date: '2024-01-05',
          caloriesConsumed: 2500,
          targetCalories: 2500,
          trainingData: {
            sessionCompleted: false,
            trainingSessionId: 'session1',
            trainingSessionName: 'Upper Body',
            isAlternativeSession: false,
            activityStatuses: {
              'activity1': { completed: false, activityName: 'Activity 1', estimatedCalories: 300 }
            },
            unplannedActivities: []
          },
          createdAt: '',
          updatedAt: ''
        },
        // Another old mismatch
        {
          id: '2',
          clientId: 'c1',
          date: '2024-01-06',
          caloriesConsumed: 2500,
          targetCalories: 2500,
          trainingData: {
            sessionCompleted: false,
            trainingSessionId: 'session2',
            trainingSessionName: 'Lower Body',
            isAlternativeSession: false,
            activityStatuses: {
              'activity1': { completed: false, activityName: 'Activity 1', estimatedCalories: 250 }
            },
            unplannedActivities: []
          },
          createdAt: '',
          updatedAt: ''
        },
        // Recent mismatch (within last 7 days)
        {
          id: '3',
          clientId: 'c1',
          date: '2024-01-20',
          caloriesConsumed: 2500,
          targetCalories: 2500,
          trainingData: {
            sessionCompleted: false,
            trainingSessionId: 'session3',
            trainingSessionName: 'Core',
            isAlternativeSession: false,
            activityStatuses: {
              'activity1': { completed: false, activityName: 'Activity 1', estimatedCalories: 200 }
            },
            unplannedActivities: []
          },
          createdAt: '',
          updatedAt: ''
        }
      ]

      const result = evaluateActivityCalMismatch(logs, now)
      expect(result).not.toBeNull()
      expect(result?.type).toBe('activity_cal_mismatch')
      expect(result?.severity).toBe('high')
      expect(result?.affectedDays).toHaveLength(2) // Limited by ACTIVITY_CAL_MISMATCH_DAY_COUNT
    })

    it('should check the completed field correctly', () => {
      const now = new Date('2024-01-25')
      const logs: DailyLog[] = [
        {
          id: '1',
          clientId: 'c1',
          date: '2024-01-20',
          caloriesConsumed: 2500,
          targetCalories: 2500,
          trainingData: {
            sessionCompleted: false,
            trainingSessionId: 'session1',
            trainingSessionName: 'Upper Body',
            isAlternativeSession: false,
            activityStatuses: {
              'activity1': { completed: true, activityName: 'Activity 1', estimatedCalories: 300 }, // Completed - no mismatch
              'activity2': { completed: false, activityName: 'Activity 2', estimatedCalories: 0 } // Skipped but 0 calories
            },
            unplannedActivities: []
          },
          createdAt: '',
          updatedAt: ''
        }
      ]

      const result = evaluateActivityCalMismatch(logs, now)
      expect(result).toBeNull()
    })
  })
})