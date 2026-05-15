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
} from './daily-logs-service';
import {
  getTodaysTrainingSession,
  getTodaysNutritionTarget,
} from './daily-context-service';
import type { DailyLog } from '@/types/daily-log';

vi.mock('./supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock('./client-portal-service', () => ({
  getClientNutritionTargets: vi.fn(),
}));

vi.mock('./training-event-service', () => ({
  getEventForDate: vi.fn(),
}));

vi.mock('./nutrition-event-service', () => ({
  getNutritionEventForDate: vi.fn(),
}));

import { supabaseAdmin } from './supabase-admin';
import { getEventForDate } from './training-event-service';
import { getNutritionEventForDate } from './nutrition-event-service';

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
    it('upserts log via RPC and returns full row from view', async () => {
      const mockViewRow = {
        id: 'log-123',
        client_id: 'client-456',
        date: '2024-01-15',
        notes: null,
        phase_id: null,
        mood: 4,
        energy: null,
        sleep: null,
        stress: null,
        calories_consumed: 2000,
        protein_g: null,
        carbs_g: null,
        fat_g: null,
        target_calories: 2100,
        target_protein_g: null,
        target_carbs_g: null,
        target_fat_g: null,
        nutrition_adherence: 'partial',
        calorie_surplus_deficit: -100,
        trained: null,
        training_session_id: null,
        training_data: null,
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
      };

      // Mock RPC call
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 'log-123', error: null } as any);
      // Mock view fetch after RPC
      const mockQuery = createMockQuery({ data: mockViewRow, error: null });
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
      expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
        'upsert_daily_log_atomic',
        expect.objectContaining({
          p_client_id: 'client-456',
          p_date: '2024-01-15',
        })
      );
    });

    it('throws error on RPC failure', async () => {
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      } as any);

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
    it('returns training session when event exists for today', async () => {
      vi.mocked(getEventForDate).mockResolvedValue({
        id: 'event-1',
        clientId: 'client-123',
        trainingPlanId: 'plan-1',
        trainingSessionId: 'session-1',
        date: '2024-01-15',
        sessionName: 'Upper Body',
        sessionFocus: null,
        estimatedCalories: 300,
        status: 'scheduled',
        sessionLogId: null,
        isModified: false,
        calorieSurplusPercentage: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      });

      const result = await getTodaysTrainingSession('client-123', '2024-01-15');

      expect(result).toEqual({
        sessionId: 'session-1',
        sessionName: 'Upper Body',
        estimatedCalories: 300,
      });
    });

    it('returns null when no event exists for today', async () => {
      vi.mocked(getEventForDate).mockResolvedValue(null);

      const result = await getTodaysTrainingSession('client-123', '2024-01-15');
      expect(result).toBeNull();
    });

    it('uses event id as sessionId when trainingSessionId is null', async () => {
      vi.mocked(getEventForDate).mockResolvedValue({
        id: 'event-1',
        clientId: 'client-123',
        trainingPlanId: 'plan-1',
        trainingSessionId: null,
        date: '2024-01-15',
        sessionName: 'Custom Session',
        sessionFocus: null,
        estimatedCalories: null,
        status: 'scheduled',
        sessionLogId: null,
        isModified: false,
        calorieSurplusPercentage: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      });

      const result = await getTodaysTrainingSession('client-123', '2024-01-15');

      expect(result).toEqual({
        sessionId: 'event-1',
        sessionName: 'Custom Session',
        estimatedCalories: 0,
      });
    });
  });

  describe('getTodaysNutritionTarget', () => {
    it('returns event-based target when nutrition event exists', async () => {
      const mockEvent = {
        id: 'ne-1',
        clientId: 'client-123',
        nutritionPlanId: 'plan-1',
        date: '2024-01-15',
        dayOfWeek: 'monday',
        baselineCalories: 2000,
        trainingBurnCalories: 200,
        proteinG: 160,
        carbG: 220,
        fatG: 70,
        dietType: 'balanced',
        isTrainingDay: true,
        calorieSurplusPercentage: null,
        status: 'scheduled' as const,
        createdAt: '',
        updatedAt: '',
      };

      vi.mocked(getNutritionEventForDate).mockResolvedValue(mockEvent);

      const mockQuery = createMockQuery({ data: { include_activity_burn: true }, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any);

      const result = await getTodaysNutritionTarget('client-123', '2024-01-15');

      expect(result).not.toBeNull();
      expect(result!.planId).toBe('plan-1');
      expect(result!.includeActivityBurn).toBe(true);
      expect(result!.isTrainingDay).toBe(true);
      expect(getNutritionEventForDate).toHaveBeenCalledWith('client-123', '2024-01-15');
    });

    it('returns null when no nutrition event exists', async () => {
      vi.mocked(getNutritionEventForDate).mockResolvedValue(null);

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