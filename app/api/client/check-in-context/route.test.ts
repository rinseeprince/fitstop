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
    // Due TODAY, so the gate opens. (This used to lean on an unscheduled client
    // to get through — that route is closed now: no schedule, no check-in.)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-14T12:00:00Z'));
    vi.mocked(getClientById).mockResolvedValue({
      ...baseClient,
      nextCheckInDue: '2026-06-14',
      checkInFrequency: 'weekly',
    } as any);
    mockServerSupabase(null); // first check-in

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.checkInStatus).toBe('available');
    // First check-in (no expected day) → bounded trailing-7 window, not start_date→today.
    expect(body.data.periodDays).toBe(7);
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

  it('unscheduled → 403 and no fan-out', async () => {
    // A client whose coach has set no date has nothing to check in FOR: no due
    // date to report against, and no period for the submission to cover.
    vi.mocked(getClientById).mockResolvedValue({
      ...baseClient,
      nextCheckInDue: undefined,
    } as any);
    mockServerSupabase(null);

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('unscheduled');
    expect(getCheckInNutritionContext).not.toHaveBeenCalled();
    expect(getDailyLogs).not.toHaveBeenCalled();
  });

  it('not_due → 403 and ZERO context/daily-log queries (no plan promotion)', async () => {
    // A due date in the future. The gate is real here — see the header note —
    // so the clock is pinned: an unpinned "today" would leave the due date
    // lapsed and the gate would correctly answer overdue instead.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T12:00:00Z'));
    vi.mocked(getClientById).mockResolvedValue({
      ...baseClient,
      nextCheckInDue: '2026-06-14',
      checkInFrequency: 'weekly',
    } as any);
    mockServerSupabase({ period_end: '2024-01-10', created_at: '2024-01-10T00:00:00Z' });

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
    vi.useRealTimers();
  });

  // Sam's row, the one this gate was rewritten for: checked in on 27 Aug for
  // the week ending the 26th, coach then moved his next check-in to 3 Sep. The
  // old gate let him straight back in and would have taken a SECOND check-in
  // for the same week, advancing his schedule past the one his coach had just
  // set. There is no separate `completed` state any more — submitting advances
  // the date, so an already-checked-in client and a not-yet-due one are one
  // thing, and both are refused here.
  it('a client who has already checked in is refused, not offered a second form', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-28T12:00:00Z'));
      vi.mocked(getClientById).mockResolvedValue({
        ...baseClient,
        nextCheckInDue: '2026-09-03',
        checkInFrequency: 'weekly',
        timezone: 'Europe/London',
      } as any);
      mockServerSupabase({ period_end: '2026-08-26', created_at: '2026-08-27T10:00:00Z' });

      const res = await GET(req());
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.error).toBe('not_due');
      expect(body.nextDueDate).toBe('2026-09-03');
      expect(getCheckInNutritionContext).not.toHaveBeenCalled();
      expect(getDailyLogs).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('client not found → 404', async () => {
    vi.mocked(getClientById).mockResolvedValue(null as any);
    mockServerSupabase(null);

    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(getCheckInNutritionContext).not.toHaveBeenCalled();
  });

  it("anchors the gate and the displayed period to the CLIENT's local today (London 23:30Z boundary)", async () => {
    // 23:30 UTC Tue June 9 = 00:30 BST Wed June 10. Wednesday is the check-in
    // day: the gate must see Wednesday and the displayed window must end on
    // 06-10 — under server UTC both would still be anchored to Tuesday.
    // (Suite is pinned to TZ=UTC, so a regression fails on any host.)
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-09T23:30:00Z'));
      vi.mocked(getClientById).mockResolvedValue({
        ...baseClient,
        nextCheckInDue: '2026-06-10', // a Wednesday
        timezone: 'Europe/London',
      } as any);
      mockServerSupabase(null);

      const res = await GET(req());
      const body = await res.json();

      // The gate opened: client-local today IS the due day (Wed 10 June), even
      // though the server clock still reads Tue 9 June. Under server-UTC
      // anchoring this would 403 as not_due.
      expect(res.status).toBe(200);
      expect(body.data.checkInStatus).toBe('available');
      // And the displayed period ends on the same client-local Wednesday.
      expect(body.data.periodStart).toBe('2026-06-04');
      expect(body.data.periodEnd).toBe('2026-06-10');
    } finally {
      vi.useRealTimers();
    }
  });
});
