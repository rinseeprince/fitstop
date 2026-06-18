import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createPhase,
  activatePhase,
  completePhase,
  getActivePhase,
  updatePhase,
  deletePhase,
  promotePhaseIfReady,
} from './phase-service';
import {
  createMockPhaseRow,
  createMockRoadmapRow,
} from '@/__tests__/helpers/mock-data-builders';

vi.mock('./supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock('./client-goals-service', () => ({
  getCurrentGoals: vi.fn(),
}));

vi.mock('./today-service', () => ({
  getClientTodayString: vi.fn().mockResolvedValue('2026-06-15'),
}));

import { supabaseAdmin } from './supabase-admin';
import { getCurrentGoals } from './client-goals-service';

function createMockQuery(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
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

describe('Phase Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createPhase', () => {
    it('creates phase with goals snapshot', async () => {
      const mockRoadmap = createMockRoadmapRow({
        id: 'roadmap-1',
        clientId: 'client-1',
      });
      const mockPhase = createMockPhaseRow({
        roadmapId: 'roadmap-1',
        clientId: 'client-1',
        name: 'Cutting Phase',
        phaseGoalsSnapshot: { goalWeight: 170, primaryGoal: 'weight_loss' },
      });

      vi.mocked(getCurrentGoals).mockResolvedValue({
        id: 'goal-1',
        clientId: 'client-1',
        goalWeight: 170,
        primaryGoal: 'weight_loss',
        setBy: 'coach-1',
        effectiveFrom: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const roadmapQuery = createMockQuery({
        data: { client_id: mockRoadmap.client_id },
        error: null,
      });
      const insertQuery = createMockQuery({ data: mockPhase, error: null });

      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table === 'roadmaps') return roadmapQuery as never;
        if (table === 'phases') return insertQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      const result = await createPhase('roadmap-1', {
        name: 'Cutting Phase',
      });

      expect(result.name).toBe('Cutting Phase');
      expect(getCurrentGoals).toHaveBeenCalledWith('client-1');
      // Verify snapshot was included in insert
      const insertCallArgs = insertQuery.insert.mock.calls[0][0];
      expect(insertCallArgs.phase_goals_snapshot).toEqual({
        goalWeight: 170,
        goalBodyFatPercentage: undefined,
        goalDeadline: undefined,
        primaryGoal: 'weight_loss',
      });
    });

    it('creates phase without goals when none exist', async () => {
      const mockPhase = createMockPhaseRow({
        roadmapId: 'roadmap-1',
        clientId: 'client-1',
        name: 'Phase 1',
      });

      vi.mocked(getCurrentGoals).mockResolvedValue(null);

      const roadmapQuery = createMockQuery({
        data: { client_id: 'client-1' },
        error: null,
      });
      const insertQuery = createMockQuery({ data: mockPhase, error: null });

      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table === 'roadmaps') return roadmapQuery as never;
        if (table === 'phases') return insertQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      const result = await createPhase('roadmap-1', { name: 'Phase 1' });

      expect(result.name).toBe('Phase 1');
      const insertCallArgs = insertQuery.insert.mock.calls[0][0];
      expect(insertCallArgs.phase_goals_snapshot).toBeNull();
    });
  });

  describe('activatePhase', () => {
    it('activates a phase when no other phase is active', async () => {
      const mockPhase = createMockPhaseRow({
        id: 'phase-1',
        roadmapId: 'roadmap-1',
        status: 'planned',
      });
      const activatedPhase = createMockPhaseRow({
        id: 'phase-1',
        roadmapId: 'roadmap-1',
        status: 'active',
      });

      const fetchQuery = createMockQuery({ data: mockPhase, error: null });
      const activeCheckQuery = createMockQuery({ data: [], error: null });
      const updateQuery = createMockQuery({
        data: activatedPhase,
        error: null,
      });

      let phaseCallCount = 0;
      vi.mocked(supabaseAdmin.from).mockImplementation(() => {
        phaseCallCount++;
        if (phaseCallCount === 1) return fetchQuery as never;
        if (phaseCallCount === 2) return activeCheckQuery as never;
        return updateQuery as never;
      });

      const result = await activatePhase('phase-1', 'client-1');

      expect(result.status).toBe('active');
    });

    it('throws "Phase not found" when client_id does not match (IDOR)', async () => {
      const fetchQuery = createMockQuery({ data: null, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(fetchQuery as never);

      await expect(
        activatePhase('phase-1', 'wrong-client')
      ).rejects.toThrow('Phase not found');
    });

    it('throws error when another phase is already active', async () => {
      const mockPhase = createMockPhaseRow({
        id: 'phase-2',
        roadmapId: 'roadmap-1',
        status: 'planned',
      });

      const fetchQuery = createMockQuery({ data: mockPhase, error: null });
      const activeCheckQuery = createMockQuery({
        data: [{ id: 'phase-1' }],
        error: null,
      });

      let phaseCallCount = 0;
      vi.mocked(supabaseAdmin.from).mockImplementation(() => {
        phaseCallCount++;
        if (phaseCallCount === 1) return fetchQuery as never;
        return activeCheckQuery as never;
      });

      await expect(activatePhase('phase-2', 'client-1')).rejects.toThrow(
        'Another phase is currently active'
      );
    });
  });

  describe('completePhase', () => {
    it('throws "Phase not found" when client_id does not match (IDOR)', async () => {
      const fetchQuery = createMockQuery({ data: null, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(fetchQuery as never);

      await expect(
        completePhase('phase-1', 'wrong-client')
      ).rejects.toThrow('Phase not found');
    });

    it('sets end_date when not already set', async () => {
      const mockPhase = createMockPhaseRow({
        id: 'phase-1',
        status: 'active',
        endDate: null,
      });
      const completedPhase = createMockPhaseRow({
        id: 'phase-1',
        status: 'completed',
      });

      const fetchQuery = createMockQuery({ data: mockPhase, error: null });
      const updateQuery = createMockQuery({
        data: completedPhase,
        error: null,
      });

      let callCount = 0;
      vi.mocked(supabaseAdmin.from).mockImplementation(() => {
        callCount++;
        if (callCount === 1) return fetchQuery as never;
        return updateQuery as never;
      });

      const result = await completePhase('phase-1', 'client-1');

      expect(result.status).toBe('completed');
      // Verify end_date was set (since original was null)
      const updateCallArgs = updateQuery.update.mock.calls[0][0];
      expect(updateCallArgs.end_date).toBeDefined();
      expect(updateCallArgs.status).toBe('completed');
    });

    it('preserves existing end_date', async () => {
      const existingEndDate = '2025-03-01T00:00:00.000Z';
      const mockPhase = createMockPhaseRow({
        id: 'phase-1',
        status: 'active',
        endDate: existingEndDate,
      });
      const completedPhase = createMockPhaseRow({
        id: 'phase-1',
        status: 'completed',
        endDate: existingEndDate,
      });

      const fetchQuery = createMockQuery({ data: mockPhase, error: null });
      const updateQuery = createMockQuery({
        data: completedPhase,
        error: null,
      });

      let callCount = 0;
      vi.mocked(supabaseAdmin.from).mockImplementation(() => {
        callCount++;
        if (callCount === 1) return fetchQuery as never;
        return updateQuery as never;
      });

      await completePhase('phase-1', 'client-1');

      const updateCallArgs = updateQuery.update.mock.calls[0][0];
      expect(updateCallArgs.end_date).toBe(existingEndDate);
    });
  });

  describe('getActivePhase', () => {
    it('returns active phase for client', async () => {
      const mockPhase = createMockPhaseRow({
        clientId: 'client-1',
        status: 'active',
      });

      const roadmapQuery = createMockQuery({
        data: { id: 'roadmap-1' },
        error: null,
      });
      const phaseQuery = createMockQuery({ data: mockPhase, error: null });

      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table === 'roadmaps') return roadmapQuery as never;
        if (table === 'phases') return phaseQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      const result = await getActivePhase('client-1');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('active');
    });

    it('returns null when no active roadmap exists', async () => {
      const roadmapQuery = createMockQuery({ data: null, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(roadmapQuery as never);

      const result = await getActivePhase('client-1');

      expect(result).toBeNull();
    });
  });

  describe('updatePhase', () => {
    it('applies partial field updates', async () => {
      const mockPhase = createMockPhaseRow({
        id: 'phase-1',
        name: 'Updated Phase',
        description: 'New description',
      });
      const mockQuery = createMockQuery({ data: mockPhase, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      const result = await updatePhase('phase-1', 'client-1', {
        name: 'Updated Phase',
        description: 'New description',
      });

      expect(result.name).toBe('Updated Phase');
      expect(mockQuery.update).toHaveBeenCalled();
    });

    it('throws "Phase not found" when client_id does not match (IDOR)', async () => {
      const mockQuery = createMockQuery({ data: null, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      await expect(
        updatePhase('phase-1', 'wrong-client', { name: 'Hacked' })
      ).rejects.toThrow('Phase not found');
    });

    it('does not allow status changes via updatePhase', async () => {
      const mockPhase = createMockPhaseRow({ id: 'phase-1' });
      const mockQuery = createMockQuery({ data: mockPhase, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      // Pass status-like data but it should be ignored
      await updatePhase('phase-1', 'client-1', { name: 'Updated' });

      const updateCallArgs = mockQuery.update.mock.calls[0][0];
      expect(updateCallArgs.status).toBeUndefined();
    });

    it('allows goal edits when phase status is planned', async () => {
      const statusQuery = createMockQuery({ data: { status: 'planned' }, error: null });
      const updateResult = createMockPhaseRow({
        id: 'phase-1',
        phaseGoalWeight: 75,
        phaseGoalBodyFatPercentage: 15,
      });
      const updateQuery = createMockQuery({ data: updateResult, error: null });
      vi.mocked(supabaseAdmin.from)
        .mockReturnValueOnce(statusQuery as never)
        .mockReturnValueOnce(updateQuery as never);

      const result = await updatePhase('phase-1', 'client-1', {
        phaseGoalWeight: 75,
        phaseGoalBodyFatPercentage: 15,
      });

      expect(result.phaseGoalWeight).toBe(75);
      expect(result.phaseGoalBodyFatPercentage).toBe(15);
    });

    it('allows goal edits when phase status is active', async () => {
      const statusQuery = createMockQuery({ data: { status: 'active' }, error: null });
      const updateResult = createMockPhaseRow({
        id: 'phase-1',
        phaseGoalWeight: 80,
        phaseGoalBodyFatPercentage: 14,
      });
      const updateQuery = createMockQuery({ data: updateResult, error: null });
      vi.mocked(supabaseAdmin.from)
        .mockReturnValueOnce(statusQuery as never)
        .mockReturnValueOnce(updateQuery as never);

      const result = await updatePhase('phase-1', 'client-1', {
        phaseGoalWeight: 80,
        phaseGoalBodyFatPercentage: 14,
      });

      expect(result.phaseGoalWeight).toBe(80);
      expect(result.phaseGoalBodyFatPercentage).toBe(14);
    });

    it('throws when editing goals on a completed phase', async () => {
      const statusQuery = createMockQuery({ data: { status: 'completed' }, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValueOnce(statusQuery as never);

      await expect(
        updatePhase('phase-1', 'client-1', { phaseGoalBodyFatPercentage: 12 })
      ).rejects.toThrow('Phase goals can only be edited while the phase is planned or active');
    });

    it('throws when editing goals on a skipped phase', async () => {
      const statusQuery = createMockQuery({ data: { status: 'skipped' }, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValueOnce(statusQuery as never);

      await expect(
        updatePhase('phase-1', 'client-1', { phaseGoalWeight: 70 })
      ).rejects.toThrow('Phase goals can only be edited while the phase is planned or active');
    });

    it('allows non-goal field updates on active phases (guard only applies to goal fields)', async () => {
      const mockPhaseRenamed = createMockPhaseRow({ id: 'phase-1', name: 'Renamed' });
      const mockQueryRenamed = createMockQuery({ data: mockPhaseRenamed, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQueryRenamed as never);

      const result = await updatePhase('phase-1', 'client-1', { name: 'Renamed' });

      expect(result.name).toBe('Renamed');
      expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
    });

    it('rejects entire mixed payload (goal + non-goal fields) on a completed phase', async () => {
      const statusQuery = createMockQuery({ data: { status: 'completed' }, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValueOnce(statusQuery as never);

      await expect(
        updatePhase('phase-1', 'client-1', { name: 'Updated', phaseGoalWeight: 75 })
      ).rejects.toThrow('Phase goals can only be edited while the phase is planned or active');
    });
  });

  describe('deletePhase', () => {
    it('deletes planned phase after unlinking plans', async () => {
      const mockPhase = createMockPhaseRow({
        id: 'phase-1',
        status: 'planned',
      });

      const fetchQuery = createMockQuery({ data: mockPhase, error: null });
      const unlinkQuery = createMockQuery({ data: null, error: null });
      const deleteQuery = createMockQuery({ data: null, error: null });

      let phaseCallCount = 0;
      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table === 'phases') {
          phaseCallCount++;
          if (phaseCallCount === 1) return fetchQuery as never;
          return deleteQuery as never;
        }
        // training_plans, nutrition_plans, daily_habits unlinks
        return unlinkQuery as never;
      });

      await deletePhase('phase-1', 'client-1');

      // Verify unlinking happened for all three tables
      expect(supabaseAdmin.from).toHaveBeenCalledWith('training_plans');
      expect(supabaseAdmin.from).toHaveBeenCalledWith('nutrition_plans');
      expect(supabaseAdmin.from).toHaveBeenCalledWith('daily_habits');
      // Verify phase was deleted
      expect(deleteQuery.delete).toHaveBeenCalled();
    });

    it('throws "Phase not found" when client_id does not match (IDOR)', async () => {
      const fetchQuery = createMockQuery({ data: null, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(fetchQuery as never);

      await expect(
        deletePhase('phase-1', 'wrong-client')
      ).rejects.toThrow('Phase not found');
    });

    it('throws error for active phase', async () => {
      const mockPhase = createMockPhaseRow({
        id: 'phase-1',
        status: 'active',
      });
      const fetchQuery = createMockQuery({ data: mockPhase, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(fetchQuery as never);

      await expect(deletePhase('phase-1', 'client-1')).rejects.toThrow(
        'This phase has been started or completed and cannot be deleted.'
      );
    });

    it('throws error for completed phase', async () => {
      const mockPhase = createMockPhaseRow({
        id: 'phase-1',
        status: 'completed',
      });
      const fetchQuery = createMockQuery({ data: mockPhase, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(fetchQuery as never);

      await expect(deletePhase('phase-1', 'client-1')).rejects.toThrow(
        'This phase has been started or completed and cannot be deleted.'
      );
    });
  });

  describe('overlap guard', () => {
    it('createPhase rejects a dated phase that overlaps a dated sibling', async () => {
      vi.mocked(getCurrentGoals).mockResolvedValue(null);
      const roadmapQuery = createMockQuery({ data: { client_id: 'client-1' }, error: null });
      // Sibling runs Jan 1 - Mar 1; the new phase Feb 1 - Apr 1 overlaps it.
      const siblingsQuery = createMockQuery({
        data: [{ id: 'sib-1', name: 'Base', start_date: '2026-01-01', end_date: '2026-03-01' }],
        error: null,
      });
      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table === 'roadmaps') return roadmapQuery as never;
        return siblingsQuery as never;
      });

      await expect(
        createPhase('roadmap-1', { name: 'Cut', startDate: '2026-02-01', endDate: '2026-04-01' })
      ).rejects.toThrow('overlap');
    });

    it('updatePhase rejects a date edit that overlaps a dated sibling', async () => {
      // 1st phases call: fetch the edited phase; 2nd: the sibling set.
      const phaseFetch = createMockQuery({
        data: { roadmap_id: 'roadmap-1', start_date: '2026-05-01', end_date: '2026-06-01' },
        error: null,
      });
      const siblingsQuery = createMockQuery({
        data: [{ id: 'sib-1', name: 'Base', start_date: '2026-01-01', end_date: '2026-03-01' }],
        error: null,
      });
      let call = 0;
      vi.mocked(supabaseAdmin.from).mockImplementation(() => {
        call++;
        return call === 1 ? (phaseFetch as never) : (siblingsQuery as never);
      });

      // Moving start to Feb 15 (end stays Jun 1) now overlaps the Jan-Mar sibling.
      await expect(
        updatePhase('phase-1', 'client-1', { startDate: '2026-02-15' })
      ).rejects.toThrow('overlap');
    });
  });

  describe('completePhase start guard', () => {
    it('rejects completing a phase that has not started yet', async () => {
      // clientToday mock = 2026-06-15; this phase starts in December.
      const mockPhase = createMockPhaseRow({
        id: 'phase-1',
        status: 'planned',
        startDate: '2026-12-01',
        endDate: null,
      });
      const fetchQuery = createMockQuery({ data: mockPhase, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(fetchQuery as never);

      await expect(completePhase('phase-1', 'client-1')).rejects.toThrow(
        "hasn't started yet"
      );
    });
  });

  describe('promotePhaseIfReady', () => {
    it('auto-activates the earliest due planned phase when none is active', async () => {
      const roadmapQuery = createMockQuery({ data: { id: 'roadmap-1' }, error: null });
      const activeCheck = createMockQuery({ data: null, error: null });
      const dueQuery = createMockQuery({ data: { id: 'phase-due' }, error: null });
      const updateQuery = createMockQuery({ data: null, error: null });
      let call = 0;
      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table === 'roadmaps') return roadmapQuery as never;
        call++;
        if (call === 1) return activeCheck as never; // no active phase
        if (call === 2) return dueQuery as never; // earliest due planned phase
        return updateQuery as never; // flip planned -> active
      });

      const result = await promotePhaseIfReady('client-1', '2026-06-15');

      expect(result).toEqual({ promoted: true, phaseId: 'phase-due' });
    });

    it('does not promote when a phase is already active', async () => {
      const roadmapQuery = createMockQuery({ data: { id: 'roadmap-1' }, error: null });
      const activeCheck = createMockQuery({ data: { id: 'phase-active' }, error: null });
      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table === 'roadmaps') return roadmapQuery as never;
        return activeCheck as never;
      });

      const result = await promotePhaseIfReady('client-1', '2026-06-15');

      expect(result).toEqual({ promoted: false });
    });

    it('treats a 23505 activation race (another reader won) as a no-op', async () => {
      const roadmapQuery = createMockQuery({ data: { id: 'roadmap-1' }, error: null });
      const activeCheck = createMockQuery({ data: null, error: null });
      const dueQuery = createMockQuery({ data: { id: 'phase-due' }, error: null });
      const updateQuery = createMockQuery({
        data: null,
        error: { code: '23505', message: 'duplicate key' },
      });
      let call = 0;
      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table === 'roadmaps') return roadmapQuery as never;
        call++;
        if (call === 1) return activeCheck as never;
        if (call === 2) return dueQuery as never;
        return updateQuery as never;
      });

      const result = await promotePhaseIfReady('client-1', '2026-06-15');

      expect(result).toEqual({ promoted: false });
    });
  });
});
