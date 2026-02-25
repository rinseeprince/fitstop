# CoachHub Development Conventions

## Engineering Philosophy
- **No band-aid fixes**: Never work around symptoms. Always investigate and understand the root cause before implementing a fix.
- **Quality over speed**: Take the time to build clean, maintainable solutions rather than quick hacks that create technical debt.
- **Understand before implementing**: When something doesn't work as expected, research why. Read documentation, check for known issues, and understand the intended design before writing code.
- **If it feels wrong, it probably is**: If a solution requires fighting against the framework or library's design, step back and find the proper approach.

## File Size Limits
- Components: Max 250 lines (split at 300)
- Services: Max 300 lines (split at 400)
- API routes: Max 250 lines (split at 300)
- Utils: Max 150 lines (split at 200)

When files exceed limits, extract:
- Sub-components
- Custom hooks
- Service functions
- Helper utilities

## Code Style
- Use Tailwind for styling
- Lucide icons only
- Inter font family
- Async/await over promises
- Named exports over default

## File Structure
/components - React components
/services - Business logic
/api - API routes
/utils - Helper functions
/hooks - Custom React hooks
/types - TypeScript definitions

## Security
- Auth: Check on every protected route/component
- Input sanitization: All user inputs (especially coach bios, session notes)
- Rate limiting: **MANDATORY** - Every API route must include rate limiting as the first check
- Sensitive data: Never log passwords, tokens, payment info
- File uploads: Validate type, size, scan (profile pics, workout plans)

### Rate Limiting Requirements
**ALL new API routes MUST implement rate limiting as the first operation in every handler function.**

#### Rate Limit Types:
- `authRateLimit`: Auth/invitation routes (5 requests per 15 minutes)
- `apiRateLimit`: General API endpoints (60 requests per minute)
- Custom limits: AI/expensive operations (10 requests per minute or stricter)

#### Required Pattern:
```typescript
import { apiRateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  // ... rest of handler logic
}
```

#### When to Use Each Type:
- **authRateLimit**: `/api/auth/*`, `/api/invitations/*`, login, signup, password reset
- **Custom strict limits**: AI endpoints, file processing, expensive computations
- **apiRateLimit**: All other routes (default choice)

#### Examples:
```typescript
// Auth endpoint
const rateLimitResult = await authRateLimit(request);

// AI endpoint  
const rateLimitResult = await rateLimit(request, {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 10, // 10 requests per minute
});

// Standard endpoint
const rateLimitResult = await apiRateLimit(request);
```

## Testing
- Unit tests: All service functions and utilities
- Integration tests: Critical flows (booking, payments, auth)
- API tests: All endpoints with success/error cases
- Run tests before commits
- Coverage target: 70% minimum

## Performance
- Database queries: Indexes on foreign keys, frequently queried fields
- API responses: <200ms target, pagination for lists >20 items
- Images: Optimize/compress before upload, use WebP
- Caching: Redis for session data, frequently accessed coach profiles
- Lazy loading: Components below fold, infinite scroll for feeds

## Error Handling
- All API routes: try-catch with proper error codes
- User-facing errors: Toast notifications
- Log all errors with context (user ID, action, timestamp)
- Validation: Zod schemas for all inputs/API payloads
- Database operations: Transaction rollbacks on failure

## Documentation
- API endpoints: Request/response examples, error codes
- Complex functions: JSDoc with params, returns, examples
- Setup: .env.example with all required variables documented
- Database schema: ER diagram, migration strategy
- README: Local setup in <5 steps

## API Design
- RESTful routes: /api/coaches, /api/sessions/:id
- Status codes: 200 (success), 201 (created), 400 (validation), 401 (auth), 404 (not found), 500 (server)
- Response format: { success: bool, data: {}, error?: string }
- Timestamps: ISO 8601 format
- Versioning: /api/v1 for future-proofing

## State Management
- Server state: TanStack Query (React Query)
- Form state: React Hook Form with Zod
- Global client state: Zustand (avoid prop drilling)
- URL state: Search params for filters/pagination
- No useState for server data

## Database
- Migrations: Version controlled, never edit directly
- Relations: Foreign keys with ON DELETE CASCADE/SET NULL
- Indexes: On foreign keys, search fields, sort columns
- Soft deletes: For user data (deleted_at column)
- Timestamps: created_at, updated_at on all tables

## Logging
- Info: User actions (login, booking, payment)
- Warn: Recoverable errors (rate limit hit, validation fail)
- Error: System failures with stack traces
- Format: Structured JSON for log aggregation
- Never log: Passwords, tokens, full credit cards

## Configuration
- .env files: .env.local (dev), .env.production
- Required vars: Document in .env.example with descriptions
- Feature flags: For gradual rollouts
- Secrets: Never in code, use vault/secrets manager for prod