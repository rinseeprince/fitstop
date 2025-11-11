# CoachHub Development Conventions

## File Size Limits
- Components: Max 200 lines (split at 250)
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
