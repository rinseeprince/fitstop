import { describe, it, expect } from 'vitest'
import {
  evaluateMoodEnergyDrop,
  evaluateLoggingGap,
  evaluateNutritionMisses,
  evaluateTrainingMisses,
  evaluatePartialTrainingPattern,
  evaluateHighStress,
  evaluateHighSoreness,
  evaluateHabitDropoff,
  evaluateActivityCalMismatch
} from '@/lib/attention-triggers'
import type { DailyLog } from '@/types/daily-log'
import type { DailyHabit, DailyHabitLog } from '@/types/daily-habit'
import type { TrainingEventRow } from '@/lib/attention-feed-helpers'

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

  describe('evaluateHighSoreness', () => {
    it('should detect 3 consecutive days of high soreness (8+)', () => {
      const logs: DailyLog[] = [
        { id: '1', clientId: 'c1', date: '2024-01-01', soreness: 5, createdAt: '', updatedAt: '' },
        { id: '2', clientId: 'c1', date: '2024-01-02', soreness: 8, createdAt: '', updatedAt: '' },
        { id: '3', clientId: 'c1', date: '2024-01-03', soreness: 9, createdAt: '', updatedAt: '' },
        { id: '4', clientId: 'c1', date: '2024-01-04', soreness: 8, createdAt: '', updatedAt: '' },
      ]

      const result = evaluateHighSoreness(logs)

      expect(result).not.toBeNull()
      expect(result?.type).toBe('high_soreness')
      expect(result?.severity).toBe('high')
      expect(result?.affectedDays).toHaveLength(3)
    })

    it('builds the sparkline slice-then-filter: non-null values among the last 7 entries', () => {
      const logs: DailyLog[] = [
        // No soreness on day 1: sliced into the last-7 window, then filtered out.
        { id: '1', clientId: 'c1', date: '2024-01-01', createdAt: '', updatedAt: '' },
        { id: '2', clientId: 'c1', date: '2024-01-02', soreness: 8, createdAt: '', updatedAt: '' },
        { id: '3', clientId: 'c1', date: '2024-01-03', soreness: 8, createdAt: '', updatedAt: '' },
        { id: '4', clientId: 'c1', date: '2024-01-04', soreness: 8, createdAt: '', updatedAt: '' },
      ]

      const result = evaluateHighSoreness(logs)

      expect(result).not.toBeNull()
      expect(result?.metricData).toHaveLength(3) // 4 entries sliced, 1 filtered
    })

    it('should not trigger for soreness below 8', () => {
      const logs: DailyLog[] = [
        { id: '1', clientId: 'c1', date: '2024-01-01', soreness: 7, createdAt: '', updatedAt: '' },
        { id: '2', clientId: 'c1', date: '2024-01-02', soreness: 7, createdAt: '', updatedAt: '' },
        { id: '3', clientId: 'c1', date: '2024-01-03', soreness: 7, createdAt: '', updatedAt: '' },
      ]

      expect(evaluateHighSoreness(logs)).toBeNull()
    })

    it('should not trigger for only 2 high days', () => {
      const logs: DailyLog[] = [
        { id: '1', clientId: 'c1', date: '2024-01-01', soreness: 5, createdAt: '', updatedAt: '' },
        { id: '2', clientId: 'c1', date: '2024-01-02', soreness: 8, createdAt: '', updatedAt: '' },
        { id: '3', clientId: 'c1', date: '2024-01-03', soreness: 8, createdAt: '', updatedAt: '' },
      ]

      expect(evaluateHighSoreness(logs)).toBeNull()
    })

    it('resets the streak on a no-soreness day (a gap breaks the run, not skipped)', () => {
      // Under skip-semantics this would be a 4-day run ending at the last entry
      // and fire; the real evaluator resets, leaving two 2-day runs -> null.
      const logs: DailyLog[] = [
        { id: '1', clientId: 'c1', date: '2024-01-01', soreness: 8, createdAt: '', updatedAt: '' },
        { id: '2', clientId: 'c1', date: '2024-01-02', soreness: 8, createdAt: '', updatedAt: '' },
        { id: '3', clientId: 'c1', date: '2024-01-03', createdAt: '', updatedAt: '' },
        { id: '4', clientId: 'c1', date: '2024-01-04', soreness: 8, createdAt: '', updatedAt: '' },
        { id: '5', clientId: 'c1', date: '2024-01-05', soreness: 8, createdAt: '', updatedAt: '' },
      ]

      expect(evaluateHighSoreness(logs)).toBeNull()
    })

    it('should NOT trigger when high soreness is followed by recovery', () => {
      const logs: DailyLog[] = [
        { id: '1', clientId: 'c1', date: '2024-01-01', soreness: 8, createdAt: '', updatedAt: '' },
        { id: '2', clientId: 'c1', date: '2024-01-02', soreness: 9, createdAt: '', updatedAt: '' },
        { id: '3', clientId: 'c1', date: '2024-01-03', soreness: 8, createdAt: '', updatedAt: '' },
        { id: '4', clientId: 'c1', date: '2024-01-04', soreness: 4, createdAt: '', updatedAt: '' },
        { id: '5', clientId: 'c1', date: '2024-01-05', soreness: 3, createdAt: '', updatedAt: '' },
        { id: '6', clientId: 'c1', date: '2024-01-06', soreness: 2, createdAt: '', updatedAt: '' },
      ]

      expect(evaluateHighSoreness(logs)).toBeNull()
    })
  })

  describe('evaluateHabitDropoff', () => {
    it('should detect when completion rate < 50% for 5+ of last 7 days', () => {
      const habits: DailyHabit[] = [
        { id: 'h1', coachId: 'c1', clientId: 'cl1', name: 'Habit 1', isBoolean: true, isActive: true, sortOrder: 0, createdAt: '2024-01-01T00:00:00Z', updatedAt: '', effectiveDate: '2024-01-01' },
        { id: 'h2', coachId: 'c1', clientId: 'cl1', name: 'Habit 2', isBoolean: true, isActive: true, sortOrder: 1, createdAt: '2024-01-01T00:00:00Z', updatedAt: '', effectiveDate: '2024-01-01' },
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
            super(mockToday.toISOString())
          } else {
            // @ts-expect-error -- spread args for Date subclass in test
            super(...args)
          }
        }
        static now() {
          return mockToday.getTime()
        }
      } as any
      
      const habits: DailyHabit[] = [
        // Habit created 3 days ago (2024-01-07)
        { id: 'h1', coachId: 'c1', clientId: 'cl1', name: 'Habit 1', isBoolean: true, isActive: true, sortOrder: 0, createdAt: '2024-01-07T00:00:00Z', updatedAt: '', effectiveDate: '2024-01-07' },
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
        { id: 'h1', coachId: 'c1', clientId: 'cl1', name: 'Habit 1', isBoolean: true, isActive: true, sortOrder: 0, createdAt: '2024-01-01T00:00:00Z', updatedAt: '', effectiveDate: '2024-01-01' },
      ]
      const result2 = evaluateHabitDropoff([], habits)
      expect(result2).toBeNull()
    })
  })

  describe('evaluateActivityCalMismatch', () => {
    it('should detect when client eats at target despite uncompleted training events', () => {
      const today = new Date()
      const date1 = new Date(today)
      date1.setDate(today.getDate() - 10)
      const date2 = new Date(today)
      date2.setDate(today.getDate() - 5)
      const date1Str = date1.toISOString().split('T')[0]
      const date2Str = date2.toISOString().split('T')[0]

      const logs: DailyLog[] = [
        { id: '1', clientId: 'c1', date: date1Str, caloriesConsumed: 2400, targetCalories: 2400, createdAt: '', updatedAt: '' },
        { id: '2', clientId: 'c1', date: date2Str, caloriesConsumed: 2500, targetCalories: 2500, createdAt: '', updatedAt: '' },
      ]
      const events: TrainingEventRow[] = [
        { client_id: 'c1', date: date1Str, status: 'skipped', estimated_calories: 400 },
        { client_id: 'c1', date: date2Str, status: 'scheduled', estimated_calories: 500 },
      ]

      const result = evaluateActivityCalMismatch(logs, events)

      expect(result).not.toBeNull()
      expect(result?.type).toBe('activity_cal_mismatch')
      expect(result?.severity).toBe('high')
      expect(result?.affectedDays).toHaveLength(2)
    })

    it('returns the most recent metricData regardless of the order rows arrive in', () => {
      // Regression (2026-07-21): metricData/affectedDays were built by iterating
      // the logs array, so they inherited the query's ORDER BY. When the
      // attention feed flipped daily_logs_full to date DESC, `slice(-7)`
      // silently began returning the OLDEST 7 points. Feeding the same logs in
      // both orders must produce identical output.
      const today = new Date()
      const days = Array.from({ length: 9 }, (_, i) => {
        const d = new Date(today)
        d.setDate(today.getDate() - (i + 1))
        return d.toISOString().split('T')[0]
      })

      const logsAsc: DailyLog[] = [...days].reverse().map((date, i) => ({
        id: String(i), clientId: 'c1', date,
        caloriesConsumed: 2000 + i, targetCalories: 2000 + i,
        createdAt: '', updatedAt: '',
      }))
      const events: TrainingEventRow[] = days.map((date) => ({
        client_id: 'c1', date, status: 'skipped', estimated_calories: 400,
      }))

      const ascResult = evaluateActivityCalMismatch(logsAsc, events)
      const descResult = evaluateActivityCalMismatch([...logsAsc].reverse(), events)

      expect(ascResult?.metricData).toEqual(descResult?.metricData)
      expect(ascResult?.affectedDays).toEqual(descResult?.affectedDays)

      // 9 mismatch days, capped at 7 -> must be the SEVEN MOST RECENT.
      const sevenNewest = [...days].sort().slice(-7)
      expect(ascResult?.metricData?.map((m) => m.date)).toEqual(sevenNewest)
    })

    it('should not trigger when events are completed', () => {
      const today = new Date()
      const date1 = new Date(today)
      date1.setDate(today.getDate() - 5)
      const date1Str = date1.toISOString().split('T')[0]

      const logs: DailyLog[] = [
        { id: '1', clientId: 'c1', date: date1Str, caloriesConsumed: 2400, targetCalories: 2400, createdAt: '', updatedAt: '' },
      ]
      const events: TrainingEventRow[] = [
        { client_id: 'c1', date: date1Str, status: 'completed', estimated_calories: 400 },
      ]

      const result = evaluateActivityCalMismatch(logs, events)
      expect(result).toBeNull()
    })

    it('should not trigger for less than 2 mismatch days', () => {
      const today = new Date()
      const date1 = new Date(today)
      date1.setDate(today.getDate() - 5)
      const date1Str = date1.toISOString().split('T')[0]

      const logs: DailyLog[] = [
        { id: '1', clientId: 'c1', date: date1Str, caloriesConsumed: 2500, targetCalories: 2000, createdAt: '', updatedAt: '' },
      ]
      const events: TrainingEventRow[] = [
        { client_id: 'c1', date: date1Str, status: 'skipped', estimated_calories: 400 },
      ]

      const result = evaluateActivityCalMismatch(logs, events)
      expect(result).toBeNull()
    })

    it('should not trigger when mismatches are old (none in last 7 days)', () => {
      const now = new Date('2024-01-25')
      const logs: DailyLog[] = [
        { id: '1', clientId: 'c1', date: '2024-01-05', caloriesConsumed: 2500, targetCalories: 2500, createdAt: '', updatedAt: '' },
        { id: '2', clientId: 'c1', date: '2024-01-06', caloriesConsumed: 2500, targetCalories: 2500, createdAt: '', updatedAt: '' },
        { id: '3', clientId: 'c1', date: '2024-01-07', caloriesConsumed: 2500, targetCalories: 2500, createdAt: '', updatedAt: '' },
        // Recent log with no mismatch (event completed)
        { id: '4', clientId: 'c1', date: '2024-01-24', caloriesConsumed: 2200, targetCalories: 2500, createdAt: '', updatedAt: '' },
      ]
      const events: TrainingEventRow[] = [
        { client_id: 'c1', date: '2024-01-05', status: 'skipped', estimated_calories: 300 },
        { client_id: 'c1', date: '2024-01-06', status: 'missed', estimated_calories: 250 },
        { client_id: 'c1', date: '2024-01-07', status: 'scheduled', estimated_calories: 200 },
        { client_id: 'c1', date: '2024-01-24', status: 'completed', estimated_calories: 300 },
      ]

      const result = evaluateActivityCalMismatch(logs, events, now)
      expect(result).toBeNull()
    })

    it('should trigger when at least one mismatch is in last 7 days', () => {
      const now = new Date('2024-01-25')
      const logs: DailyLog[] = [
        { id: '1', clientId: 'c1', date: '2024-01-05', caloriesConsumed: 2500, targetCalories: 2500, createdAt: '', updatedAt: '' },
        { id: '2', clientId: 'c1', date: '2024-01-06', caloriesConsumed: 2500, targetCalories: 2500, createdAt: '', updatedAt: '' },
        { id: '3', clientId: 'c1', date: '2024-01-20', caloriesConsumed: 2500, targetCalories: 2500, createdAt: '', updatedAt: '' },
      ]
      const events: TrainingEventRow[] = [
        { client_id: 'c1', date: '2024-01-05', status: 'skipped', estimated_calories: 300 },
        { client_id: 'c1', date: '2024-01-06', status: 'missed', estimated_calories: 250 },
        { client_id: 'c1', date: '2024-01-20', status: 'scheduled', estimated_calories: 200 },
      ]

      const result = evaluateActivityCalMismatch(logs, events, now)
      expect(result).not.toBeNull()
      expect(result?.type).toBe('activity_cal_mismatch')
      expect(result?.severity).toBe('high')
      expect(result?.affectedDays).toHaveLength(2)
    })

    it('should not count events with 0 or null estimated_calories', () => {
      const now = new Date('2024-01-25')
      const logs: DailyLog[] = [
        { id: '1', clientId: 'c1', date: '2024-01-20', caloriesConsumed: 2500, targetCalories: 2500, createdAt: '', updatedAt: '' },
      ]
      const events: TrainingEventRow[] = [
        { client_id: 'c1', date: '2024-01-20', status: 'skipped', estimated_calories: null },
        { client_id: 'c1', date: '2024-01-20', status: 'skipped', estimated_calories: 0 },
      ]

      const result = evaluateActivityCalMismatch(logs, events, now)
      expect(result).toBeNull()
    })
  })

  describe('evaluateTrainingMisses', () => {
    it('should detect 2+ missed training sessions in current week', () => {
      // Wednesday — Mon and Tue events are past, both still scheduled
      const now = new Date('2026-04-01T12:00:00') // Wednesday
      const events: TrainingEventRow[] = [
        { client_id: 'c1', date: '2026-03-30', status: 'scheduled', estimated_calories: 300 }, // Monday
        { client_id: 'c1', date: '2026-03-31', status: 'scheduled', estimated_calories: 300 }, // Tuesday
      ]

      const result = evaluateTrainingMisses(events, now)

      expect(result).not.toBeNull()
      expect(result?.type).toBe('training_missed')
      expect(result?.severity).toBe('high')
      expect(result?.affectedDays).toHaveLength(2)
    })

    it('should not trigger for 1 missed session', () => {
      const now = new Date('2026-04-01T12:00:00') // Wednesday
      const events: TrainingEventRow[] = [
        { client_id: 'c1', date: '2026-03-31', status: 'scheduled', estimated_calories: 300 }, // Tuesday
      ]

      const result = evaluateTrainingMisses(events, now)
      expect(result).toBeNull()
    })

    it('should not count completed events as missed', () => {
      const now = new Date('2026-04-01T12:00:00') // Wednesday
      const events: TrainingEventRow[] = [
        { client_id: 'c1', date: '2026-03-30', status: 'completed', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-31', status: 'completed', estimated_calories: 300 },
      ]

      const result = evaluateTrainingMisses(events, now)
      expect(result).toBeNull()
    })

    it('should not count partial as missed — client showed up', () => {
      const now = new Date('2026-04-01T12:00:00') // Wednesday
      const events: TrainingEventRow[] = [
        { client_id: 'c1', date: '2026-03-30', status: 'partial', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-31', status: 'partial', estimated_calories: 300 },
      ]

      const result = evaluateTrainingMisses(events, now)
      expect(result).toBeNull()
    })

    it('should count skipped as missed — client chose not to do it', () => {
      const now = new Date('2026-04-01T12:00:00') // Wednesday
      const events: TrainingEventRow[] = [
        { client_id: 'c1', date: '2026-03-30', status: 'skipped', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-31', status: 'missed', estimated_calories: 300 },
      ]

      const result = evaluateTrainingMisses(events, now)
      expect(result).not.toBeNull()
      expect(result?.affectedDays).toHaveLength(2)
    })

    it('should exclude today — client may still train later', () => {
      const now = new Date('2026-04-01T12:00:00') // Wednesday
      const events: TrainingEventRow[] = [
        { client_id: 'c1', date: '2026-03-31', status: 'scheduled', estimated_calories: 300 }, // Tuesday (past)
        { client_id: 'c1', date: '2026-04-01', status: 'scheduled', estimated_calories: 300 }, // Today (excluded)
      ]

      // Only 1 past missed event — below threshold of 2
      const result = evaluateTrainingMisses(events, now)
      expect(result).toBeNull()
    })

    it('should use check-in day for week boundary when provided', () => {
      // Wednesday check-in -> training week starts Thursday
      // Set "now" to Monday 2026-03-30
      const now = new Date('2026-03-30T12:00:00')
      const events: TrainingEventRow[] = [
        { client_id: 'c1', date: '2026-03-27', status: 'scheduled', estimated_calories: 300 }, // Friday
        { client_id: 'c1', date: '2026-03-28', status: 'scheduled', estimated_calories: 300 }, // Saturday
      ]

      // With Wednesday checkInDay, week is Thu Mar 26 - Wed Apr 1
      // Both Fri/Sat events are in the current week and past
      const result = evaluateTrainingMisses(events, now, 'wednesday')
      expect(result).not.toBeNull()
      expect(result?.type).toBe('training_missed')
      expect(result?.affectedDays).toHaveLength(2)

      // Without checkInDay (default Mon-Sun), week starts Mon Mar 30
      // Fri/Sat events are in the PREVIOUS week
      const resultDefault = evaluateTrainingMisses(events, now)
      expect(resultDefault).toBeNull()
    })
  })

  describe('evaluatePartialTrainingPattern', () => {
    it('should detect 3+ partials in last 9 resolved events', () => {
      const events: TrainingEventRow[] = [
        { client_id: 'c1', date: '2026-03-20', status: 'completed', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-21', status: 'partial', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-22', status: 'completed', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-23', status: 'partial', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-24', status: 'completed', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-25', status: 'completed', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-26', status: 'completed', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-27', status: 'partial', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-28', status: 'completed', estimated_calories: 300 },
      ]

      const result = evaluatePartialTrainingPattern(events)

      expect(result).not.toBeNull()
      expect(result?.type).toBe('partial_training_pattern')
      expect(result?.severity).toBe('medium')
      expect(result?.affectedDays).toHaveLength(3)
    })

    it('should not fire for 2 partials (below threshold)', () => {
      const events: TrainingEventRow[] = [
        { client_id: 'c1', date: '2026-03-20', status: 'completed', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-21', status: 'partial', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-22', status: 'completed', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-23', status: 'completed', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-24', status: 'completed', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-25', status: 'completed', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-26', status: 'completed', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-27', status: 'partial', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-28', status: 'completed', estimated_calories: 300 },
      ]

      const result = evaluatePartialTrainingPattern(events)
      expect(result).toBeNull()
    })

    it('should not fire with fewer than 9 resolved events (sparse data guard)', () => {
      const events: TrainingEventRow[] = [
        { client_id: 'c1', date: '2026-03-20', status: 'partial', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-21', status: 'partial', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-22', status: 'partial', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-23', status: 'completed', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-24', status: 'completed', estimated_calories: 300 },
      ]

      const result = evaluatePartialTrainingPattern(events)
      expect(result).toBeNull()
    })

    it('should not fire when no partial events exist', () => {
      const events: TrainingEventRow[] = [
        { client_id: 'c1', date: '2026-03-20', status: 'completed', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-21', status: 'completed', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-22', status: 'completed', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-23', status: 'completed', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-24', status: 'completed', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-25', status: 'completed', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-26', status: 'missed', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-27', status: 'skipped', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-28', status: 'completed', estimated_calories: 300 },
      ]

      const result = evaluatePartialTrainingPattern(events)
      expect(result).toBeNull()
    })

    it('should exclude future/today scheduled events from lookback', () => {
      // 7 resolved + 2 scheduled = only 7 resolved, below 9 threshold
      const events: TrainingEventRow[] = [
        { client_id: 'c1', date: '2026-03-20', status: 'partial', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-21', status: 'partial', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-22', status: 'partial', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-23', status: 'completed', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-24', status: 'completed', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-25', status: 'completed', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-03-26', status: 'completed', estimated_calories: 300 },
        // These are scheduled (future/today) — should be excluded from resolved count
        { client_id: 'c1', date: '2026-05-10', status: 'scheduled', estimated_calories: 300 },
        { client_id: 'c1', date: '2026-05-11', status: 'scheduled', estimated_calories: 300 },
      ]

      // Only 7 resolved events, below 9 threshold — should not fire
      const result = evaluatePartialTrainingPattern(events)
      expect(result).toBeNull()
    })
  })
})