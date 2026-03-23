import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createRoadmap,
  getActiveRoadmap,
  getRoadmap,
  updateRoadmap,
  archiveRoadmap,
  deleteRoadmap,
} from './roadmap-service';
import {
  createMockRoadmapRow,
  createMockPhaseRow,
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
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: typeof result) => void) =>
      Promise.resolve(result).then(resolve),
  };
}

describe('Roadmap Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createRoadmap', () => {
    it('creates a roadmap successfully', async () => {
      const mockRow = createMockRoadmapRow({
        clientId: 'client-1',
        coachId: 'coach-1',
        name: 'Q1 Roadmap',
      });

      const checkQuery = createMockQuery({ data: null, error: null });
      const insertQuery = createMockQuery({ data: mockRow, error: null });

      let callCount = 0;
      vi.mocked(supabaseAdmin.from).mockImplementation(() => {
        callCount++;
        if (callCount === 1) return checkQuery as never;
        return insertQuery as never;
      });

      const result = await createRoadmap('client-1', 'coach-1', {
        name: 'Q1 Roadmap',
      });

      expect(result.name).toBe('Q1 Roadmap');
      expect(result.clientId).toBe(mockRow.client_id);
    });

    it('throws error if client already has an active roadmap (app check)', async () => {
      const checkQuery = createMockQuery({
        data: { id: 'existing-roadmap' },
        error: null,
      });

      vi.mocked(supabaseAdmin.from).mockReturnValue(checkQuery as never);

      await expect(
        createRoadmap('client-1', 'coach-1', { name: 'New Roadmap' })
      ).rejects.toThrow('This client already has an active roadmap.');
    });

    it('handles unique constraint violation (race condition)', async () => {
      const checkQuery = createMockQuery({ data: null, error: null });
      const insertQuery = createMockQuery({
        data: null,
        error: { message: 'duplicate key', code: '23505' },
      });

      let callCount = 0;
      vi.mocked(supabaseAdmin.from).mockImplementation(() => {
        callCount++;
        if (callCount === 1) return checkQuery as never;
        return insertQuery as never;
      });

      await expect(
        createRoadmap('client-1', 'coach-1', { name: 'New Roadmap' })
      ).rejects.toThrow('This client already has an active roadmap.');
    });
  });

  describe('getActiveRoadmap', () => {
    it('returns active roadmap with phases', async () => {
      const mockRoadmap = createMockRoadmapRow({
        id: 'roadmap-1',
        clientId: 'client-1',
        status: 'active',
      });
      const mockPhases = [
        createMockPhaseRow({
          roadmapId: 'roadmap-1',
          name: 'Phase 1',
          orderIndex: 0,
        }),
        createMockPhaseRow({
          roadmapId: 'roadmap-1',
          name: 'Phase 2',
          orderIndex: 1,
        }),
      ];

      const roadmapQuery = createMockQuery({ data: mockRoadmap, error: null });
      const phasesQuery = createMockQuery({ data: mockPhases, error: null });

      let callCount = 0;
      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table === 'roadmaps') return roadmapQuery as never;
        if (table === 'phases') return phasesQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      const result = await getActiveRoadmap('client-1');

      expect(result).not.toBeNull();
      expect(result!.name).toBe(mockRoadmap.name);
      expect(result!.phases).toHaveLength(2);
    });

    it('returns null when no active roadmap exists', async () => {
      const mockQuery = createMockQuery({ data: null, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      const result = await getActiveRoadmap('client-1');

      expect(result).toBeNull();
    });
  });

  describe('getRoadmap', () => {
    it('returns roadmap by ID with phases', async () => {
      const mockRoadmap = createMockRoadmapRow({ id: 'roadmap-1' });
      const mockPhases = [createMockPhaseRow({ roadmapId: 'roadmap-1' })];

      const roadmapQuery = createMockQuery({ data: mockRoadmap, error: null });
      const phasesQuery = createMockQuery({ data: mockPhases, error: null });

      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table === 'roadmaps') return roadmapQuery as never;
        if (table === 'phases') return phasesQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      const result = await getRoadmap('roadmap-1');

      expect(result.id).toBe(mockRoadmap.id);
      expect(result.phases).toHaveLength(1);
    });
  });

  describe('updateRoadmap', () => {
    it('applies partial field updates', async () => {
      const mockRow = createMockRoadmapRow({
        id: 'roadmap-1',
        name: 'Updated Name',
      });
      const mockQuery = createMockQuery({ data: mockRow, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      const result = await updateRoadmap('roadmap-1', {
        name: 'Updated Name',
      });

      expect(result.name).toBe('Updated Name');
      expect(mockQuery.update).toHaveBeenCalled();
    });
  });

  describe('archiveRoadmap', () => {
    it('sets status to archived without deleting phases', async () => {
      const mockRow = createMockRoadmapRow({
        id: 'roadmap-1',
        status: 'archived',
      });
      const mockQuery = createMockQuery({ data: mockRow, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never);

      const result = await archiveRoadmap('roadmap-1');

      expect(result.status).toBe('archived');
      // Verify only roadmaps table was touched, not phases
      expect(supabaseAdmin.from).toHaveBeenCalledWith('roadmaps');
      expect(supabaseAdmin.from).not.toHaveBeenCalledWith('phases');
    });
  });

  describe('deleteRoadmap', () => {
    it('deletes roadmap when all phases are planned', async () => {
      const mockPhases = [
        { id: 'phase-1', status: 'planned' },
        { id: 'phase-2', status: 'planned' },
      ];

      const phasesQuery = createMockQuery({ data: mockPhases, error: null });
      const deletePhaseQuery = createMockQuery({ data: null, error: null });
      const deleteRoadmapQuery = createMockQuery({ data: null, error: null });

      let callCount = 0;
      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table === 'phases') {
          callCount++;
          if (callCount === 1) return phasesQuery as never;
          return deletePhaseQuery as never;
        }
        if (table === 'roadmaps') return deleteRoadmapQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      await deleteRoadmap('roadmap-1');

      expect(deletePhaseQuery.delete).toHaveBeenCalled();
      expect(deleteRoadmapQuery.delete).toHaveBeenCalled();
    });

    it('throws error when a phase is completed', async () => {
      const mockPhases = [
        { id: 'phase-1', status: 'planned' },
        { id: 'phase-2', status: 'completed' },
      ];

      const phasesQuery = createMockQuery({ data: mockPhases, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(phasesQuery as never);

      await expect(deleteRoadmap('roadmap-1')).rejects.toThrow(
        'Archive it instead of deleting'
      );
    });

    it('throws error when a phase is active', async () => {
      const mockPhases = [
        { id: 'phase-1', status: 'active' },
      ];

      const phasesQuery = createMockQuery({ data: mockPhases, error: null });
      vi.mocked(supabaseAdmin.from).mockReturnValue(phasesQuery as never);

      await expect(deleteRoadmap('roadmap-1')).rejects.toThrow(
        'Archive it instead of deleting'
      );
    });
  });
});
