/**
 * Mock Supabase client for testing services
 * Provides a chainable API that mimics Supabase's query builder
 */

import { vi } from 'vitest'

type MockQueryResult<T = unknown> = {
  data: T | null
  error: { message: string; code?: string } | null
}

// Create a chainable mock that returns itself for method chaining
export function createMockSupabaseQuery<T = unknown>(result: MockQueryResult<T>) {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    like: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    contains: vi.fn().mockReturnThis(),
    containedBy: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    // For queries without .single(), return the result directly
    then: vi.fn((resolve) => resolve(result)),
  }

  // Make the mock thenable (Promise-like) for await
  Object.defineProperty(mockQuery, 'then', {
    value: (resolve: (value: MockQueryResult<T>) => void) => {
      return Promise.resolve(result).then(resolve)
    },
  })

  return mockQuery
}

// Create a mock Supabase client
export function createMockSupabaseClient() {
  const mockFrom = vi.fn()

  return {
    from: mockFrom,
    auth: {
      getUser: vi.fn(),
      getSession: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
    },
    storage: {
      from: vi.fn(),
    },
    // Helper to set up table mocks
    _setTableMock: (tableName: string, query: ReturnType<typeof createMockSupabaseQuery>) => {
      mockFrom.mockImplementation((table: string) => {
        if (table === tableName) {
          return query
        }
        return createMockSupabaseQuery({ data: null, error: null })
      })
    },
    // Helper to set up multiple table mocks
    _setTableMocks: (mocks: Record<string, ReturnType<typeof createMockSupabaseQuery>>) => {
      mockFrom.mockImplementation((table: string) => {
        return mocks[table] || createMockSupabaseQuery({ data: null, error: null })
      })
    },
  }
}

// Type for the mock client
export type MockSupabaseClient = ReturnType<typeof createMockSupabaseClient>

// Helper to create a successful query result
export function mockSuccess<T>(data: T): MockQueryResult<T> {
  return { data, error: null }
}

// Helper to create an error query result
export function mockError(message: string, code?: string): MockQueryResult<never> {
  return { data: null, error: { message, code } }
}

// Helper to mock the supabaseAdmin import
export function mockSupabaseAdmin() {
  const mockClient = createMockSupabaseClient()

  vi.mock('@/services/supabase-admin', () => ({
    supabaseAdmin: mockClient,
  }))

  return mockClient
}
