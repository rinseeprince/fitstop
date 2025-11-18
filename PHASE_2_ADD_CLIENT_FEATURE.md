# Phase 2: Add New Client Feature

## Overview
Build the ability for coaches to add, view, and manage their clients. This includes creating a dialog form for adding clients, API endpoints for CRUD operations, and updating the clients page to fetch real data from the database.

---

## Prerequisites ✅
- [x] Authentication working (Phase 1 complete)
- [x] Coaches table exists with RLS policies
- [x] Clients table exists with RLS policies
- [x] Database foreign keys set up (coach_id → coaches.id)

---

## Tasks

### 1. Backend - Client API Routes

#### 1.1 Create Client API Route
**File:** `/app/api/clients/route.ts`

**Features:**
- [  ] POST endpoint to create new client
- [  ] Get coach_id from authenticated session
- [  ] Validate required fields (name, email)
- [  ] Insert into clients table with coach_id
- [  ] Return created client data
- [  ] Handle errors (duplicate email, etc.)

**Expected functionality:**
```typescript
POST /api/clients
Body: { name: string, email: string, avatarUrl?: string }
Response: { client: Client } | { error: string }
```

#### 1.2 Get Clients API Route
**File:** `/app/api/clients/route.ts`

**Features:**
- [  ] GET endpoint to fetch coach's clients
- [  ] Filter by coach_id from session
- [  ] Support query params: status (active/inactive), search
- [  ] Return paginated results (optional)
- [  ] Handle errors

**Expected functionality:**
```typescript
GET /api/clients?search=john&active=true
Response: { clients: Client[], total: number }
```

#### 1.3 Update/Delete Client API Routes
**File:** `/app/api/clients/[id]/route.ts`

**Features:**
- [  ] GET endpoint for single client
- [  ] PATCH endpoint to update client
- [  ] DELETE endpoint to delete/deactivate client
- [  ] Verify ownership (client belongs to authenticated coach)
- [  ] Handle errors

---

### 2. Frontend - Client Service Layer

#### 2.1 Create Client Service
**File:** `/services/client-service.ts`

**Features:**
- [  ] `createClient(name, email, avatarUrl?)` - Create new client
- [  ] `getClients(filters?)` - Fetch all clients for coach
- [  ] `getClientById(id)` - Fetch single client
- [  ] `updateClient(id, data)` - Update client info
- [  ] `deleteClient(id)` - Delete/deactivate client
- [  ] Error handling and type safety

---

### 3. Frontend - Add Client Dialog Component

#### 3.1 Create Add Client Dialog
**File:** `/components/add-client-dialog.tsx`

**Features:**
- [  ] Dialog component using shadcn/ui Dialog
- [  ] Form with react-hook-form
- [  ] Zod schema for validation
- [  ] Fields: Name (required), Email (required)
- [  ] Email validation regex
- [  ] Submit button with loading state
- [  ] Success/error toast notifications
- [  ] Close dialog on success
- [  ] Reset form on close
- [  ] Match CoachHub design theme (glassmorphism, purple accent)

**Form Fields:**
- Name (text input, required)
- Email (email input, required)
- Optional: Avatar URL or file upload

**Validation Rules:**
- Name: min 2 characters, max 100 characters
- Email: valid email format, unique check (handled by API)

#### 3.2 Style Matching
- [  ] Use 8px radius for inputs (--radius-xs)
- [  ] Use 12px radius for dialog (--radius)
- [  ] Match button styles from login/signup pages
- [  ] Use glassmorphism for dialog backdrop
- [  ] Primary purple gradient for submit button

---

### 4. Frontend - Update Clients Page

#### 4.1 Replace Mock Data with Real Data
**File:** `/app/clients/page.tsx`

**Features:**
- [  ] Remove `mockClients` array
- [  ] Fetch real clients on page load using client service
- [  ] Handle loading state (skeleton or spinner)
- [  ] Handle error state (error message)
- [  ] Handle empty state (no clients yet)
- [  ] Display real client data in table/cards

#### 4.2 Wire Up "Add New Client" Button
**File:** `/app/clients/page.tsx`

**Features:**
- [  ] Import AddClientDialog component
- [  ] Add state for dialog open/closed
- [  ] Connect button to open dialog
- [  ] Refresh client list after successful add
- [  ] Show success toast after adding client

#### 4.3 Implement Search Functionality
**File:** `/app/clients/page.tsx`

**Features:**
- [  ] Wire up search input to state
- [  ] Debounce search input (300ms)
- [  ] Filter clients by name or email
- [  ] Show "No results found" message
- [  ] Clear search button

#### 4.4 Implement Filter Functionality
**File:** `/app/clients/page.tsx`

**Features:**
- [  ] Wire up filter buttons (All, Active, Leads, Inactive)
- [  ] Update active filter state
- [  ] Filter clients by active status
- [  ] Show count for each filter
- [  ] Highlight active filter button

#### 4.5 Add Client Actions
**File:** `/app/clients/page.tsx` or new component

**Features:**
- [  ] Edit client button (opens edit dialog)
- [  ] Delete/deactivate client button (with confirmation)
- [  ] View client details link (existing functionality)
- [  ] Send check-in link button (future feature)

---

### 5. Data Types & Validation

#### 5.1 Update Types
**File:** `/types/check-in.ts` (already has Client type)

**Verify:**
- [  ] Client type matches database schema
- [  ] Coach type matches database schema
- [  ] Export types for use in components

#### 5.2 Create Zod Schemas
**File:** `/lib/validations/client.ts` (NEW)

**Features:**
- [  ] CreateClientSchema for new clients
- [  ] UpdateClientSchema for editing clients
- [  ] Email validation regex
- [  ] Name length validation

---

### 6. Testing & Refinement

#### 6.1 Manual Testing Checklist
- [  ] Can add a new client successfully
- [  ] Validation errors show correctly
- [  ] Duplicate email is handled gracefully
- [  ] Clients list updates after adding
- [  ] Search works correctly
- [  ] Filters work correctly
- [  ] RLS policies prevent seeing other coaches' clients
- [  ] UI matches design theme
- [  ] Loading states work
- [  ] Error states work
- [  ] Empty states work

#### 6.2 Edge Cases to Test
- [  ] Adding client with same email as existing client
- [  ] Adding client while offline (network error)
- [  ] Adding client with very long name
- [  ] Adding client with invalid email format
- [  ] Multiple coaches adding clients simultaneously
- [  ] Refreshing page while dialog is open
- [  ] Clicking outside dialog to close

---

### 7. Optional Enhancements

#### 7.1 Nice to Have Features
- [  ] Avatar upload for clients (Supabase Storage)
- [  ] Bulk import clients (CSV upload)
- [  ] Export clients to CSV
- [  ] Client tags/labels
- [  ] Client notes field
- [  ] Last contacted timestamp
- [  ] Client status (Lead, Active, Inactive, Churned)
- [  ] Sort clients by name, date added, last check-in

#### 7.2 Future Features (Not in Phase 2)
- [ ] Edit client inline
- [ ] Client profile page with full details
- [ ] Client activity timeline
- [ ] Send check-in link from clients page
- [ ] Client onboarding flow
- [ ] Client goals and program assignment

---

## File Structure Summary

```
app/
  api/
    clients/
      route.ts                 # GET (list), POST (create)
      [id]/
        route.ts               # GET, PATCH, DELETE
  clients/
    page.tsx                   # Update to use real data

components/
  add-client-dialog.tsx        # NEW - Dialog for adding clients

services/
  client-service.ts            # NEW - Client CRUD operations

lib/
  validations/
    client.ts                  # NEW - Zod schemas

types/
  check-in.ts                  # Already has Client type
```

---

## Estimated Time

- Backend API Routes: **1-2 hours**
- Client Service Layer: **30 minutes**
- Add Client Dialog: **1-2 hours**
- Update Clients Page: **2-3 hours**
- Testing & Refinement: **1-2 hours**

**Total: 6-10 hours**

---

## Success Criteria

✅ Coaches can add new clients via a dialog form
✅ Client data is stored in database with proper coach ownership
✅ Clients page shows real data from database
✅ Search and filter functionality works
✅ RLS policies prevent cross-coach data access
✅ UI matches CoachHub design theme
✅ Proper error handling and validation
✅ Loading and empty states implemented

---

## Notes

- Keep the design consistent with login/signup pages (glassmorphism, purple accents)
- Use existing shadcn/ui components where possible
- Follow the RLS pattern from coaches table (coach_id filtering)
- Consider mobile responsiveness for the dialog
- Add proper TypeScript types for all functions
- Use toast notifications for user feedback
- Don't overcomplicate - MVP first, enhancements later

---

## Ready to Start?

Begin with **Task 1.1** (Create Client API Route) and work through the list sequentially. Each task builds on the previous one.

Good luck! 🚀
