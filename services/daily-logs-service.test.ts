import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateNutritionAdherence,
  calculateCalorieSurplusDeficit,
  calculateStreakFromLogs,
  getDailyLogs,
  getTodayLog,
  calculateStreaks,
  assembleDayLog,
  type NutritionLogRow,
  type WellnessLogRow,
} from './daily-logs-service';
import { calculateMetricAverages } from '@/utils/daily-logs-aggregation';
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

// The day's target is the computed day: the readers look it up beside the
// two table reads and derive the DailyLog target fields from it.
vi.mock('./nutrition-days-service', () => ({
  getNutritionTargetsForDateRange: vi.fn().mockResolvedValue(new Map()),
}));

import { supabaseAdmin } from './supabase-admin';
import { getClientTodayString } from './today-service';
import {
  getNutritionTargetsForDateRange,
  type NutritionDayTarget,
} from './nutrition-days-service';

const computedTarget = (date: string, calories: number): NutritionDayTarget => ({
  date,
  calories,
  proteinG: 160,
  carbsG: 210,
  fatG: 65,
  isTrainingDay: false,
  note: null,
});

// One row per table, each with its own stamps: the wellness row written in the
// morning, the food row at midday, so a fold that took one row's stamps shows.
const wellnessRow = (date: string, fields: Partial<WellnessLogRow> = {}): WellnessLogRow => ({
  client_id: 'c-1',
  date,
  mood: null,
  energy: null,
  sleep: null,
  stress: null,
  soreness: null,
  created_at: `${date}T08:00:00+00:00`,
  updated_at: `${date}T08:05:00+00:00`,
  ...fields,
});

const nutritionRow = (date: string, fields: Partial<NutritionLogRow> = {}): NutritionLogRow => ({
  client_id: 'c-1',
  date,
  calories_consumed: null,
  protein_g: null,
  carbs_g: null,
  fat_g: null,
  created_at: `${date}T12:00:00+00:00`,
  updated_at: `${date}T12:30:00+00:00`,
  ...fields,
});

type QueryResult = { data: unknown; error: { message: string } | null };

function createMockQuery(result: QueryResult) {
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
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: QueryResult) => void) => Promise.resolve(result).then(resolve),
  };

  return mockQuery;
}

// The two tables answer separately: `from(table)` hands back that table's query.
function mockTables(results: { wellness_logs: QueryResult; nutrition_logs: QueryResult }) {
  const queries = {
    wellness_logs: createMockQuery(results.wellness_logs),
    nutrition_logs: createMockQuery(results.nutrition_logs),
  };
  vi.mocked(supabaseAdmin.from).mockImplementation(
    ((table: keyof typeof queries) => queries[table]) as never
  );
  return queries;
}

/** The keys a day puts on the wire — `JSON.stringify` drops the undefined ones. */
const wireKeys = (log: DailyLog): string[] => Object.keys(JSON.parse(JSON.stringify(log)) as object);

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

});

// A day is assembled from its wellness row and its food row
// (docs/DAY-SPINE-FLATTEN-PLAN.md §2, rules 2 to 4): one function, the two
// rows in, one day out, its target from the computed day.
describe('assembleDayLog', () => {
  const wellness = wellnessRow('2026-05-21', { mood: 4, sleep: 7, soreness: 6 });
  const nutrition = nutritionRow('2026-05-21', { calories_consumed: 2000, protein_g: 150, fat_g: 60 });

  it('folds a wellness row and a food row on one date into one day, deriving the target fields from the computed day', () => {
    const log = assembleDayLog('c-1', '2026-05-21', wellness, nutrition, computedTarget('2026-05-21', 2100));

    expect(log.clientId).toBe('c-1');
    expect(log.date).toBe('2026-05-21');
    expect(log.mood).toBe(4);
    expect(log.energy).toBeUndefined();
    expect(log.sleep).toBe(7);
    expect(log.soreness).toBe(6);
    expect(log.caloriesConsumed).toBe(2000);
    expect(log.proteinG).toBe(150);
    expect(log.carbsG).toBeUndefined();
    expect(log.fatG).toBe(60);
    expect(log.targetCalories).toBe(2100);
    expect(log.targetProteinG).toBe(160);
    expect(log.targetCarbsG).toBe(210);
    expect(log.targetFatG).toBe(65);
    // |2000 − 2100| = 100 → partial, −100.
    expect(log.nutritionAdherence).toBe('partial');
    expect(log.calorieSurplusDeficit).toBe(-100);
  });

  it("the day's id is its date, and its stamps are the earliest created_at and the latest updated_at of its rows (D3)", () => {
    const log = assembleDayLog(
      'c-1',
      '2026-05-21',
      wellnessRow('2026-05-21', { mood: 4, created_at: '2026-05-21T08:00:00+00:00', updated_at: '2026-05-21T09:30:00+00:00' }),
      nutritionRow('2026-05-21', { calories_consumed: 2000, created_at: '2026-05-21T07:15:00+00:00', updated_at: '2026-05-21T09:00:00+00:00' })
    );

    expect(log.id).toBe('2026-05-21');
    expect(log.createdAt).toBe('2026-05-21T07:15:00+00:00');
    expect(log.updatedAt).toBe('2026-05-21T09:30:00+00:00');
  });

  it("a day with one row takes that row's stamps", () => {
    const log = assembleDayLog('c-1', '2026-05-21', null, nutrition);
    expect(log.id).toBe('2026-05-21');
    expect(log.createdAt).toBe(nutrition.created_at);
    expect(log.updatedAt).toBe(nutrition.updated_at);
  });

  it("puts the day's keys on the wire in the day reader's order, and never the note or the training keys (D1, D2)", () => {
    // Every key set, so the whole order is pinned.
    const log = assembleDayLog(
      'c-1',
      '2026-05-21',
      wellnessRow('2026-05-21', { mood: 4, energy: 8, sleep: 7, stress: 3, soreness: 6 }),
      nutritionRow('2026-05-21', { calories_consumed: 2000, protein_g: 150, carbs_g: 210, fat_g: 60 }),
      computedTarget('2026-05-21', 2100)
    );

    expect(wireKeys(log)).toEqual([
      'id', 'clientId', 'date',
      'mood', 'energy', 'sleep', 'stress', 'soreness',
      'caloriesConsumed', 'proteinG', 'carbsG', 'fatG',
      'targetCalories', 'targetProteinG', 'targetCarbsG', 'targetFatG',
      'nutritionAdherence', 'calorieSurplusDeficit',
      'createdAt', 'updatedAt',
    ]);
  });

  it('a day with only a food row carries no wellness key at all, so the check-in averages skip it', () => {
    const foodOnly = assembleDayLog('c-1', '2026-05-22', null, nutritionRow('2026-05-22', { calories_consumed: 1800 }));
    const scored = assembleDayLog('c-1', '2026-05-21', wellnessRow('2026-05-21', { mood: 4, energy: 8, sleep: 7, stress: 3 }), null);

    expect(wireKeys(foodOnly)).toEqual(['id', 'clientId', 'date', 'caloriesConsumed', 'createdAt', 'updatedAt']);
    // Absent, not null: the averages divide by the days that carry a score.
    expect(calculateMetricAverages([foodOnly, scored])).toEqual(calculateMetricAverages([scored]));
    expect(calculateMetricAverages([foodOnly, scored])).toEqual({ mood: 4, energy: 8, sleep: 7, stress: 3, soreness: undefined });
  });

  it('a day with no computed target carries no target and no verdict', () => {
    const log = assembleDayLog('c-1', '2026-05-21', wellness, nutrition, null);

    expect(log.caloriesConsumed).toBe(2000);
    expect(log.targetCalories).toBeUndefined();
    expect(log.targetProteinG).toBeUndefined();
    expect(log.nutritionAdherence).toBeUndefined();
    expect(log.calorieSurplusDeficit).toBeUndefined();
  });

  it('refuses to make a day out of no row', () => {
    expect(() => assembleDayLog('c-1', '2026-05-21', null, null)).toThrow('at least one row');
  });
});

describe('Daily Logs Service - Database Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getNutritionTargetsForDateRange).mockResolvedValue(new Map());
  });

  describe('getDailyLogs', () => {
    it('reads both tables over the range beside the targets, and lists a date when either table holds a row', async () => {
      const queries = mockTables({
        wellness_logs: {
          data: [wellnessRow('2024-01-14', { mood: 3 }), wellnessRow('2024-01-15', { mood: 4 })],
          error: null,
        },
        nutrition_logs: {
          data: [nutritionRow('2024-01-15', { calories_consumed: 2000 }), nutritionRow('2024-01-16', { calories_consumed: 1900 })],
          error: null,
        },
      });
      vi.mocked(getNutritionTargetsForDateRange).mockResolvedValue(
        new Map([['2024-01-15', computedTarget('2024-01-15', 2100)]])
      );

      const result = await getDailyLogs('c-1', '2024-01-01', '2024-01-31');

      // Three days, in date order: wellness only, both, food only. A date with
      // no row on either table (the rest of January) is not listed.
      expect(result.map((log) => log.date)).toEqual(['2024-01-14', '2024-01-15', '2024-01-16']);
      expect(result[0]).toMatchObject({ id: '2024-01-14', mood: 3 });
      expect(result[0].caloriesConsumed).toBeUndefined();
      expect(result[1]).toMatchObject({ id: '2024-01-15', mood: 4, caloriesConsumed: 2000, targetCalories: 2100, nutritionAdherence: 'partial' });
      expect(result[2]).toMatchObject({ id: '2024-01-16', caloriesConsumed: 1900 });
      expect(result[2].mood).toBeUndefined();

      for (const query of [queries.wellness_logs, queries.nutrition_logs]) {
        expect(query.eq).toHaveBeenCalledWith('client_id', 'c-1');
        expect(query.gte).toHaveBeenCalledWith('date', '2024-01-01');
        expect(query.lte).toHaveBeenCalledWith('date', '2024-01-31');
      }
      expect(getNutritionTargetsForDateRange).toHaveBeenCalledTimes(1);
      expect(getNutritionTargetsForDateRange).toHaveBeenCalledWith('c-1', '2024-01-01', '2024-01-31');
    });

    it('lists nothing when neither table holds a row in the range', async () => {
      mockTables({ wellness_logs: { data: [], error: null }, nutrition_logs: { data: [], error: null } });
      expect(await getDailyLogs('c-1', '2024-01-01', '2024-01-31')).toEqual([]);
    });

    it('throws when a table read fails', async () => {
      mockTables({
        wellness_logs: { data: [], error: null },
        nutrition_logs: { data: null, error: { message: 'boom' } },
      });
      await expect(getDailyLogs('c-1', '2024-01-01', '2024-01-31')).rejects.toThrow('Failed to fetch nutrition logs: boom');
    });
  });

  describe('getTodayLog', () => {
    it("assembles the client-local today from both tables, with the day's computed target", async () => {
      const queries = mockTables({
        wellness_logs: { data: wellnessRow('2026-04-08', { mood: 5 }), error: null },
        nutrition_logs: { data: nutritionRow('2026-04-08', { calories_consumed: 2100 }), error: null },
      });
      vi.mocked(getNutritionTargetsForDateRange).mockResolvedValue(
        new Map([['2026-04-08', computedTarget('2026-04-08', 2100)]])
      );

      const result = await getTodayLog('c-1');

      expect(result?.id).toBe('2026-04-08');
      expect(result?.mood).toBe(5);
      expect(result?.caloriesConsumed).toBe(2100);
      expect(result?.targetCalories).toBe(2100);
      expect(result?.nutritionAdherence).toBe('hit');
      // The default date is the CLIENT's local today, not the host clock.
      expect(getClientTodayString).toHaveBeenCalledWith('c-1');
      for (const query of [queries.wellness_logs, queries.nutrition_logs]) {
        expect(query.eq).toHaveBeenCalledWith('client_id', 'c-1');
        expect(query.eq).toHaveBeenCalledWith('date', '2026-04-08');
        expect(query.maybeSingle).toHaveBeenCalledTimes(1);
      }
      expect(getNutritionTargetsForDateRange).toHaveBeenCalledWith('c-1', '2026-04-08', '2026-04-08');
    });

    it('a day with only a wellness row is still a day', async () => {
      mockTables({
        wellness_logs: { data: wellnessRow('2026-04-08', { energy: 6 }), error: null },
        nutrition_logs: { data: null, error: null },
      });

      const result = await getTodayLog('c-1', '2026-04-08');
      expect(result).toMatchObject({ id: '2026-04-08', energy: 6 });
      expect(result?.caloriesConsumed).toBeUndefined();
    });

    it('returns null when neither table holds a row on the day', async () => {
      mockTables({ wellness_logs: { data: null, error: null }, nutrition_logs: { data: null, error: null } });

      expect(await getTodayLog('c-1')).toBeNull();
    });

    it('throws when a table read fails', async () => {
      mockTables({
        wellness_logs: { data: null, error: { message: 'boom' } },
        nutrition_logs: { data: null, error: null },
      });
      await expect(getTodayLog('c-1')).rejects.toThrow('Failed to fetch wellness log: boom');
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
