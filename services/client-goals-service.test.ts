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
    rpc: vi.fn(),
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
    // The write is now ONE transactional RPC (migration 139): supersede, insert,
    // and the `clients` mirror update all happen inside
    // `update_client_goals_atomic`. The merge stays in TypeScript, so every merge
    // assertion below reads the RPC's argument object — the payload that used to
    // be the INSERT body. `rpcArgs()` is the single place that knows where the
    // merged row now lives, so a future change to the write shape breaks one
    // helper rather than nine tests.
    function wireUpdate(
      existingRow: unknown,
      opts: { rpcError?: { message: string }; newGoalId?: string | null } = {}
    ) {
      const getCurrentQuery = createMockQuery({ data: existingRow, error: null });
      const readBackQuery = createMockQuery({
        data: createMockClientGoalsRow({ clientId: 'client-1' }),
        error: null,
      });

      let callCount = 0;
      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table !== 'client_goals') {
          throw new Error(`Unexpected from(): ${table}`);
        }
        callCount++;
        // 1 = getCurrentGoals, 2 = the read-back of the row the RPC created.
        return (callCount === 1 ? getCurrentQuery : readBackQuery) as never;
      });

      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
        data: opts.newGoalId === undefined ? 'new-goal-1' : opts.newGoalId,
        error: opts.rpcError ?? null,
      } as never);

      return { getCurrentQuery, readBackQuery };
    }

    const rpcArgs = () =>
      vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as Record<string, unknown>;

    it('sends the whole merged row to the transactional RPC', async () => {
      wireUpdate(
        createMockClientGoalsRow({ clientId: 'client-1', goalWeight: 80, goalBodyFatPercentage: 20 })
      );

      await updateGoals('client-1', { goalWeight: 75 }, 'coach-1');

      expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
        'update_client_goals_atomic',
        expect.objectContaining({ p_client_id: 'client-1', p_set_by: 'coach-1' })
      );
      // Supersede + insert + mirror are one statement inside the function now, so
      // there is no separate `.update()` on client_goals and no `.from("clients")`
      // write to observe. `from` is only reached for the read and the read-back.
      expect(vi.mocked(supabaseAdmin.from).mock.calls.map((c) => c[0])).toEqual([
        'client_goals',
        'client_goals',
      ]);
    });

    it('carries forward unchanged fields from existing goals', async () => {
      wireUpdate(
        createMockClientGoalsRow({
          clientId: 'client-1',
          goalWeight: 80,
          goalBodyFatPercentage: 22,
          goalDeadline: '2026-12-31',
        })
      );

      await updateGoals('client-1', { goalWeight: 75 }, 'coach-1');

      expect(rpcArgs()).toMatchObject({
        p_goal_weight: 75,
        p_goal_body_fat_percentage: 22,
        p_goal_deadline: '2026-12-31',
      });
    });

    it('clears goalDeadline when explicit null is passed', async () => {
      wireUpdate(
        createMockClientGoalsRow({ clientId: 'client-1', goalDeadline: '2026-12-31' })
      );

      await updateGoals('client-1', { goalDeadline: null }, 'coach-1');

      expect(rpcArgs().p_goal_deadline).toBeNull();
    });

    it('carries the sibling forward when a caller sends it as explicit undefined', async () => {
      // The real caller shape (task 1.1): metrics/route.ts and friends build a
      // fixed key set from possibly-undefined fields. Presence alone would NULL
      // the sibling here.
      wireUpdate(
        createMockClientGoalsRow({
          clientId: 'client-1',
          goalWeight: 80,
          goalBodyFatPercentage: 20,
        })
      );

      await updateGoals(
        'client-1',
        { goalWeight: undefined, goalBodyFatPercentage: 22 },
        'coach-1'
      );

      expect(rpcArgs()).toMatchObject({
        p_goal_weight: 80,
        p_goal_body_fat_percentage: 22,
      });
    });

    it('does not null the clients mirror when a caller sends explicit undefined', async () => {
      // Task 1.1 pinned this against the separate mirror UPDATE, which migration
      // 139 moved inside the transaction. The mirror is written from
      // p_goal_weight / p_goal_body_fat_percentage / p_goal_deadline, so
      // asserting those args asserts the mirror payload — the coverage is
      // preserved, not dropped.
      wireUpdate(
        createMockClientGoalsRow({
          clientId: 'client-1',
          goalWeight: 80,
          goalBodyFatPercentage: 20,
        })
      );

      await updateGoals(
        'client-1',
        { goalWeight: undefined, goalBodyFatPercentage: 22 },
        'coach-1'
      );

      expect(rpcArgs().p_goal_weight).toBe(80);
    });

    it('still clears on explicit null alongside a present-undefined sibling', async () => {
      wireUpdate(
        createMockClientGoalsRow({
          clientId: 'client-1',
          goalWeight: 80,
          goalBodyFatPercentage: 20,
        })
      );

      await updateGoals(
        'client-1',
        { goalWeight: undefined, goalBodyFatPercentage: null },
        'coach-1'
      );

      expect(rpcArgs()).toMatchObject({
        p_goal_weight: 80,
        p_goal_body_fat_percentage: null,
      });
    });

    it('persists goalStartDate', async () => {
      wireUpdate(createMockClientGoalsRow({ clientId: 'client-1' }));

      await updateGoals('client-1', { goalStartDate: '2026-08-03' }, 'coach-1');

      expect(rpcArgs().p_goal_start_date).toBe('2026-08-03');
    });

    it('handles first-ever goal set (no existing row)', async () => {
      wireUpdate(null);

      const result = await updateGoals('client-1', { goalWeight: 75 }, 'coach-1');

      expect(result).not.toBeNull();
      expect(rpcArgs()).toMatchObject({ p_goal_weight: 75, p_goal_body_fat_percentage: null });
    });

    it('THROWS when the RPC fails — never returns a half-written goal', async () => {
      // Two RPC-error conventions exist in this codebase; only the throwing one
      // preserves this path's behaviour. app/api/clients/[id]/goals/route.ts
      // catches and returns 500, so logging and returning null here would turn a
      // real failure into a 200 with a broken goal.
      wireUpdate(null, { rpcError: { message: 'deadlock detected' } });

      await expect(updateGoals('client-1', { goalWeight: 75 }, 'coach-1')).rejects.toThrow(
        'Failed to update goals: deadlock detected'
      );
    });

    it('throws when the RPC returns no id', async () => {
      wireUpdate(null, { newGoalId: null });

      await expect(updateGoals('client-1', { goalWeight: 75 }, 'coach-1')).rejects.toThrow(
        /No goal id returned/
      );
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
