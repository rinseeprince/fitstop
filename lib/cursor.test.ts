import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor } from './cursor';

const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');

describe('cursor codec', () => {
  const valid = {
    createdAt: '2024-01-15T10:00:00.123456+00:00',
    id: '11111111-1111-4111-8111-111111111111',
  };

  it('round-trips a valid cursor', () => {
    expect(decodeCursor(encodeCursor(valid))).toEqual(valid);
  });

  it('accepts both Z and +00:00 timezone forms', () => {
    const z = { createdAt: '2024-01-15T10:00:00Z', id: valid.id };
    expect(decodeCursor(encodeCursor(z))).toEqual(z);
  });

  it('returns null for non-base64 / non-JSON input', () => {
    expect(decodeCursor('@@@not-a-cursor@@@')).toBeNull();
    expect(decodeCursor(Buffer.from('not json', 'utf8').toString('base64url'))).toBeNull();
  });

  it('returns null when the shape is wrong', () => {
    expect(decodeCursor(b64({ createdAt: valid.createdAt }))).toBeNull(); // missing id
    expect(decodeCursor(b64({ createdAt: 1, id: 2 }))).toBeNull(); // wrong types
    expect(decodeCursor(b64(null))).toBeNull();
    expect(decodeCursor(b64('a string'))).toBeNull();
  });

  it('returns null when id is not a UUID', () => {
    expect(decodeCursor(b64({ createdAt: valid.createdAt, id: 'not-a-uuid' }))).toBeNull();
  });

  it('returns null for a non-timestamp createdAt', () => {
    expect(decodeCursor(b64({ createdAt: 'garbage', id: valid.id }))).toBeNull();
  });

  it('rejects a crafted createdAt that would inject PostgREST filter syntax', () => {
    // A comma/paren would break out of the .or() keyset predicate if it slipped through.
    expect(decodeCursor(b64({ createdAt: '2024-01-01,and(id.gt.0)', id: valid.id }))).toBeNull();
    expect(decodeCursor(b64({ createdAt: '2024-01-01T00:00:00Z)', id: valid.id }))).toBeNull();
  });
});
