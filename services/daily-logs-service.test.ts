import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateNutritionAdherence,
  calculateCalorieSurplusDeficit,
  calculateStreakFromLogs,
  getDayOfWeekLowercase,
  getDailyLogs,
  getTodayLog,
  calculateStreaks,
  mapRowToDailyLog,
} from './daily-logs-service';
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

vi.mock('./today-service', () => ({
  getClientTodayString: vi.fn().mockResolvedValue('2026-04-08'),
}));

import { supabaseAdmin } from './supabase-admin';
import { getClientTodayString } from './today-service';

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

    // Bugfix (session 3.7): a leading gap resets the current streak to 0. Previously
    // a single isolated older log was reported as a current streak of 1 because the
    // backward scan latched onto the first run it found. These cases were uncovered.
    it('reports current streak 0 when the only log is two days ago', () => {
      const logs: DailyLog[] = [
        { date: '2024-01-13', id: '1' } as DailyLog, // two days before today (01-15)
      ];

      const result = calculateStreakFromLogs(logs, today);
      expect(result.currentStreak).toBe(0);
      expect(result.longestStreak).toBe(1);
    });

    it('reports current streak 0 when the only log is five days ago', () => {
      const logs: DailyLog[] = [
        { date: '2024-01-10', id: '1' } as DailyLog, // five days before today
      ];

      const result = calculateStreakFromLogs(logs, today);
      expect(result.currentStreak).toBe(0);
      expect(result.longestStreak).toBe(1);
    });

    it('crosses a year boundary without breaking a real streak', () => {
      const result = calculateStreakFromLogs(
        [
          { date: '2026-01-01', id: '1' } as DailyLog,
          { date: '2025-12-31', id: '2' } as DailyLog,
          { date: '2025-12-30', id: '3' } as DailyLog,
        ],
        new Date('2026-01-01'),
      );
      expect(result.currentStreak).toBe(3);
      expect(result.longestStreak).toBe(3);
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

  describe('mapRowToDailyLog', () => {
    it('maps a daily_logs_full row to camelCase and null → undefined', () => {
      const row = {
        id: 'log-1',
        client_id: 'c-1',
        date: '2026-05-21',
        notes: null,
        created_at: '2026-05-21T10:00:00Z',
        updated_at: '2026-05-21T11:00:00Z',
        mood: 4,
        energy: null,
        sleep: 7,
        stress: null,
        soreness: 6,
        calories_consumed: 2000,
        protein_g: 150,
        carbs_g: null,
        fat_g: 60,
        target_calories: 2100,
        target_protein_g: 160,
        target_carbs_g: null,
        target_fat_g: null,
        nutrition_adherence: 'partial',
        calorie_surplus_deficit: -100,
        trained: true,
        training_session_id: 'sess-1',
        training_data: null,
      };

      const log = mapRowToDailyLog(row as never);

      expect(log.id).toBe('log-1');
      expect(log.clientId).toBe('c-1');
      expect(log.date).toBe('2026-05-21');
      expect(log.mood).toBe(4);
      expect(log.energy).toBeUndefined();
      expect(log.sleep).toBe(7);
      expect(log.soreness).toBe(6);
      expect(log.caloriesConsumed).toBe(2000);
      expect(log.carbsG).toBeUndefined();
      expect(log.targetCalories).toBe(2100);
      expect(log.targetCarbsG).toBeUndefined();
      expect(log.nutritionAdherence).toBe('partial');
      expect(log.calorieSurplusDeficit).toBe(-100);
      expect(log.trained).toBe(true);
      expect(log.trainingSessionId).toBe('sess-1');
      expect(log.notes).toBeUndefined();
      expect(log.createdAt).toBe('2026-05-21T10:00:00Z');
      expect(log.updatedAt).toBe('2026-05-21T11:00:00Z');
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
    it("returns today's log when exists, querying the client-local today", async () => {
      const mockData = {
        id: 'log-today',
        client_id: 'client-123',
        date: '2026-04-08', // the mocked client-local today
        mood: 5,
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
      };

      const mockQuery = createMockQuery({ data: mockData, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any);

      const result = await getTodayLog('client-123');

      expect(result?.id).toBe('log-today');
      expect(result?.mood).toBe(5);
      // The default date is the CLIENT's local today, not the host clock.
      expect(getClientTodayString).toHaveBeenCalledWith('client-123');
      expect(mockQuery.eq).toHaveBeenCalledWith('date', '2026-04-08');
    });

    it('returns null when no log today', async () => {
      const mockQuery = createMockQuery({ data: null, error: { message: 'Not found' } });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as any);

      const result = await getTodayLog('client-123');
      expect(result).toBeNull();
    });
  });

  describe('calculateStreaks', () => {
    it('calls the get_client_streak RPC with the client-local today + a 365-day window anchored to it', async () => {
      // The mocked client-local today (2026-04-08) diverges from the host
      // clock, so these exact-match assertions fail if the implementation
      // regresses to server time.
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
        data: [{ current_streak: 4, longest_streak: 9 }],
        error: null,
      } as any);

      const result = await calculateStreaks('client-123');

      expect(result).toEqual({ currentStreak: 4, longestStreak: 9 });
      expect(getClientTodayString).toHaveBeenCalledWith('client-123');
      expect(supabaseAdmin.rpc).toHaveBeenCalledWith('get_client_streak', {
        p_client_id: 'client-123',
        p_today: '2026-04-08',
        p_start_date: '2025-04-08',
      });
    });

    it('returns 0/0 when the RPC yields no row', async () => {
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: [], error: null } as any);

      const result = await calculateStreaks('client-123');
      expect(result).toEqual({ currentStreak: 0, longestStreak: 0 });
    });

    it('throws when the RPC errors', async () => {
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
        data: null,
        error: { message: 'boom' },
      } as any);

      await expect(calculateStreaks('client-123')).rejects.toThrow('Failed to calculate streaks: boom');
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