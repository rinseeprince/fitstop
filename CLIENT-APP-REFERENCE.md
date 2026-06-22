# Client App Reference Guide

This document serves as the complete reference for building iOS/Android mobile apps that replicate the client-facing web application functionality. It documents all features, API endpoints, data models, and business logic needed for mobile development.

---

## Table of Contents

1. [Overview](#overview)
2. [Core Features](#core-features)
3. [Authentication & Authorization](#authentication--authorization)
4. [API Endpoints](#api-endpoints)
5. [Data Models](#data-models)
6. [User Flows](#user-flows)
7. [Business Logic](#business-logic)
8. [UI/UX Patterns](#uiux-patterns)
9. [State Management](#state-management)
10. [Coach-Client Interactions](#coach-client-interactions)
11. [File Structure Reference](#file-structure-reference)

---

## Overview

The client app is a fitness coaching platform where clients can:
- Track daily wellness, nutrition, and training (Daily Pulse)
- View and complete assigned training plans
- Monitor nutrition targets and macro intake
- Submit weekly check-ins with progress photos
- Track progress over time with analytics
- Manage daily habits
- Access educational resources

### Technology Stack (Web)
- **Frontend**: Next.js 14 (App Router), React, TypeScript
- **Backend**: Supabase (PostgreSQL + Auth)
- **Styling**: Tailwind CSS, shadcn/ui components
- **State**: React hooks, Context API for auth

---

## Core Features

### 1. Daily Pulse (Daily Tracking System)
**Primary Feature** - Located at `/client/dashboard`

The Daily Pulse is the centerpiece of the client experience, allowing daily logging of:
- **Wellness Metrics**: Mood (1-5 emoji scale), Energy (1-10), Sleep (1-10), Stress (1-10), Notes
- **Training Completion**: Mark planned sessions complete, log alternative sessions, add unplanned activities
- **Nutrition Tracking**: Log calories and macros (protein, carbs, fat) with dynamic targets
- **Habit Tracking**: Toggle daily habits on/off with auto-save

**Key Components**:
- `components/daily-pulse/daily-pulse.tsx` - Main container owning all state
- `components/daily-pulse/daily-pulse-content.tsx` - Layout orchestrator
- See [DAILY-PULSE-README.md](./DAILY-PULSE-README.md) for complete architecture

### 2. Training Plans & Workout Logging
**Location**: `/client/training`

- View active training plan with weekly schedule
- See exercise details (sets, reps, RPE targets, rest periods)
- Mark sessions complete
- Track weekly completion progress
- Support for both structured workouts and external activities

### 3. Nutrition Plans & Macro Tracking
**Location**: `/client/nutrition`

- View daily calorie and macro targets
- Targets adjust based on training (training day vs rest day)
- Visual macro breakdown
- Integration with Daily Pulse for logging

### 4. Progress Tracking
**Location**: `/client/progress`

- Upload progress photos (front, side, back views)
- Log body measurements (weight, body fat %, circumferences)
- View historical charts and trends
- Analytics for weight, measurements, and training consistency

### 5. Weekly Check-ins
**Locations**: 
- `/client/check-in` - Authenticated form
- `/check-in/[token]` - Public magic link form

- Comprehensive weekly progress submission
- Includes subjective metrics, training adherence, photos
- AI-powered summary generation for coaches
- Token-based public access for email reminders

### 6. Habits Management
**Integrated in Daily Pulse**

- Daily habit tracking with boolean toggles
- Auto-saves independently from other Daily Pulse data
- Historical tracking with date filtering
- Streak counting and analytics

### 7. Push Notifications
**Location**: In-app dropdown (`components/client/notifications-dropdown.tsx`)

- Check-in reminders
- Program updates
- Coach messages
- System notifications

### 8. Resources & Educational Content
**Location**: `/client/resources`

- Access to educational materials
- Training guides
- Nutrition information

---

## Authentication & Authorization

### User Roles
```typescript
type UserRole = "client" | "trainer"
```

### Auth Context
**Location**: `contexts/auth-context.tsx`

```typescript
interface AuthContextType {
  user: User | null
  profile: Profile | null
  role: UserRole | null
  isClient: boolean
  isTrainer: boolean
  login: (email: string, password: string) => Promise<UserRole | null>
  logout: () => Promise<void>
  // ... other methods
}
```

### Middleware Protection
**Location**: `middleware.ts`

- Routes starting with `/client/*` require `role === "client"`
- Automatic redirection based on role:
  - Clients → `/client/dashboard`
  - Trainers → `/dashboard`
- Public routes: `/check-in/[token]`, `/invite/[token]`

---

## API Endpoints

All client API endpoints require authentication except where noted.

### Authentication
- `POST /api/auth/login` - Email/password login
- `POST /api/auth/logout` - Logout
- `GET /api/client/me` - Get current user profile

### Daily Logs (Daily Pulse)
- `GET /api/client/daily-logs?date={YYYY-MM-DD}` - Get logs for date range
- `POST /api/client/daily-logs` - Create/update daily log
  ```json
  {
    "date": "2024-01-01",
    "mood": 4,
    "energy": 7,
    "sleep": 8,
    "stress": 3,
    "notes": "Felt great today",
    "caloriesConsumed": 2400,
    "proteinG": 180,
    "carbsG": 250,
    "fatG": 65,
    "trainingData": {
      "sessionCompleted": true,
      "trainingSessionId": "session-123",
      "trainingSessionName": "Push Day",
      "isAlternativeSession": false,
      "activityStatuses": {},
      "unplannedActivities": []
    }
  }
  ```

### Training
- `GET /api/client/training` - Get active training plan
- `GET /api/client/training/completions?weekStartDate={date}` - Get week's completions
- `POST /api/client/training/completions` - Mark session complete

### Nutrition
- `GET /api/client/nutrition` (alias: `GET /api/client/nutrition-plan`) - Get nutrition targets (`getClientNutritionTargets`)
  ```json
  {
    "planId": "…",
    "calorieTarget": 2200,
    "proteinTargetG": 180,
    "carbTargetG": 230,
    "fatTargetG": 70,
    "baselineCalories": 2200,
    "dietType": "balanced",
    "includeActivityBurn": true,
    "customMacrosEnabled": false,
    "dailyTargets": [
      {
        "day": "monday",
        "dayLabel": "Monday",
        "isTrainingDay": true,
        "calories": 2530,
        "baselineCalories": 2200,
        "proteinG": 180,
        "carbsG": 280,
        "fatG": 78,
        "proteinPercent": 28,
        "carbsPercent": 44,
        "fatPercent": 28,
        "trainingSessions": [{ "name": "Push", "calories": 330 }],
        "calorieSurplusPercentage": 15,
        "note": "Higher carbs — heavy session"
      }
      // … 7 entries, one per weekday of the CURRENT client-local week
    ]
  }
  ```

  > **RN contract — `dailyTargets` is a per-date window, not a 2-slot template (events-as-SOT, shipped Sessions 4-5).** The legacy `trainingDayCalories` / `restDayCalories` 2-slot shape is **gone**. `dailyTargets` is a **7-entry array, one per weekday of the current client-local week**, built from that week's actual `nutrition_events` — so a coach's per-day edit (`is_modified`) and per-day `note` show through, and the macro split honors `clients.surplus_as_carbs`. RN may still index by weekday, but **treat the values as date-specific to the current week**, not a generic weekly template. A coach edit to a **future** week surfaces on the per-date day-view (`GET /api/client/daily-logs/{date}/nutrition`), not this card, until that week becomes current. Logged past days read their frozen `nutrition_logs` snapshot (no `note`), never the event. Full field list: `DailyNutritionTargets` (`utils/nutrition-helpers.ts`).

### Progress
- `GET /api/client/progress?days={30|60|90}` - Get progress data
- Returns weight history, measurements, training consistency

### Check-ins
- `GET /api/client/check-ins?limit=20&offset=0` - Get check-in history
- `POST /api/client/check-ins` - Submit new check-in
- `GET /api/client/check-ins/{id}` - Get specific check-in
- `GET /api/client/check-in-context` - Get context for check-in form
- `GET /api/check-in/submit/{token}` - **PUBLIC** - Validate check-in token
- `POST /api/check-in/submit/{token}` - **PUBLIC** - Submit via magic link

### Notifications
- `GET /api/client/notifications` - Get notifications
- `POST /api/client/notifications/mark-read` - Mark as read

### Habits
- `GET /api/client/habits` - Get active habits
- `POST /api/client/habits/{id}/log` - Log habit completion

---

## Data Models

### DailyLog
```typescript
type DailyLog = {
  id: string
  clientId: string
  date: string // YYYY-MM-DD
  
  // Wellness
  mood?: number // 1-5
  energy?: number // 1-10
  sleep?: number // 1-10
  stress?: number // 1-10
  notes?: string
  
  // Training
  trained?: boolean
  trainingSessionId?: string
  trainingData?: {
    sessionCompleted: boolean
    trainingSessionId: string | null
    trainingSessionName: string | null
    isAlternativeSession: boolean
    activityStatuses: Record<string, {
      completed: boolean
      activityName: string
      estimatedCalories: number
    }>
    unplannedActivities: Array<{
      activityName: string
      intensityLevel: "low" | "moderate" | "vigorous"
      durationMinutes: number
    }>
  }
  
  // Nutrition
  caloriesConsumed?: number
  proteinG?: number
  carbsG?: number
  fatG?: number
  targetCalories?: number
  targetProteinG?: number
  targetCarbsG?: number
  targetFatG?: number
}
```

### TrainingPlan
```typescript
type TrainingPlan = {
  id: string
  clientId: string
  name: string
  status: "active" | "archived" | "draft"
  frequencyPerWeek: number
  sessions: TrainingSession[]
}

type TrainingSession = {
  id: string
  name: string
  dayOfWeek?: string
  orderIndex: number
  estimatedDurationMinutes?: number
  estimatedCalories?: number
  exercises: TrainingExercise[]
  sessionType: "training" | "external_activity"
}

type TrainingExercise = {
  id: string
  name: string
  sets: number
  repsMin?: number
  repsMax?: number
  rpeTarget?: number
  restSeconds?: number
  notes?: string
  supersetGroup?: string
}
```

### CheckIn
```typescript
type CheckIn = {
  id: string
  clientId: string
  
  // Subjective Metrics
  mood?: number
  energy?: number
  sleep?: number
  stress?: number
  
  // Body Metrics
  weight?: number
  bodyFatPercentage?: number
  measurements?: {
    waist?: number
    hips?: number
    chest?: number
    arms?: number
    thighs?: number
  }
  
  // Training Data
  sessionCompletions?: Array<{
    trainingSessionId: string
    sessionName: string
    completed: boolean
    completionQuality?: "full" | "partial" | "skipped"
  }>
  
  // Photos
  photoFront?: string // URL
  photoSide?: string // URL
  photoBack?: string // URL
  
  // AI Summary
  aiSummary?: string
  status: "pending" | "ai_processed" | "reviewed"
}
```

### Habit
```typescript
type Habit = {
  id: string
  clientId: string
  name: string
  type: "boolean" | "numeric"
  targetValue?: number
  unit?: string
  isActive: boolean
  createdAt: string
}

type HabitLog = {
  id: string
  habitId: string
  date: string // YYYY-MM-DD
  completed: boolean // Always boolean, even for numeric habits
  value?: number // Actual value for numeric habits
}
```

---

## User Flows

### 1. Daily Logging Flow
```mermaid
graph LR
    A[Open Dashboard] --> B[Daily Pulse Widget]
    B --> C[Select Day]
    C --> D[Log Wellness]
    D --> E[Mark Training]
    E --> F[Enter Nutrition]
    F --> G[Toggle Habits]
    G --> H[Save Day]
```

**Key Points**:
- Single save for wellness + training + nutrition (except habits)
- Habits auto-save independently
- Can navigate between days without losing unsaved changes
- Logged days show summary view with edit option

### 2. Check-in Submission Flow

**Authenticated Flow**:
1. Navigate to `/client/check-in`
2. Fill multi-step form
3. Upload progress photos
4. Submit → AI generates summary

**Magic Link Flow**:
1. Receive email with token link
2. Click link → `/check-in/[token]`
3. Token validated server-side
4. Complete form without login
5. Submit → Updates client record

### 3. Training Session Completion
1. View today's planned session in Daily Pulse
2. Toggle "Session Complete" 
3. Or select alternative session from dropdown
4. Add any unplanned activities
5. System calculates total calories burned
6. Nutrition targets auto-adjust

---

## Business Logic

### Nutrition Target Calculations

**Base Formula**:
```typescript
// Daily targets adjust based on activity
adjustedCalories = baselineCalories + trainingCalories + activityCalories

// Macros scale proportionally
proteinG = baseProteinG // Stays constant
carbsG = baseCarbsG + (additionalCalories * 0.60 / 4) // 60% from carbs
fatG = baseFatG + (additionalCalories * 0.40 / 9) // 40% from fat
```

**Training Day Adjustments**:
- Training sessions have estimated calories (AI-calculated)
- External activities use MET values
- Unplanned activities NOT included in target (only completed activities)

### Adherence Calculations

**Nutrition Adherence**:
- "hit" = Within 10% of target calories
- "partial" = Within 20% of target
- "missed" = Over 20% deviation or not logged

**Training Adherence**:
- Based on sessions completed / sessions planned
- Calculated weekly for check-ins

### Habit Streaks
```typescript
// Streak counts consecutive days completed
// Resets to 0 on miss
// Only counts habits that existed on that date
habits.filter(h => new Date(h.createdAt) <= selectedDate)
```

### Progress Photo Requirements
- Max file size: 5MB
- Accepted formats: JPEG, PNG, WebP
- Auto-compressed on upload
- Stored in Supabase Storage

---

## UI/UX Patterns

### Navigation Structure

**Mobile (< 640px)**:
- Bottom tab navigation
- 5 main sections: Home, Training, Nutrition, Progress, Resources
- Fixed position at bottom

**Desktop**:
- Left sidebar navigation
- Same 5 sections
- User profile and logout in header

### Color Schemes

**Wellness Metrics**:
- Mood: Emoji-based (😔 😕 😐 🙂 😊)
- Energy: Green gradient (low=red, med=yellow, high=green)
- Sleep: Blue gradient
- Stress: Red gradient (inverted - low is good)

**Adherence Indicators**:
- Green (#10b981): On track / Complete
- Amber (#f59e0b): Partial / Warning
- Red (#ef4444): Missed / Alert
- Gray (#6b7280): No data

### Component Patterns

**Cards**: Primary container for all content sections
```typescript
<Card>
  <CardHeader>
    <CardTitle>Section Title</CardTitle>
  </CardHeader>
  <CardContent>
    {/* Content */}
  </CardContent>
</Card>
```

**Loading States**: Skeleton components for all data fetches
```typescript
<Skeleton className="h-32 w-full" />
```

**Forms**: Controlled inputs with real-time validation
```typescript
<Input
  value={value}
  onChange={(e) => setValue(e.target.value)}
  placeholder="Enter value"
/>
```

### Responsive Design

**Breakpoints**:
- Mobile: < 640px
- Tablet: 640px - 1024px  
- Desktop: > 1024px

**Key Differences**:
- Mobile: Bottom navigation, stacked layouts
- Desktop: Sidebar navigation, grid layouts
- Touch targets: Min 44x44px on mobile

---

## State Management

### Client-Side State

**Authentication State**: Global via Context API
- User profile
- Role (client/trainer)
- Session status

**Daily Pulse State**: Local to component
```typescript
// All state owned by daily-pulse.tsx
const [selectedDate, setSelectedDate] = useState()
const [dayLog, setDayLog] = useState()
const [isLoading, setIsLoading] = useState()
const [isSaving, setIsSaving] = useState()
```

**Form State**: Controlled components
- All forms use controlled inputs
- Validation on submit
- Error states per field

### Data Fetching

**Cache Strategy**:
```typescript
// No caching for real-time data
fetch(url, { cache: 'no-store' })

// Response headers
'Cache-Control': 'no-store, max-age=0'
```

**Loading Patterns**:
1. Show skeleton/spinner
2. Fetch data
3. Handle errors with user feedback
4. Display data or empty state

### Offline Considerations (Mobile)

**Required Offline Features**:
- View cached training plan
- Log daily data (sync later)
- View previous check-ins
- Access resources

**Sync Strategy**:
- Queue actions when offline
- Sync on connection restore
- Conflict resolution (server wins)

---

## Coach-Client Interactions

### What Coaches Control
- Assign/update training plans
- Set nutrition targets
- Review check-ins and provide feedback
- Create/modify habits for client
- Send notifications

### Data Coaches See
- Aggregated Daily Pulse data (28-day view)
- All check-in submissions with photos
- Training completion rates
- Nutrition adherence patterns
- Wellness trends and alerts

### Automated Alerts
Coaches receive alerts when:
- Mood ≤ 2 for 3+ consecutive days
- Energy ≤ 3 for 3+ consecutive days  
- Stress ≥ 8 for 3+ consecutive days
- Sleep ≤ 4 for 3+ consecutive days
- Multiple metrics in warning zones

---

## File Structure Reference

### Client-Facing Routes
```
/app/
├── client/                    # All authenticated client pages
│   ├── dashboard/page.tsx     # Main dashboard with Daily Pulse
│   ├── training/page.tsx      # Training plans view
│   ├── nutrition/page.tsx     # Nutrition targets
│   ├── progress/page.tsx      # Progress tracking
│   ├── check-in/page.tsx      # Weekly check-in form
│   ├── resources/page.tsx     # Educational content
│   └── layout.tsx            # Client portal layout wrapper
└── check-in/[token]/page.tsx # Public check-in via magic link
```

### Client Components
```
/components/
├── daily-pulse/              # Daily Pulse feature (20 files)
│   ├── daily-pulse.tsx       # Main container
│   ├── wellness-section.tsx  # Mood, energy, sleep, stress
│   ├── training-section.tsx  # Training completion
│   ├── nutrition-section.tsx # Calorie/macro tracking
│   ├── habits-section.tsx    # Daily habits
│   └── utils/               # Helper functions
├── client/                   # Client-specific components
│   ├── notifications-dropdown.tsx
│   └── progress/            # Progress tracking components
└── client-portal/           # Shared portal components
    ├── client-navigation.tsx # Mobile/desktop nav
    ├── training/            # Training components
    └── nutrition/           # Nutrition components
```

### API Routes
```
/app/api/client/
├── daily-logs/route.ts      # Daily Pulse data
├── training/route.ts        # Training plans
├── nutrition/route.ts       # Nutrition targets
├── progress/route.ts        # Progress data
├── check-ins/route.ts       # Check-in submissions
├── notifications/route.ts   # In-app notifications
├── habits/route.ts          # Habit management
└── me/route.ts             # User profile
```

### Types & Services
```
/types/
├── auth.ts                 # User, Profile, Role types
├── training.ts             # TrainingPlan, Session, Exercise
├── check-in.ts             # CheckIn, metrics types
├── daily-log.ts            # DailyLog, training data
└── habit.ts               # Habit, HabitLog types

/services/
├── client-portal-service.ts # Client data fetching
├── daily-logs-service.ts    # Daily Pulse operations
├── check-in-service.ts      # Check-in handling
└── supabase-client.ts      # Database client
```

---

## Mobile App Development Guidelines

### Recommended Architecture

**Native Apps**:
- iOS: Swift/SwiftUI
- Android: Kotlin/Jetpack Compose
- Shared business logic via Kotlin Multiplatform (optional)

**Cross-Platform**:
- React Native (reuse React knowledge)
- Flutter (if starting fresh)

### Key Native Features to Add

1. **Biometric Authentication**: FaceID/TouchID/Fingerprint
2. **Push Notifications**: Check-in reminders, coach messages
3. **Camera Integration**: Progress photos with guides
4. **Health Kit/Google Fit**: Import weight, sleep data
5. **Offline Mode**: Cache critical data, sync when online
6. **Widgets**: Daily Pulse quick entry, today's workout

### API Integration

- Use existing REST endpoints unchanged
- Add mobile-specific headers for analytics
- Implement token refresh for long sessions
- Cache responses appropriately

### Platform-Specific Considerations

**iOS**:
- App Store requires privacy policy
- Health data requires special permissions
- Background fetch for notifications

**Android**:
- Material Design 3 guidelines
- Handle various screen sizes
- Battery optimization exemption for sync

---

## Version History

- **v1.0** (March 2024): Initial documentation
- Created for mobile app development reference
- Based on web app sessions 1-19

---

## Related Documentation

- [DAILY-PULSE-README.md](./DAILY-PULSE-README.md) - Detailed Daily Pulse architecture
- [CONVENTIONS.md](./CONVENTIONS.md) - Code style and conventions
- API documentation in individual route files

---

*This document should be updated whenever significant changes are made to the client-facing features or APIs.*