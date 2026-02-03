# Client Invitation Flow - Debugging Guide

## Problem Summary

When a coach invites a client via the "Invite" button in the client profile:
1. Invitation email is sent correctly
2. Client clicks the invitation link in the email
3. Client lands on `/login` page with tokens in URL hash
4. **Client gets stuck** - cannot proceed to set up their account

## Current URL Pattern

When client clicks invite link, they land on:
```
http://localhost:3000/login#access_token=...&refresh_token=...&expires_at=...&token_type=bearer&type=invite
```

The `access_token` JWT contains valid user data:
- `role: "client"` in user_metadata
- `clientId: "..."` in user_metadata
- Valid email and user ID

## What We've Tried

### 1. Added Redirect URL to Supabase Dashboard
- Added `http://localhost:3000/auth/callback` to Redirect URLs
- This fixed the initial `otp_expired` error

### 2. Modified Login Page to Detect Hash Tokens
- Detects `type=invite` in URL hash
- Shows "Setting up your account..." loading state
- **This works** - loading state appears

### 3. Tried `onAuthStateChange` Listener
- Subscribed to auth state changes
- Console showed: `Auth state change: INITIAL_SESSION undefined`
- **Session was undefined** - tokens not being processed

### 4. Tried Manual `setSession()` Call
- Parsed `access_token` and `refresh_token` from hash
- Called `supabase.auth.setSession({ access_token, refresh_token })`
- **Still stuck in loading state** - need to check console for errors

## Key Technical Details

### Supabase Client Setup
- Uses `@supabase/ssr` package (`createBrowserClient`)
- This client does NOT auto-detect URL hash tokens (unlike standard `@supabase/supabase-js`)
- Sessions stored in cookies for middleware compatibility

**File**: `/services/supabase-client.ts`

### Auth Context
- Subscribes to `onAuthStateChange` in root layout
- Handles session initialization and user data loading
- Sets `user`, `loading`, `isClient`, etc.

**File**: `/contexts/auth-context.tsx`

### Middleware
- Checks session via cookies (cannot see URL hash - client-side only)
- Redirects unauthenticated users to `/login`
- Role-based routing for client vs trainer

**File**: `/middleware.ts`

### Invitation Service
- `sendInvitation()` - sends magic link via `supabaseAdmin.auth.admin.inviteUserByEmail()`
- `acceptInvitation()` - links `user_id` to `clients` table

**File**: `/services/invitation-service.ts`

### Login Page (Current Implementation)
- Detects `type=invite` in hash
- Parses `access_token` and `refresh_token`
- Calls `supabase.auth.setSession()`
- Should redirect to `/client/onboarding`

**File**: `/app/login/page.tsx`

### Accept Invitation API
- POST endpoint to accept invitation
- Calls `acceptInvitation(clientId, userId)`

**File**: `/app/api/invitations/accept/route.ts`

## Fixes Applied

The following changes were made to fix the invitation flow:

### 1. Added Debug Logging (login/page.tsx)
Console logs added at every step:
- `[Invite Flow] Hash detected:` - Shows the URL hash
- `[Invite Flow] Is invite flow:` - Whether `type=invite` was found
- `[Invite Flow] Access token present:` / `Refresh token present:` - Token parsing
- `[Invite Flow] Calling setSession...` - Before session establishment
- `[Invite Flow] setSession result:` - After session establishment
- `[Invite Flow] User ID:` / `Client ID from metadata:` - User details
- `[Invite Flow] Calling /api/invitations/accept...` - Before API call
- `[Invite Flow] Accept invitation result:` - API response
- `[Invite Flow] Waiting for auth context to sync...` - Before delay
- `[Invite Flow] Redirecting to:` - Final redirect path

### 2. Added AuthContext Sync Delay (login/page.tsx)
500ms delay added before redirect to allow AuthContext's `onAuthStateChange` to process the new session.

### 3. Prevented Sign-Out of Invited Clients (auth-context.tsx)
When a profile can't be found for an invited client:
- Sets a temporary profile with `role: "client"` instead of signing out
- Allows the onboarding flow to continue
- Logs: `[Auth] Invited client without profile - allowing session to continue`

### 4. Added Onboarding to Skip-Auth Routes (middleware.ts)
`/client/onboarding` added to `skipAuthRoutes` to prevent middleware from redirecting during session establishment.

### 5. Added Session Check to Onboarding (client/onboarding/page.tsx)
Direct session check using `supabase.auth.getSession()` instead of relying solely on AuthContext:
- Shows loading state while checking session
- Redirects to login if no session found
- Redirects to dashboard if password already set
- Logs: `[Onboarding] Checking session...`, `[Onboarding] Session found for user:`, etc.

### **6. CRITICAL FIX: Client Layout Exception (client/layout.tsx)**
**This was the actual root cause and solution:**

The client layout was blocking access to the onboarding page with auth guards. Added exception:

```typescript
// Allow onboarding page to bypass auth checks
const isOnboardingPage = pathname === "/client/onboarding"

// For onboarding page, render without auth checks or layout chrome  
if (isOnboardingPage) {
  return <div className="min-h-screen bg-background">{children}</div>
}
```

**This 5-line change was the actual fix that solved the problem.**

## Testing Steps

1. Delete the test client from database (or use a new email)
2. Create a new client in coach dashboard
3. Click "Invite" button on client profile
4. Open browser dev tools (Console + Network tabs) before clicking the email link
5. Click the invitation link in the email
6. **Watch console for `[Invite Flow]` and `[Onboarding]` messages**
7. Verify `/api/invitations/accept` is called in Network tab
8. Should redirect to `/client/onboarding`
9. Set password and verify redirect to `/client/dashboard`

## What to Look For

### In Console:
```
[Invite Flow] Hash detected: #access_token=...&type=invite
[Invite Flow] Is invite flow: true
[Invite Flow] Access token present: true
[Invite Flow] Refresh token present: true
[Invite Flow] Calling setSession...
[Invite Flow] setSession result: { hasSession: true, hasUser: true, error: undefined }
[Invite Flow] User ID: <uuid>
[Invite Flow] Client ID from metadata: <uuid>
[Invite Flow] Calling /api/invitations/accept...
[Invite Flow] Accept invitation result: { success: true }
[Invite Flow] Waiting for auth context to sync...
[Invite Flow] Redirecting to: /client/onboarding
[Onboarding] Checking session...
[Onboarding] Session found for user: <uuid>
[Onboarding] Session valid, showing onboarding form
```

### In Network Tab:
- `POST /api/invitations/accept` should return `200 OK` with `{ success: true }`

## If Still Stuck

### Check for these issues:

1. **setSession returns error** - Token may be expired or invalid
2. **No clientId in metadata** - Check JWT at jwt.io for `user_metadata.clientId`
3. **API call fails** - Check `/api/invitations/accept` response in Network tab
4. **Auth context signs out** - Look for `[Auth] Invited client without profile` message
5. **Middleware redirect** - Check if `/client/onboarding` is in `skipAuthRoutes`
6. **Client layout blocking** - The most likely issue - check if onboarding exception exists

## Files Changed During Debugging

1. `/app/login/page.tsx` - Added hash token detection and `setSession()` call
2. `/app/api/invitations/accept/route.ts` - Created new API endpoint
3. `/contexts/auth-context.tsx` - Added invited client handling
4. `/middleware.ts` - Added `/client/onboarding` to skip routes
5. `/app/client/onboarding/page.tsx` - Added session checking
6. **`/app/client/layout.tsx` - Added onboarding exception (THE ACTUAL FIX)**

## Expected Flow (When Working)

1. Client clicks invite link → lands on `/login#access_token=...&type=invite`
2. Login page detects hash, shows loading
3. `setSession()` establishes session from tokens
4. `/api/invitations/accept` links user to client record
5. Redirect to `/client/onboarding`
6. Client sets password
7. Redirect to `/client/dashboard`
