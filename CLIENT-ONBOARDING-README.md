# Client Onboarding Feature

## Overview

A client-led onboarding flow where the coach sends an invite, the client completes a structured intake questionnaire, the coach reviews and builds plans from the intake data, and the client receives a guided walkthrough of their personalised plan on first login.

This feature replaces manual data entry by coaches, external intake forms (Google Forms, Typeform), and the cold "here's your plan with no context" first experience.

## Architecture

### Data Flow

```
Coach adds client (name + email)
  -> Invite sent to client
  -> client_intake record created (status: pending)
  -> clients.onboarding_status = 'pending_intake'

Client clicks invite
  -> Creates account (or signs in)
  -> Completes 5-step intake form
  -> Each step saves to client_intake via API
  -> On submit: client_intake.status = 'completed'
  -> clients.onboarding_status = 'intake_completed'

Coach reviews intake
  -> Reads formatted intake on review page
  -> Adds private coach notes
  -> Clicks "Sync Metrics to Profile" (pushes weight, height, age, goals to clients table)
  -> Builds nutrition/training/habits using existing builders
  -> clients.onboarding_status = 'setup_in_progress'

Coach activates client
  -> Sets welcome message + first check-in day
  -> clients.onboarding_status = 'active'
  -> Client notified (email or in-app)

Client first login after activation
  -> Guided walkthrough shows (nutrition, training, habits, how it works)
  -> walkthrough_completed_at timestamp set after completion
  -> Client lands on Daily Pulse ready to log
```

### Database

**New table: client_intake**
- Stores all intake questionnaire responses
- Status: pending -> in_progress -> completed -> reviewed
- One record per client
- Freeform text fields for client's own words (goal description, motivation, challenges, injuries)
- Array fields for dietary requirements and available equipment

**Modified: clients table**
- Added: onboarding_status column (pending_intake, intake_completed, setup_in_progress, active, paused)
- Added: welcome_message (text, coach's welcome message on activation)
- Added: expected_check_in_day (text, day of week for first check-in)
- Added: start_date (date, client start date set on activation)
- Existing clients default to 'active'

### Intake Steps

| Step | Section | Key Fields |
|------|---------|------------|
| 1 | About You | DOB, gender, height, weight, body fat % (optional) |
| 2 | Your Goals | Primary goal type, target weight (conditional), deadline, motivation |
| 3 | Your Lifestyle | Work activity, training days/week, time preference, location, equipment, session duration |
| 4 | Nutrition | Dietary requirements, allergies, current diet description, cooking frequency, macro tracking experience |
| 5 | History | Injuries/limitations, training experience level, previous coaching, open notes |

### Onboarding Status States

| Status | Meaning | Coach sees | Client sees |
|--------|---------|------------|-------------|
| pending_intake | Invite sent, awaiting client | "Pending Intake" badge | Intake form |
| intake_completed | Client finished intake | "Intake Ready for Review" badge + review link | "Waiting for coach" screen |
| setup_in_progress | Coach is building plans | "Setting Up" badge | "Waiting for coach" screen |
| active | Fully onboarded | No badge (normal state) | Dashboard / Daily Pulse |
| paused | Client paused/inactive | "Paused" badge | Paused message |

## API Routes

### Client-facing (auth: client)
- `GET /api/client/intake` - get own intake status and data
- `PUT /api/client/intake/step/[step]` - save a single step (1-5)
- `POST /api/client/intake/submit` - submit completed intake
- `POST /api/client/walkthrough-seen` - mark walkthrough as completed

### Coach-facing (auth: coach)
- `GET /api/clients/[id]/intake` - get client's intake for review
- `POST /api/clients/[id]/intake/review` - mark as reviewed + coach notes
- `POST /api/clients/[id]/intake/sync-metrics` - push intake metrics to client profile
- `POST /api/clients/[id]/activate` - activate client with welcome message
- `GET /api/clients/[id]/activation-readiness` - check if client is ready for activation
- `GET /api/coach/pending-intakes` - list all pending/completed intakes

### Invitation
- `POST /api/invitations/send` - send invitation email to new client
- `POST /api/invitations/accept` - accept invitation and create/link account
- `GET /api/invitations/[token]` - validate and retrieve invitation details
- `GET /api/invitations/status/[clientId]` - check invitation status for a client

## Existing Infrastructure (from Session 0 recon)

### Invite System (fully built)
- Token-based invites via `services/invitation-service.ts`
- 64-char hex tokens, 7-day expiry, stored in `client_invitations` table
- Client clicks invite link -> `/invite/[token]` -> creates Supabase auth account -> redirects to intake form
- Key files: `services/invitation-service.ts`, `app/invite/[token]/page.tsx`, `app/api/invitations/accept/route.ts`

### Email (Resend, fully working)
- Resend v6.9.1 with React Email templates in `emails/`
- Env var: RESEND_API_KEY, from: onboarding@resend.dev (switch to custom domain for production)
- Email service: `services/email-service.ts`
- New transactional emails just need new templates in `emails/` and calls to Resend

## Key Files

### Types
- `types/client-intake.ts`

### Validation
- `lib/validations/client-intake.ts`
- `lib/validations/intake-steps.ts`

### Services
- `services/client-intake-service.ts`
- `services/invitation-service.ts`
- `services/email-service.ts`

### Components (Client)
- `components/client/onboarding/intake-form.tsx`
- `components/client/onboarding/intake-step-1.tsx` through `intake-step-5.tsx`
- `components/client/walkthrough/guided-walkthrough.tsx`
- `components/client/onboarding/client-waiting-state.tsx`

### Components (Coach)
- `components/coach/pending-intake-banner.tsx`
- `components/coach/intake-review-page.tsx`
- `components/coach/client-activation-dialog.tsx`
- `components/clients/client-activation-banner.tsx`
- `components/clients/invite-client-dialog.tsx`

### Pages
- `app/client/onboarding/page.tsx`
- `app/invite/[token]/page.tsx`

### Emails
- `emails/invitation-email.tsx`
- `emails/activation-email.tsx`

## Design Principles

- **Mobile first.** The intake form is primarily filled out on phones. Large touch targets, one question group per screen, no long scrolling forms.
- **Conversational tone.** Labels and helper text feel like a conversation, not a medical questionnaire.
- **Progress saves automatically.** Client can close the app mid-intake and resume later. Each step saves to the API on continue.
- **Coach stays in control.** The intake captures client data but the coach decides what to do with it. Metrics sync is explicit (coach clicks a button), not automatic.
- **Backward compatible.** Existing clients are unaffected. The manual setup path still works. Coaches can skip the intake questionnaire if they prefer.
- **No coach notes visible to clients.** The intake review notes, coach reasoning, and internal observations never surface in the client portal.

## Conventions

- Follow CONVENTIONS.md for all code patterns
- Components max 200 lines, services max 300 lines, API routes max 250 lines
- Use supabaseAdmin for server-side, createPortalClient for RLS client calls
- apiRateLimit(request) as first line of every API handler
- Response format: { success: boolean, data: {}, error?: string }
- Zod validation on all inputs