import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/require-client-auth', () => ({
  requireClientAuth: vi.fn(),
}));

vi.mock('@/services/check-in-service', () => ({
  submitCheckIn: vi.fn(),
  getClientCheckIns: vi.fn(),
}));
// @/utils/check-in-canonical-metrics is deliberately NOT mocked: it is a pure
// payload transform with no DB imports, and it is the thing the POST path must
// not skip. Mocking it away would let a lost lbs→kg conversion pass unnoticed.

// The GET handler uses none of the POST-path collaborators, but importing ./route
// loads them — and several create clients (Supabase, Resend) at module load and
// throw without env. Stub them so the suite can import the route under test.
vi.mock('@/services/supabase-admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/services/client-service', () => ({ getClientById: vi.fn() }));
vi.mock('@/services/storage-service', () => ({ uploadProgressPhotoFromBase64: vi.fn() }));
vi.mock('@/services/client-check-in-service', () => ({
  triggerAISummaryGeneration: vi.fn(),
  updateClientMetricsFromCheckIn: vi.fn(),
}));
vi.mock('@/services/check-in-adherence-service', () => ({ updateClientAdherenceStats: vi.fn() }));
vi.mock('@/services/check-in-snapshot-service', () => ({ generateAndSaveCheckInSnapshot: vi.fn() }));

import { GET } from './route';
import { requireClientAuth } from '@/lib/require-client-auth';
import { getClientCheckIns } from '@/services/check-in-service';
import { encodeCursor } from '@/lib/cursor';

const req = (url: string) => new NextRequest(url);

describe('GET /api/client/check-ins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireClientAuth).mockResolvedValue({ ok: true, clientId: 'client-123' } as any);
  });

  it('keyset first page (no cursor) returns nextCursor + hasMore, no offset/total', async () => {
    vi.mocked(getClientCheckIns).mockResolvedValue({
      checkIns: [{ id: 'x' }] as any,
      total: 0,
      nextCursor: { createdAt: '2024-01-08T00:00:00Z', id: '22222222-2222-4222-8222-222222222222' },
    });

    const res = await GET(req('https://t.dev/api/client/check-ins?limit=2'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(getClientCheckIns).toHaveBeenCalledWith('client-123', { limit: 2, keyset: true, cursor: undefined });
    expect(body.success).toBe(true);
    expect(body.pagination.hasMore).toBe(true);
    expect(typeof body.pagination.nextCursor).toBe('string');
    expect(body.pagination.offset).toBeUndefined();
    expect(body.pagination.total).toBeUndefined();
  });

  it('keyset last page returns nextCursor null + hasMore false', async () => {
    vi.mocked(getClientCheckIns).mockResolvedValue({ checkIns: [], total: 0, nextCursor: null });

    const res = await GET(req('https://t.dev/api/client/check-ins?limit=2'));
    const body = await res.json();

    expect(body.pagination.nextCursor).toBeNull();
    expect(body.pagination.hasMore).toBe(false);
  });

  it('decodes a valid cursor and forwards the decoded tuple', async () => {
    vi.mocked(getClientCheckIns).mockResolvedValue({ checkIns: [], total: 0, nextCursor: null });
    const cursor = { createdAt: '2024-01-01T00:00:00Z', id: '33333333-3333-4333-8333-333333333333' };

    const res = await GET(req(`https://t.dev/api/client/check-ins?limit=2&cursor=${encodeCursor(cursor)}`));

    expect(res.status).toBe(200);
    expect(getClientCheckIns).toHaveBeenCalledWith('client-123', { limit: 2, keyset: true, cursor });
  });

  it('rejects an invalid cursor with 400 and never hits the service', async () => {
    const res = await GET(req('https://t.dev/api/client/check-ins?limit=2&cursor=not-valid'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid cursor');
    expect(getClientCheckIns).not.toHaveBeenCalled();
  });

  it('offset mode (explicit ?offset=) keeps the legacy offset/total shape', async () => {
    vi.mocked(getClientCheckIns).mockResolvedValue({
      checkIns: [{ id: 'x' }] as any,
      total: 25,
      nextCursor: null,
    });

    const res = await GET(req('https://t.dev/api/client/check-ins?limit=10&offset=0'));
    const body = await res.json();

    expect(getClientCheckIns).toHaveBeenCalledWith('client-123', { limit: 10, offset: 0 });
    expect(body.pagination).toMatchObject({ limit: 10, offset: 0, count: 1, total: 25 });
    expect(body.pagination.nextCursor).toBeUndefined();
  });

  it('returns the auth failure response when unauthenticated', async () => {
    const denied = new Response('no', { status: 401 });
    vi.mocked(requireClientAuth).mockResolvedValue({ ok: false, response: denied } as any);

    const res = await GET(req('https://t.dev/api/client/check-ins?limit=2'));
    expect(res.status).toBe(401);
    expect(getClientCheckIns).not.toHaveBeenCalled();
  });
});
