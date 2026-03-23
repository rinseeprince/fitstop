import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getCurrentGoals,
  updateGoals,
  getGoalsHistory,
} from './client-goals-service';
import {
  createMockClientGoalsRow,
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
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: typeof result) => void) =>
      Promise.resolve(result).then(resolve),
  };
}

describe('Client Goals Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCurrentGoals', () => {
    it('returns current goals for a client', async () => {
      const mockRow = createMockClientGoalsRow({
        clientId: 'client-1',
        goalWeight: 170,
        primaryGoal: 'weight_loss',
      });
      const mockQuery = createMockQuery({ data: mockRow, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      const result = await getCurrentGoals('client-1');

      expect(result).not.toBeNull();
      expect(result!.goalWeight).toBe(170);
      expect(result!.primaryGoal).toBe('weight_loss');
      expect(mockQuery.is).toHaveBeenCalledWith('superseded_at', null);
    });

    it('returns null when client has no goals', async () => {
      const mockQuery = createMockQuery({ data: null, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      const result = await getCurrentGoals('client-1');

      expect(result).toBeNull();
    });

    it('throws error when query fails', async () => {
      const mockQuery = createMockQuery({
        data: null,
        error: { message: 'DB error' },
      });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      await expect(getCurrentGoals('client-1')).rejects.toThrow(
        'Failed to fetch current goals'
      );
    });
  });

  describe('updateGoals', () => {
    it('supersedes old goals, inserts new row, and dual-writes to clients', async () => {
      const existingRow = createMockClientGoalsRow({
        clientId: 'client-1',
        goalWeight: 170,
        goalDeadline: '2025-06-01',
        primaryGoal: 'weight_loss',
      });

      const newRow = createMockClientGoalsRow({
        clientId: 'client-1',
        goalWeight: 165,
        goalDeadline: '2025-06-01',
        primaryGoal: 'weight_loss',
      });

      // Track which table is being accessed and what operation
      const getCurrentQuery = createMockQuery({ data: existingRow, error: null });
      const supersedeQuery = createMockQuery({ data: null, error: null });
      const insertQuery = createMockQuery({ data: newRow, error: null });
      const clientUpdateQuery = createMockQuery({ data: null, error: null });

      let callCount = 0;
      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table === 'client_goals') {
          callCount++;
          // 1st call: getCurrentGoals (select)
          if (callCount === 1) return getCurrentQuery as never;
          // 2nd call: supersede (update)
          if (callCount === 2) return supersedeQuery as never;
          // 3rd call: insert new
          if (callCount === 3) return insertQuery as never;
        }
        if (table === 'clients') return clientUpdateQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      const result = await updateGoals(
        'client-1',
        { goalWeight: 165 },
        'coach-1'
      );

      expect(result.goalWeight).toBe(newRow.goal_weight);
      // Verify supersede was called
      expect(supersedeQuery.update).toHaveBeenCalled();
      // Verify insert was called
      expect(insertQuery.insert).toHaveBeenCalled();
      // Verify client dual-write
      expect(clientUpdateQuery.update).toHaveBeenCalled();
    });

    it('carries forward unchanged fields from existing goals', async () => {
      const existingRow = createMockClientGoalsRow({
        clientId: 'client-1',
        goalWeight: 170,
        goalDeadline: '2025-06-01',
        primaryGoal: 'muscle_gain',
      });

      const newRow = createMockClientGoalsRow({
        clientId: 'client-1',
        goalWeight: 165,
        goalDeadline: '2025-06-01',
        primaryGoal: 'muscle_gain',
      });

      const getCurrentQuery = createMockQuery({ data: existingRow, error: null });
      const supersedeQuery = createMockQuery({ data: null, error: null });
      const insertQuery = createMockQuery({ data: newRow, error: null });
      const clientUpdateQuery = createMockQuery({ data: null, error: null });

      let callCount = 0;
      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table === 'client_goals') {
          callCount++;
          if (callCount === 1) return getCurrentQuery as never;
          if (callCount === 2) return supersedeQuery as never;
          if (callCount === 3) return insertQuery as never;
        }
        if (table === 'clients') return clientUpdateQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      // Only changing goalWeight, goalDeadline and primaryGoal should carry forward
      await updateGoals('client-1', { goalWeight: 165 }, 'coach-1');

      const insertCallArgs = insertQuery.insert.mock.calls[0][0];
      expect(insertCallArgs.goal_weight).toBe(165);
      expect(insertCallArgs.goal_deadline).toBe('2025-06-01');
      expect(insertCallArgs.primary_goal).toBe('muscle_gain');
    });

    it('handles first-ever goal set (no existing row)', async () => {
      const newRow = createMockClientGoalsRow({
        clientId: 'client-1',
        goalWeight: 170,
      });

      const getCurrentQuery = createMockQuery({ data: null, error: null });
      const insertQuery = createMockQuery({ data: newRow, error: null });
      const clientUpdateQuery = createMockQuery({ data: null, error: null });

      let callCount = 0;
      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table === 'client_goals') {
          callCount++;
          if (callCount === 1) return getCurrentQuery as never;
          // No supersede call - goes straight to insert
          if (callCount === 2) return insertQuery as never;
        }
        if (table === 'clients') return clientUpdateQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      const result = await updateGoals(
        'client-1',
        { goalWeight: 170 },
        'coach-1'
      );

      expect(result).not.toBeNull();
      // Supersede should NOT have been called (no existing row)
      expect(supabaseAdmin.from).toHaveBeenCalledWith('client_goals');
    });
  });

  describe('getGoalsHistory', () => {
    it('returns all goals ordered by effective_from DESC', async () => {
      const rows = [
        createMockClientGoalsRow({ clientId: 'client-1', goalWeight: 165 }),
        createMockClientGoalsRow({ clientId: 'client-1', goalWeight: 170 }),
      ];
      const mockQuery = createMockQuery({ data: rows, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      const result = await getGoalsHistory('client-1');

      expect(result).toHaveLength(2);
      expect(mockQuery.order).toHaveBeenCalledWith('effective_from', {
        ascending: false,
      });
    });

    it('returns empty array when no goals exist', async () => {
      const mockQuery = createMockQuery({ data: [], error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      const result = await getGoalsHistory('client-1');

      expect(result).toEqual([]);
    });
  });
});
