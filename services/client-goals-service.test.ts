import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getCurrentGoals,
  getGoalAsOf,
  updateGoals,
  getGoalsHistory,
} from './client-goals-service';
import {
  createMockClientGoalsRow,
} from '@/__tests__/helpers/mock-data-builders';
import { GOAL_HISTORY_LIMIT } from '@/lib/constants';

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
    not: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
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

    // The ordering belt. Pins the query CHAIN, not real ordering — a mocked
    // builder returns whatever it is handed, so proving the newest row actually
    // wins needs a DB integration test this repo does not have. It still earns
    // its place: the belt's whole job is to be there when the partial unique
    // index is not, and a refactor could drop it with nothing else failing.
    it('orders by effective_from DESC and takes one row', async () => {
      const mockRow = createMockClientGoalsRow({
        clientId: 'client-1',
        goalWeight: 170,
      });
      const mockQuery = createMockQuery({ data: mockRow, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      await getCurrentGoals('client-1');

      expect(mockQuery.order).toHaveBeenCalledWith('effective_from', {
        ascending: false,
      });
      expect(mockQuery.limit).toHaveBeenCalledWith(1);
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

    it('clears goalDeadline when explicit null is passed (presence-based merge)', async () => {
      const existingRow = createMockClientGoalsRow({
        clientId: 'client-1',
        goalWeight: 170,
        goalDeadline: '2026-06-01',
      });
      const newRow = createMockClientGoalsRow({ clientId: 'client-1', goalWeight: 170, goalDeadline: null });

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

      await updateGoals('client-1', { goalDeadline: null }, 'coach-1');

      const insertCallArgs = insertQuery.insert.mock.calls[0][0];
      // null wins over the existing date — `??` would have carried '2026-06-01' forward.
      expect(insertCallArgs.goal_deadline).toBeNull();
      // weight (absent from the payload) carries forward.
      expect(insertCallArgs.goal_weight).toBe(170);
    });

    // All four object-literal callers (intake sync, createClient, updateClient,
    // metrics PUT) send BOTH goal keys, so a single-field edit arrives as
    // `{ goalWeight: undefined, ... }`. Three of them can clobber with it;
    // createClient cannot, because it has no existing row to lose. The 'carries
    // forward unchanged fields' case above passes the key ABSENT, which is why
    // this survived: hasOwnProperty is false for absent but TRUE for
    // present-and-undefined.
    it('carries the sibling forward when a caller sends it as explicit undefined', async () => {
      const existingRow = createMockClientGoalsRow({
        clientId: 'client-1',
        goalWeight: 170,
      });
      const newRow = createMockClientGoalsRow({ clientId: 'client-1', goalWeight: 170 });

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

      // The real caller shape: editing body fat alone via PATCH /api/clients/[id].
      await updateGoals(
        'client-1',
        { goalWeight: undefined, goalBodyFatPercentage: 22 },
        'coach-1'
      );

      const insertCallArgs = insertQuery.insert.mock.calls[0][0];
      expect(insertCallArgs.goal_weight).toBe(170);
      expect(insertCallArgs.goal_body_fat_percentage).toBe(22);
    });

    // The dual-write mirrors `merged` unconditionally, so under the old presence
    // test the clients cache lost the weight in the same request as client_goals —
    // there was no surviving copy to reconcile from.
    it('does not null the clients mirror when a caller sends explicit undefined', async () => {
      const existingRow = createMockClientGoalsRow({
        clientId: 'client-1',
        goalWeight: 170,
      });
      const newRow = createMockClientGoalsRow({ clientId: 'client-1', goalWeight: 170 });

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

      await updateGoals(
        'client-1',
        { goalWeight: undefined, goalBodyFatPercentage: 22 },
        'coach-1'
      );

      const mirrorArgs = clientUpdateQuery.update.mock.calls[0][0];
      expect(mirrorArgs.goal_weight).toBe(170);
      expect(mirrorArgs.goal_body_fat_percentage).toBe(22);
    });

    // Guards the regression the fix could plausibly introduce: null must keep
    // clearing even when a sibling key in the same payload is undefined.
    it('still clears on explicit null alongside a present-undefined sibling', async () => {
      const existingRow = createMockClientGoalsRow({
        clientId: 'client-1',
        goalWeight: 170,
        goalDeadline: '2026-06-01',
      });
      const newRow = createMockClientGoalsRow({
        clientId: 'client-1',
        goalWeight: 170,
        goalDeadline: null,
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

      await updateGoals(
        'client-1',
        { goalWeight: undefined, goalDeadline: null },
        'coach-1'
      );

      const insertCallArgs = insertQuery.insert.mock.calls[0][0];
      expect(insertCallArgs.goal_deadline).toBeNull();
      expect(insertCallArgs.goal_weight).toBe(170);
    });

    it('persists goalStartDate', async () => {
      const existingRow = createMockClientGoalsRow({ clientId: 'client-1', goalWeight: 170 });
      const newRow = createMockClientGoalsRow({ clientId: 'client-1', goalWeight: 170, goalStartDate: '2026-02-01' });

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

      await updateGoals('client-1', { goalStartDate: '2026-02-01' }, 'coach-1');

      const insertCallArgs = insertQuery.insert.mock.calls[0][0];
      expect(insertCallArgs.goal_start_date).toBe('2026-02-01');
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
    it('returns superseded goals ordered by effective_from DESC', async () => {
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

    // Two defects the old `?history=true` branch shipped with, closed by
    // construction when history moved to its own route (Task 0b.6).
    it('excludes the CURRENT goal, which used to come back twice', async () => {
      const mockQuery = createMockQuery({ data: [], error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      await getGoalsHistory('client-1');

      expect(mockQuery.not).toHaveBeenCalledWith('superseded_at', 'is', null);
    });

    it('bounds the result rather than returning every version ever written', async () => {
      const mockQuery = createMockQuery({ data: [], error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      await getGoalsHistory('client-1');
      expect(mockQuery.limit).toHaveBeenCalledWith(GOAL_HISTORY_LIMIT);

      await getGoalsHistory('client-1', { limit: 5 });
      expect(mockQuery.limit).toHaveBeenLastCalledWith(5);
    });

    it('returns empty array when no goals exist', async () => {
      const mockQuery = createMockQuery({ data: [], error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      const result = await getGoalsHistory('client-1');

      expect(result).toEqual([]);
    });
  });
});

describe('getGoalAsOf — the version in force at an instant (commit 8b)', () => {
  const AT = '2026-05-31T12:00:00+00:00';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks for effective_from on or before the instant and no supersede by then, newest first', async () => {
    const row = createMockClientGoalsRow({
      clientId: 'client-1',
      goalWeight: 77,
      goalDeadline: '2026-07-04',
      effectiveFrom: '2026-04-11T09:00:00+00:00',
      supersededAt: '2026-08-27T15:23:50.965+00:00',
    });
    const mockQuery = createMockQuery({ data: row, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

    const result = await getGoalAsOf('client-1', AT);

    expect(result?.goalWeight).toBe(77);
    expect(result?.goalDeadline).toBe('2026-07-04');
    expect(result?.supersededAt).toBe('2026-08-27T15:23:50.965+00:00');
    expect(mockQuery.eq).toHaveBeenCalledWith('client_id', 'client-1');
    // Inclusive at effective_from: a supersede and its successor share one
    // instant, so `<=` on the start and `>` on the end is what makes exactly
    // one version in force at any instant.
    expect(mockQuery.lte).toHaveBeenCalledWith('effective_from', AT);
    expect(mockQuery.or).toHaveBeenCalledWith(`superseded_at.is.null,superseded_at.gt.${AT}`);
    expect(mockQuery.order).toHaveBeenCalledWith('effective_from', { ascending: false });
    expect(mockQuery.limit).toHaveBeenCalledWith(1);
    expect(mockQuery.maybeSingle).toHaveBeenCalled();
  });

  it('returns null when no version was in force then — the review shows no goal', async () => {
    const mockQuery = createMockQuery({ data: null, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

    expect(await getGoalAsOf('client-1', AT)).toBeNull();
  });

  it('refuses a malformed instant before any query — the value reaches a PostgREST .or() predicate', async () => {
    await expect(
      getGoalAsOf('client-1', '2026-05-31T12:00:00+00:00,superseded_at.is.null')
    ).rejects.toThrow(/malformed instant/);

    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it('throws when the query fails', async () => {
    const mockQuery = createMockQuery({ data: null, error: { message: 'DB error' } });
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

    await expect(getGoalAsOf('client-1', AT)).rejects.toThrow(
      'Failed to fetch the goal as of an instant'
    );
  });
});
