import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/require-client-auth', () => ({
  requireClientAuth: vi.fn(),
}));

vi.mock('@/services/client-service', () => ({
  getClientById: vi.fn(),
}));

vi.mock('@/services/check-in-context-service', () => ({
  getCheckInTrainingContext: vi.fn(),
  getCheckInNutritionContext: vi.fn(),
  getCheckInTrainingPeriodStats: vi.fn(),
  getTrainingEventDetailsForPeriod: vi.fn(),
}));

vi.mock('@/services/daily-logs-service', () => ({
  getDailyLogs: vi.fn(),
}));

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock('@/services/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: { name: 'Coach Carter' }, error: null })),
        })),
      })),
    })),
  },
}));

vi.mock('@/lib/date-helpers', async (orig) => {
  const actual = await orig<typeof import('@/lib/date-helpers')>();
  return { ...actual, getCheckInStatus: vi.fn() };
});

import { GET } from './route';
import { requireClientAuth } from '@/lib/require-client-auth';
import { getClientById } from '@/services/client-service';
import {
  getCheckInTrainingContext,
  getCheckInNutritionContext,
  getCheckInTrainingPeriodStats,
  getTrainingEventDetailsForPeriod,
} from '@/services/check-in-context-service';
import { getDailyLogs } from '@/services/daily-logs-service';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { getCheckInStatus } from '@/lib/date-helpers';

const req = () => new NextRequest('https://t.dev/api/client/check-in-context');

// A server-supabase stub whose check_ins query resolves to `lastCheckIn`.
function mockServerSupabase(lastCheckIn: unknown) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: lastCheckIn, error: null })),
            })),
          })),
        })),
      })),
    })),
  } as any);
}

const baseClient = {
  id: 'client-123',
  coachId: 'coach-1',
  name: 'Jane',
  email: 'jane@example.com',
  startDate: '2024-01-01',
};

describe('GET /api/client/check-in-context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireClientAuth).mockResolvedValue({ ok: true, clientId: 'client-123' } as any);
    vi.mocked(getCheckInTrainingContext).mockResolvedValue({ hasActivePlan: false, sessions: [] } as any);
    vi.mocked(getCheckInNutritionContext).mockResolvedValue({ hasNutritionPlan: false } as any);
    vi.mocked(getCheckInTrainingPeriodStats).mockResolvedValue({ sessionsCompleted: 1, sessionsPlanned: 3 } as any);
    vi.mocked(getTrainingEventDetailsForPeriod).mockResolvedValue([] as any);
    vi.mocked(getDailyLogs).mockResolvedValue([] as any);
  });

  it('available → 200 with the full context shape and the parallel fan-out run', async () => {
    // No expectedCheckInDay → gating is skipped (status stays "available").
    vi.mocked(getClientById).mockResolvedValue({ ...baseClient, expectedCheckInDay: undefined } as any);
    mockServerSupabase(null); // first check-in

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.checkInStatus).toBe('available');
    // Byte-identical success shape: all the documented top-level fields are present.
    expect(Object.keys(body.data).sort()).toEqual(
      [
        'checkInStatus',
        'clientInfo',
        'dailyLogs',
        'nutritionContext',
        'periodDays',
        'periodEnd',
        'periodStart',
        'trainingContext',
        'trainingEventDetails',
        'trainingPeriodStats',
      ].sort(),
    );
    expect(body.data.clientInfo).toMatchObject({
      id: 'client-123',
      name: 'Jane',
      email: 'jane@example.com',
      coachName: 'Coach Carter',
      checkInFrequencyDays: 7,
    });
    // Fan-out (including daily logs) ran.
    expect(getCheckInTrainingContext).toHaveBeenCalledTimes(1);
    expect(getCheckInNutritionContext).toHaveBeenCalledTimes(1);
    expect(getDailyLogs).toHaveBeenCalledTimes(1);
  });

  it('not_due → 403 and ZERO context/daily-log queries (no plan promotion)', async () => {
    vi.mocked(getClientById).mockResolvedValue({ ...baseClient, expectedCheckInDay: 'monday' } as any);
    mockServerSupabase({ period_end: '2024-01-10', created_at: '2024-01-10T00:00:00Z' });
    vi.mocked(getCheckInStatus).mockReturnValue({ status: 'not_due', nextDueDate: '2024-01-17' } as any);

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('not_due');
    // The gate short-circuits before the fan-out, so getCheckInNutritionContext
    // (which performs the plan-promotion side effect) never runs.
    expect(getCheckInTrainingContext).not.toHaveBeenCalled();
    expect(getCheckInNutritionContext).not.toHaveBeenCalled();
    expect(getCheckInTrainingPeriodStats).not.toHaveBeenCalled();
    expect(getTrainingEventDetailsForPeriod).not.toHaveBeenCalled();
    expect(getDailyLogs).not.toHaveBeenCalled();
  });

  it('completed → 403 and no fan-out', async () => {
    vi.mocked(getClientById).mockResolvedValue({ ...baseClient, expectedCheckInDay: 'monday' } as any);
    mockServerSupabase({ period_end: '2024-01-10', created_at: '2024-01-10T00:00:00Z' });
    vi.mocked(getCheckInStatus).mockReturnValue({ status: 'completed', nextDueDate: '2024-01-17' } as any);

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('completed');
    expect(getCheckInNutritionContext).not.toHaveBeenCalled();
    expect(getDailyLogs).not.toHaveBeenCalled();
  });

  it('client not found → 404', async () => {
    vi.mocked(getClientById).mockResolvedValue(null as any);
    mockServerSupabase(null);

    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(getCheckInNutritionContext).not.toHaveBeenCalled();
  });
});
