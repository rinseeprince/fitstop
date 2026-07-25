import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  recordBodyMetrics,
  getLatestBodyMetrics,
  getBodyMetricsHistory,
} from './body-metrics-service';
import {
  createMockBodyMetricsRow,
} from '@/__tests__/helpers/mock-data-builders';

vi.mock('./supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { supabaseAdmin } from './supabase-admin';

function createMockQuery(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: typeof result) => void) =>
      Promise.resolve(result).then(resolve),
  };
}

describe('Body Metrics Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordBodyMetrics', () => {
    it('inserts body metrics and updates client cache', async () => {
      const mockRow = createMockBodyMetricsRow({
        clientId: 'client-1',
        weight: 180,
        weightUnit: 'lbs',
        bodyFatPercentage: 15,
      });

      const insertQuery = createMockQuery({ data: mockRow, error: null });
      const updateQuery = createMockQuery({ data: null, error: null });

      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table === 'body_metrics') return insertQuery as never;
        if (table === 'clients') return updateQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      const result = await recordBodyMetrics({
        clientId: 'client-1',
        weight: 180,
        weightUnit: 'lbs',
        bodyFatPercentage: 15,
        source: 'check_in',
      });

      expect(result.clientId).toBe(mockRow.client_id);
      expect(result.weight).toBe(180);
      expect(result.bodyFatPercentage).toBe(15);
      expect(insertQuery.insert).toHaveBeenCalled();
      expect(updateQuery.update).toHaveBeenCalled();
    });

    it('records partial data (weight only, no body fat)', async () => {
      const mockRow = createMockBodyMetricsRow({
        clientId: 'client-1',
        weight: 175,
        bodyFatPercentage: null,
      });

      const insertQuery = createMockQuery({ data: mockRow, error: null });
      const updateQuery = createMockQuery({ data: null, error: null });

      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table === 'body_metrics') return insertQuery as never;
        if (table === 'clients') return updateQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      const result = await recordBodyMetrics({
        clientId: 'client-1',
        weight: 175,
        source: 'metrics_api',
      });

      expect(result.weight).toBe(175);
      expect(result.bodyFatPercentage).toBeUndefined();
    });

    it('throws error when insert fails', async () => {
      const insertQuery = createMockQuery({
        data: null,
        error: { message: 'Insert failed' },
      });

      vi.mocked(supabaseAdmin.from).mockReturnValue(insertQuery as never);

      await expect(
        recordBodyMetrics({
          clientId: 'client-1',
          weight: 180,
          source: 'check_in',
        })
      ).rejects.toThrow('Failed to record body metrics: Insert failed');
    });

    describe('optional params (recordedAt / updateClientCache)', () => {
      const FROZEN_NOW = '2026-07-25T10:00:00.000Z';

      beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(FROZEN_NOW));
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      function setupTables(insertRow: unknown) {
        const insertQuery = createMockQuery({ data: insertRow, error: null });
        const cacheQuery = createMockQuery({ data: null, error: null });

        vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
          if (table === 'body_metrics') return insertQuery as never;
          if (table === 'clients') return cacheQuery as never;
          return createMockQuery({ data: null, error: null }) as never;
        });

        return { insertQuery, cacheQuery };
      }

      it('defaults recorded_at to now and runs the cache update when neither param is passed', async () => {
        const mockRow = createMockBodyMetricsRow({
          clientId: 'client-1',
          weight: 80,
          bodyFatPercentage: 18,
          source: 'coach_entry',
          recordedAt: FROZEN_NOW,
          createdAt: FROZEN_NOW,
        });
        const { insertQuery, cacheQuery } = setupTables(mockRow);

        const result = await recordBodyMetrics({
          clientId: 'client-1',
          weight: 80,
          bodyFatPercentage: 18,
          source: 'coach_entry',
        });

        expect(insertQuery.insert).toHaveBeenCalledWith({
          client_id: 'client-1',
          weight: 80,
          weight_unit: null,
          body_fat_percentage: 18,
          bmr: null,
          tdee: null,
          source: 'coach_entry',
          source_id: null,
          recorded_at: FROZEN_NOW,
        });
        expect(cacheQuery.update).toHaveBeenCalledWith({
          current_weight: 80,
          current_body_fat_percentage: 18,
          updated_at: FROZEN_NOW,
        });
        expect(cacheQuery.eq).toHaveBeenCalledWith('id', 'client-1');
        expect(result.recordedAt).toBe(FROZEN_NOW);
      });

      it('passes recordedAt through to the insert while the cache updated_at stays now', async () => {
        const backdated = '2026-07-01T12:00:00.000Z';
        const mockRow = createMockBodyMetricsRow({
          clientId: 'client-1',
          weight: 79,
          recordedAt: backdated,
        });
        const { insertQuery, cacheQuery } = setupTables(mockRow);

        await recordBodyMetrics({
          clientId: 'client-1',
          weight: 79,
          source: 'coach_entry',
          recordedAt: backdated,
        });

        expect(insertQuery.insert).toHaveBeenCalledWith(
          expect.objectContaining({ recorded_at: backdated })
        );
        expect(cacheQuery.update).toHaveBeenCalledWith(
          expect.objectContaining({ updated_at: FROZEN_NOW })
        );
        expect(cacheQuery.update).not.toHaveBeenCalledWith(
          expect.objectContaining({ updated_at: backdated })
        );
      });

      it('skips the clients cache update when updateClientCache is false but still inserts the event', async () => {
        const mockRow = createMockBodyMetricsRow({
          clientId: 'client-1',
          weight: 79,
        });
        const { insertQuery, cacheQuery } = setupTables(mockRow);

        await recordBodyMetrics({
          clientId: 'client-1',
          weight: 79,
          source: 'coach_entry',
          updateClientCache: false,
        });

        expect(insertQuery.insert).toHaveBeenCalledTimes(1);
        expect(cacheQuery.update).not.toHaveBeenCalled();
        expect(supabaseAdmin.from).not.toHaveBeenCalledWith('clients');
      });

      it('only writes provided fields to the cache (weight-only omits current_body_fat_percentage)', async () => {
        const mockRow = createMockBodyMetricsRow({
          clientId: 'client-1',
          weight: 81,
          bodyFatPercentage: null,
        });
        const { cacheQuery } = setupTables(mockRow);

        await recordBodyMetrics({
          clientId: 'client-1',
          weight: 81,
          source: 'check_in',
        });

        // toHaveBeenCalledWith is an exact object match: extra cache keys
        // (current_body_fat_percentage, bmr, tdee) would fail this assertion.
        expect(cacheQuery.update).toHaveBeenCalledWith({
          current_weight: 81,
          updated_at: FROZEN_NOW,
        });
      });
    });
  });

  describe('getLatestBodyMetrics', () => {
    it('returns the most recent body metrics event', async () => {
      const mockRow = createMockBodyMetricsRow({ clientId: 'client-1', weight: 180 });
      const mockQuery = createMockQuery({ data: [mockRow], error: null });

      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      const result = await getLatestBodyMetrics('client-1');

      expect(result).not.toBeNull();
      expect(result!.weight).toBe(180);
      expect(mockQuery.limit).toHaveBeenCalledWith(1);
    });

    it('returns null when no data exists', async () => {
      const mockQuery = createMockQuery({ data: [], error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      const result = await getLatestBodyMetrics('client-1');

      expect(result).toBeNull();
    });

    it('applies requireFields filter for weight', async () => {
      const mockRow = createMockBodyMetricsRow({ weight: 180 });
      const mockQuery = createMockQuery({ data: [mockRow], error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      await getLatestBodyMetrics('client-1', {
        requireFields: ['weight'],
      });

      expect(mockQuery.not).toHaveBeenCalledWith('weight', 'is', null);
    });

    it('applies requireFields with AND logic for multiple fields', async () => {
      const mockRow = createMockBodyMetricsRow({ weight: 180, tdee: 2500 });
      const mockQuery = createMockQuery({ data: [mockRow], error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      await getLatestBodyMetrics('client-1', {
        requireFields: ['weight', 'tdee'],
      });

      expect(mockQuery.not).toHaveBeenCalledWith('weight', 'is', null);
      expect(mockQuery.not).toHaveBeenCalledWith('tdee', 'is', null);
      expect(mockQuery.not).toHaveBeenCalledTimes(2);
    });

    it('returns null when no rows match requireFields filter', async () => {
      const mockQuery = createMockQuery({ data: [], error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      const result = await getLatestBodyMetrics('client-1', {
        requireFields: ['weight'],
      });

      expect(result).toBeNull();
    });
  });

  describe('getBodyMetricsHistory', () => {
    it('returns all body metrics with no options', async () => {
      const rows = [
        createMockBodyMetricsRow({ weight: 180 }),
        createMockBodyMetricsRow({ weight: 182 }),
      ];
      const mockQuery = createMockQuery({ data: rows, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      const result = await getBodyMetricsHistory('client-1');

      expect(result).toHaveLength(2);
      expect(mockQuery.order).toHaveBeenCalledWith('recorded_at', {
        ascending: false,
      });
    });

    it('orders by recorded_at desc then created_at desc (tiebreak) by default', async () => {
      const mockQuery = createMockQuery({ data: [], error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      await getBodyMetricsHistory('client-1');

      expect(mockQuery.order.mock.calls).toEqual([
        ['recorded_at', { ascending: false }],
        ['created_at', { ascending: false }],
      ]);
    });

    it('flips both order calls when ascending: true is passed', async () => {
      const mockQuery = createMockQuery({ data: [], error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      await getBodyMetricsHistory('client-1', { ascending: true });

      expect(mockQuery.order.mock.calls).toEqual([
        ['recorded_at', { ascending: true }],
        ['created_at', { ascending: true }],
      ]);
    });

    it('applies limit option', async () => {
      const mockQuery = createMockQuery({ data: [], error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      await getBodyMetricsHistory('client-1', { limit: 5 });

      expect(mockQuery.limit).toHaveBeenCalledWith(5);
    });

    it('applies date range filters', async () => {
      const mockQuery = createMockQuery({ data: [], error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      await getBodyMetricsHistory('client-1', {
        from: '2024-01-01',
        to: '2024-12-31',
      });

      expect(mockQuery.gte).toHaveBeenCalledWith('recorded_at', '2024-01-01');
      expect(mockQuery.lte).toHaveBeenCalledWith('recorded_at', '2024-12-31');
    });

    it('applies requireFields filters correctly', async () => {
      const mockQuery = createMockQuery({ data: [], error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      await getBodyMetricsHistory('client-1', {
        requireFields: ['weight', 'body_fat_percentage'],
      });

      expect(mockQuery.not).toHaveBeenCalledWith('weight', 'is', null);
      expect(mockQuery.not).toHaveBeenCalledWith(
        'body_fat_percentage',
        'is',
        null
      );
    });

    it('returns empty array when no results', async () => {
      const mockQuery = createMockQuery({ data: [], error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      const result = await getBodyMetricsHistory('client-1');

      expect(result).toEqual([]);
    });

    it('throws error when query fails', async () => {
      const mockQuery = createMockQuery({
        data: null,
        error: { message: 'Query failed' },
      });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      await expect(getBodyMetricsHistory('client-1')).rejects.toThrow(
        'Failed to fetch body metrics history'
      );
    });
  });
});
