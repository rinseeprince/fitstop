import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateNutritionAdherence,
  calculateCalorieSurplusDeficit,
  calculateStreakFromLogs,
  getDayOfWeekLowercase,
  upsertDailyLog,
  getDailyLogs,
  getTodayLog,
  calculateStreaks,
  getTodaysTrainingSession,
  getTodaysPlannedActivities,
  getTodaysNutritionTarget,
} from './daily-logs-service';
import type { DailyLog } from '@/types/daily-log';

vi.mock('./supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock('./client-portal-service', () => ({
  getClientNutritionTargets: vi.fn(),
  getClientTrainingPlan: vi.fn(),
}));

import { supabaseAdmin } from './supabase-admin';
import { getClientNutritionTargets, getClientTrainingPlan } from './client-portal-service';

function createMockQuery(result: { data: unknown; error: unknown }) {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: typeof result) => void) => Promise.resolve(result).then(resolve),
  };

  return mockQuery;
}

describe('Daily Logs Service - Pure Functions', () => {
  describe('calculateNutritionAdherence', () => {
    it('returns "hit" when within 50 calories', () => {
      expect(calculateNutritionAdherence(2000, 2049)).toBe('hit');
      expect(calculateNutritionAdherence(2000, 2050)).toBe('hit');
      expect(calculateNutritionAdherence(2000, 1950)).toBe('hit');
      expect(calculateNutritionAdherence(2000, 1951)).toBe('hit');
    });

    it('returns "partial" when 51-200 calories off', () => {
      expect(calculateNutritionAdherence(2000, 2051)).toBe('partial');
      expect(calculateNutritionAdherence(2000, 2200)).toBe('partial');
      expect(calculateNutritionAdherence(2000, 1949)).toBe('partial');
      expect(calculateNutritionAdherence(2000, 1800)).toBe('partial');
    });

    it('returns "missed" when more than 200 calories off', () => {
      expect(calculateNutritionAdherence(2000, 2201)).toBe('missed');
      expect(calculateNutritionAdherence(2000, 1799)).toBe('missed');
      expect(calculateNutritionAdherence(2000, 2500)).toBe('missed');
    });

    it('returns null when calories not provided', () => {
      expect(calculateNutritionAdherence(undefined, 2000)).toBeNull();
      expect(calculateNutritionAdherence(2000, undefined)).toBeNull();
      expect(calculateNutritionAdherence(undefined, undefined)).toBeNull();
    });
  });

  describe('calculateCalorieSurplusDeficit', () => {
    it('calculates surplus correctly', () => {
      expect(calculateCalorieSurplusDeficit(2200, 2000)).toBe(200);
    });

    it('calculates deficit correctly', () => {
      expect(calculateCalorieSurplusDeficit(1800, 2000)).toBe(-200);
    });

    it('returns null when values not provided', () => {
      expect(calculateCalorieSurplusDeficit(undefined, 2000)).toBeNull();
      expect(calculateCalorieSurplusDeficit(2000, undefined)).toBeNull();
    });
  });

  describe('calculateStreakFromLogs', () => {
    const today = new Date('2024-01-15');

    it('returns 0 for empty logs', () => {
      const result = calculateStreakFromLogs([], today);
      expect(result).toEqual({ currentStreak: 0, longestStreak: 0 });
    });

    it('calculates consecutive days correctly', () => {
      const logs: DailyLog[] = [
        { date: '2024-01-15', id: '1' } as DailyLog, // today
        { date: '2024-01-14', id: '2' } as DailyLog, // yesterday
        { date: '2024-01-13', id: '3' } as DailyLog, // day before
      ];
      
      const result = calculateStreakFromLogs(logs, today);
      expect(result.currentStreak).toBe(3);
      expect(result.longestStreak).toBe(3);
    });

    it('resets streak on gaps', () => {
      const logs: DailyLog[] = [
        { date: '2024-01-15', id: '1' } as DailyLog, // today
        { date: '2024-01-14', id: '2' } as DailyLog, // yesterday
        // gap on 2024-01-13
        { date: '2024-01-12', id: '3' } as DailyLog,
        { date: '2024-01-11', id: '4' } as DailyLog,
      ];
      
      const result = calculateStreakFromLogs(logs, today);
      expect(result.currentStreak).toBe(2);
      expect(result.longestStreak).toBe(2);
    });

    it('starts from yesterday if no log today', () => {
      const logs: DailyLog[] = [
        { date: '2024-01-14', id: '1' } as DailyLog, // yesterday
        { date: '2024-01-13', id: '2' } as DailyLog, // day before
      ];
      
      const result = calculateStreakFromLogs(logs, today);
      expect(result.currentStreak).toBe(2);
    });

    it('calculates longest streak correctly with gaps', () => {
      const logs: DailyLog[] = [
        { date: '2024-01-15', id: '1' } as DailyLog, // current: 1 day
        // gap
        { date: '2024-01-12', id: '2' } as DailyLog, // previous streak: 4 days
        { date: '2024-01-11', id: '3' } as DailyLog,
        { date: '2024-01-10', id: '4' } as DailyLog,
        { date: '2024-01-09', id: '5' } as DailyLog,
      ];
      
      const result = calculateStreakFromLogs(logs, today);
      expect(result.currentStreak).toBe(1);
      expect(result.longestStreak).toBe(4);
    });
  });


  describe('getDayOfWeekLowercase', () => {
    it('returns correct lowercase day names', () => {
      expect(getDayOfWeekLowercase(new Date('2024-01-15'))).toBe('monday'); // Monday
      expect(getDayOfWeekLowercase(new Date('2024-01-16'))).toBe('tuesday'); // Tuesday
      expect(getDayOfWeekLowercase(new Date('2024-01-21'))).toBe('sunday'); // Sunday
    });
  });
});

describe('Daily Logs Service - Database Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('upsertDailyLog', () => {
    it('upserts log with calculated adherence and surplus/deficit', async () => {
      const mockResult = {
        id: 'log-123',
        client_id: 'client-456',
        date: '2024-01-15',
        calories_consumed: 2000,
        target_calories: 2100,
        nutrition_adherence: 'partial',
        calorie_surplus_deficit: -100,
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
      };

      const mockQuery = createMockQuery({ data: mockResult, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any);

      const input = {
        date: '2024-01-15',
        caloriesConsumed: 2000,
        targetCalories: 2100,
        mood: 4,
      } as any;

      const result = await upsertDailyLog('client-456', input);
      
      expect(result.id).toBe('log-123');
      expect(result.calorieSurplusDeficit).toBe(-100);
      expect(mockQuery.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          nutrition_adherence: 'partial',
          calorie_surplus_deficit: -100,
        }),
        { onConflict: 'client_id,date' }
      );
    });

    it('throws error on database failure', async () => {
      const mockQuery = createMockQuery({
        data: null,
        error: { message: 'Database error' },
      });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any);

      await expect(
        upsertDailyLog('client-456', { date: '2024-01-15' })
      ).rejects.toThrow('Failed to upsert daily log: Database error');
    });
  });

  describe('getDailyLogs', () => {
    it('fetches logs in date range', async () => {
      const mockData = [
        {
          id: 'log-1',
          client_id: 'client-123',
          date: '2024-01-15',
          mood: 4,
          created_at: '2024-01-15T10:00:00Z',
          updated_at: '2024-01-15T10:00:00Z',
        },
      ];

      const mockQuery = createMockQuery({ data: mockData, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any);

      const result = await getDailyLogs('client-123', '2024-01-01', '2024-01-31');
      
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('log-1');
      expect(mockQuery.gte).toHaveBeenCalledWith('date', '2024-01-01');
      expect(mockQuery.lte).toHaveBeenCalledWith('date', '2024-01-31');
    });
  });

  describe('getTodayLog', () => {
    it('returns today\'s log when exists', async () => {
      const mockData = {
        id: 'log-today',
        client_id: 'client-123',
        date: new Date().toISOString().split('T')[0],
        mood: 5,
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
      };

      const mockQuery = createMockQuery({ data: mockData, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any);

      const result = await getTodayLog('client-123');
      
      expect(result?.id).toBe('log-today');
      expect(result?.mood).toBe(5);
    });

    it('returns null when no log today', async () => {
      const mockQuery = createMockQuery({ data: null, error: { message: 'Not found' } });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any);

      const result = await getTodayLog('client-123');
      expect(result).toBeNull();
    });
  });

  describe('getTodaysTrainingSession', () => {
    it('returns training session for today\'s day of week', async () => {
      const today = new Date('2024-01-15'); // Monday
      vi.useFakeTimers();
      vi.setSystemTime(today);

      const mockTrainingPlan = {
        sessions: [
          {
            id: 'session-1',
            name: 'Upper Body',
            dayOfWeek: 'monday',
            sessionType: 'training',
            estimatedCalories: 300,
          },
          {
            id: 'session-2',
            name: 'BJJ',
            dayOfWeek: 'monday',
            sessionType: 'external_activity',
            estimatedCalories: 400,
          },
        ],
      };

      vi.mocked(getClientTrainingPlan).mockResolvedValue(mockTrainingPlan as any);

      const result = await getTodaysTrainingSession('client-123');
      
      expect(result).toEqual({
        sessionId: 'session-1',
        sessionName: 'Upper Body',
        estimatedCalories: 300,
      });

      vi.useRealTimers();
    });

    it('returns null when no training session today', async () => {
      const today = new Date('2024-01-15'); // Monday
      vi.useFakeTimers();
      vi.setSystemTime(today);

      const mockTrainingPlan = {
        sessions: [
          {
            id: 'session-1',
            name: 'Upper Body',
            dayOfWeek: 'tuesday',
            sessionType: 'training',
            estimatedCalories: 300,
          },
        ],
      };

      vi.mocked(getClientTrainingPlan).mockResolvedValue(mockTrainingPlan as any);

      const result = await getTodaysTrainingSession('client-123');
      expect(result).toBeNull();

      vi.useRealTimers();
    });

    it('returns null when no training plan', async () => {
      vi.mocked(getClientTrainingPlan).mockResolvedValue(null);

      const result = await getTodaysTrainingSession('client-123');
      expect(result).toBeNull();
    });
  });

  describe('getTodaysPlannedActivities', () => {
    it('returns external activities for today', async () => {
      const today = new Date('2024-01-15'); // Monday
      vi.useFakeTimers();
      vi.setSystemTime(today);

      const mockTrainingPlan = {
        sessions: [
          {
            id: 'activity-1',
            name: 'BJJ',
            dayOfWeek: 'monday',
            sessionType: 'external_activity',
            activityMetadata: { estimatedCalories: 400 },
          },
          {
            id: 'activity-2',
            name: 'Cycling',
            dayOfWeek: 'monday',
            sessionType: 'external_activity',
            activityMetadata: { estimatedCalories: 300 },
          },
          {
            id: 'session-1',
            name: 'Upper Body',
            dayOfWeek: 'monday',
            sessionType: 'training',
            estimatedCalories: 300,
          },
        ],
      };

      vi.mocked(getClientTrainingPlan).mockResolvedValue(mockTrainingPlan as any);

      const result = await getTodaysPlannedActivities('client-123');
      
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        sessionId: 'activity-1',
        activityName: 'BJJ',
        estimatedCalories: 400,
      });
      expect(result[1]).toEqual({
        sessionId: 'activity-2',
        activityName: 'Cycling',
        estimatedCalories: 300,
      });

      vi.useRealTimers();
    });

    it('returns empty array when no activities today', async () => {
      const today = new Date('2024-01-15'); // Monday
      vi.useFakeTimers();
      vi.setSystemTime(today);

      const mockTrainingPlan = {
        sessions: [
          {
            id: 'activity-1',
            name: 'BJJ',
            dayOfWeek: 'tuesday',
            sessionType: 'external_activity',
            estimatedCalories: 400,
          },
        ],
      };

      vi.mocked(getClientTrainingPlan).mockResolvedValue(mockTrainingPlan as any);

      const result = await getTodaysPlannedActivities('client-123');
      expect(result).toEqual([]);

      vi.useRealTimers();
    });
  });

  describe('getTodaysNutritionTarget', () => {
    it('returns nutrition target for today', async () => {
      const today = new Date('2024-01-15'); // Monday
      vi.useFakeTimers();
      vi.setSystemTime(today);

      const mockNutritionTargets = {
        dailyTargets: [
          {
            day: 'monday',
            calories: 2200,
            proteinG: 165,
            carbsG: 220,
            fatG: 73,
          },
          {
            day: 'tuesday',
            calories: 1800,
            proteinG: 165,
            carbsG: 180,
            fatG: 60,
          },
        ],
      };

      vi.mocked(getClientNutritionTargets).mockResolvedValue(mockNutritionTargets as any);

      const result = await getTodaysNutritionTarget('client-123');
      
      expect(result).toEqual({
        day: 'monday',
        calories: 2200,
        proteinG: 165,
        carbsG: 220,
        fatG: 73,
      });

      vi.useRealTimers();
    });

    it('returns null when no nutrition targets', async () => {
      vi.mocked(getClientNutritionTargets).mockResolvedValue(null);

      const result = await getTodaysNutritionTarget('client-123');
      expect(result).toBeNull();
    });

    it('returns null when no daily targets', async () => {
      vi.mocked(getClientNutritionTargets).mockResolvedValue({ dailyTargets: undefined } as any);

      const result = await getTodaysNutritionTarget('client-123');
      expect(result).toBeNull();
    });
  });

  describe('calculateStreaks', () => {
    it('fetches logs and calculates streaks', async () => {
      const mockLogs = [
        { date: '2024-01-15', id: '1' } as DailyLog,
        { date: '2024-01-14', id: '2' } as DailyLog,
      ];

      const mockQuery = createMockQuery({ data: mockLogs, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any);

      const result = await calculateStreaks('client-123');
      
      expect(result.currentStreak).toBeGreaterThanOrEqual(0);
      expect(result.longestStreak).toBeGreaterThanOrEqual(0);
      expect(mockQuery.gte).toHaveBeenCalled();
      expect(mockQuery.lte).toHaveBeenCalled();
    });
  });
});

describe('getDayOfWeekLowercase', () => {
  it('returns correct lowercase day names for each day', () => {
    expect(getDayOfWeekLowercase(new Date('2024-01-14'))).toBe('sunday');
    expect(getDayOfWeekLowercase(new Date('2024-01-15'))).toBe('monday');
    expect(getDayOfWeekLowercase(new Date('2024-01-16'))).toBe('tuesday');
    expect(getDayOfWeekLowercase(new Date('2024-01-17'))).toBe('wednesday');
    expect(getDayOfWeekLowercase(new Date('2024-01-18'))).toBe('thursday');
    expect(getDayOfWeekLowercase(new Date('2024-01-19'))).toBe('friday');
    expect(getDayOfWeekLowercase(new Date('2024-01-20'))).toBe('saturday');
  });
});