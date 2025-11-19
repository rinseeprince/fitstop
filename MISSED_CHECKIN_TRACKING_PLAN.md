# Client Check-In Tracking & Accountability Feature - Implementation Plan

## Problem Statement

**User Feedback:**
> "One issue I come across is chasing some clients for a check in, its my job to coach and hold them accountable but as things get busier, figuring out whos missed check in while reviewing others can be a bit messy. I think a feature that makes note of clients who havent checked in would be huge"

**Core Challenge:** As a PT's client roster grows, manually tracking who has/hasn't checked in becomes overwhelming. Currently, trainers must:
- Remember each client's check-in cadence
- Manually calculate who's overdue
- Switch between reviewing check-ins and identifying missing ones
- Chase clients reactively instead of proactively

**Desired Outcome:** A system that automatically identifies overdue clients, surfaces them prominently, and helps trainers stay on top of accountability without mental overhead.

---

## Difficulty Assessment: **Medium** (1.5-2 weeks for full implementation)

This is a high-value, achievable feature that builds on your existing infrastructure. The solution is mainly about smart querying, UI enhancements, and intelligent notifications rather than complex architecture changes.

---

## Solution Overview

### Core Features

1. **Client Check-In Expectations** - Define expected check-in frequency per client
2. **Overdue Detection Engine** - Automatically identify clients who've missed their expected check-in
3. **Dashboard Prominence** - Surface overdue clients at the top of views with visual indicators
4. **Proactive Reminders** - Send automated reminders to clients before/when they're overdue
5. **Coach Notifications** - Alert coaches about clients who haven't responded to reminders
6. **Historical Tracking** - Track check-in consistency over time (adherence rate)

### Design Principles

- **Zero Mental Overhead:** System should tell the coach exactly who to chase, no calculation needed
- **Actionable:** Every indicator should have a clear action (send reminder, view last check-in, etc.)
- **Flexible:** Different clients have different cadences (weekly, bi-weekly, monthly)
- **Non-Intrusive:** Helpful without being naggy for clients with irregular schedules
- **Data-Driven:** Show trends and patterns to identify chronic non-checkers

---

## Phase 1: Database Schema Enhancements (2-3 days)

### 1.1 Add Client Check-In Configuration

**Modify `clients` table:**

```sql
ALTER TABLE clients
ADD COLUMN check_in_frequency TEXT DEFAULT 'weekly', -- 'weekly', 'biweekly', 'monthly', 'custom', 'none'
ADD COLUMN check_in_frequency_days INTEGER, -- For 'custom' frequency
ADD COLUMN expected_check_in_day TEXT, -- e.g., 'monday', 'friday', or NULL for flexible
ADD COLUMN last_reminder_sent_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN reminder_preferences JSONB DEFAULT '{"enabled": true, "auto_send": false, "send_before_hours": 24}';
```

**Field Explanations:**
- `check_in_frequency`: Preset options for common cadences
- `check_in_frequency_days`: If frequency = 'custom', use this many days
- `expected_check_in_day`: Optional - some clients check in on specific days (e.g., every Monday)
- `last_reminder_sent_at`: Track when last automated reminder was sent
- `reminder_preferences`: JSONB config for reminder behavior
  - `enabled`: Whether client should receive reminders
  - `auto_send`: If true, system auto-sends reminders when overdue
  - `send_before_hours`: Send reminder X hours before check-in is expected

### 1.2 Create Check-In Reminders Tracking Table

**New table: `check_in_reminders`**

```sql
CREATE TABLE check_in_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  reminder_type TEXT NOT NULL, -- 'upcoming', 'overdue', 'follow_up'
  days_overdue INTEGER, -- NULL if not overdue yet, positive integer if overdue
  responded BOOLEAN DEFAULT false,
  responded_at TIMESTAMP WITH TIME ZONE,
  check_in_id UUID REFERENCES check_ins(id) ON DELETE SET NULL, -- Linked if reminder resulted in check-in
  sent_via TEXT DEFAULT 'system', -- 'system', 'manual'
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_check_in_reminders_client_id ON check_in_reminders(client_id);
CREATE INDEX idx_check_in_reminders_sent_at ON check_in_reminders(sent_at DESC);
CREATE INDEX idx_check_in_reminders_responded ON check_in_reminders(responded, client_id);
```

**Purpose:** Track all reminders sent to clients, response rates, and effectiveness of accountability measures.

### 1.3 Add Analytics Fields to Track Adherence

**Modify `clients` table (Part 2):**

```sql
ALTER TABLE clients
ADD COLUMN total_check_ins_expected INTEGER DEFAULT 0,
ADD COLUMN total_check_ins_completed INTEGER DEFAULT 0,
ADD COLUMN check_in_adherence_rate DECIMAL(5,2), -- Percentage (0-100)
ADD COLUMN current_streak INTEGER DEFAULT 0, -- Consecutive on-time check-ins
ADD COLUMN longest_streak INTEGER DEFAULT 0;
```

**These fields will be calculated via a scheduled job or trigger:**
- Count expected check-ins based on frequency since client creation
- Count actual check-ins submitted
- Calculate adherence rate %
- Track streaks for gamification/motivation

---

## Phase 2: Business Logic & Calculations (2-3 days)

### 2.1 Create Service Layer Functions

**File: `services/check-in-tracking-service.ts`**

```typescript
// Calculate when next check-in is expected
export function calculateNextExpectedCheckIn(client: Client): Date | null {
  const lastCheckIn = client.lastCheckInDate
    ? new Date(client.lastCheckInDate)
    : new Date(client.createdAt);

  if (client.checkInFrequency === 'none') return null;

  const frequencyMap = {
    'weekly': 7,
    'biweekly': 14,
    'monthly': 30,
    'custom': client.checkInFrequencyDays || 7
  };

  const daysToAdd = frequencyMap[client.checkInFrequency];
  const nextDate = addDays(lastCheckIn, daysToAdd);

  // If expected_check_in_day is set, adjust to that day of week
  if (client.expectedCheckInDay) {
    return getNextDayOfWeek(nextDate, client.expectedCheckInDay);
  }

  return nextDate;
}

// Calculate if client is overdue
export function isClientOverdue(client: Client): boolean {
  const nextExpected = calculateNextExpectedCheckIn(client);
  if (!nextExpected) return false;

  const now = new Date();
  return now > nextExpected;
}

// Get days overdue (negative if upcoming, positive if overdue)
export function getDaysUntilOrPastDue(client: Client): number {
  const nextExpected = calculateNextExpectedCheckIn(client);
  if (!nextExpected) return 0;

  const now = new Date();
  return differenceInDays(now, nextExpected); // Positive = overdue, negative = upcoming
}

// Categorize overdue severity
export function getOverdueSeverity(daysOverdue: number): 'upcoming' | 'due_soon' | 'overdue' | 'critically_overdue' {
  if (daysOverdue < -3) return 'upcoming';
  if (daysOverdue < 0) return 'due_soon';
  if (daysOverdue <= 3) return 'overdue';
  return 'critically_overdue';
}

// Get all overdue clients for a coach
export async function getOverdueClients(coachId: string): Promise<OverdueClient[]> {
  const clients = await getClientsForCoach(coachId);

  const overdueClients = clients
    .filter(client => client.active && client.checkInFrequency !== 'none')
    .map(client => ({
      ...client,
      nextExpectedCheckIn: calculateNextExpectedCheckIn(client),
      daysOverdue: getDaysUntilOrPastDue(client),
      severity: getOverdueSeverity(getDaysUntilOrPastDue(client))
    }))
    .filter(client => client.daysOverdue >= 0) // Only show overdue, not upcoming
    .sort((a, b) => b.daysOverdue - a.daysOverdue); // Most overdue first

  return overdueClients;
}

// Get clients due soon (within next 48 hours)
export async function getClientsDueSoon(coachId: string): Promise<ClientDueSoon[]> {
  const clients = await getClientsForCoach(coachId);

  return clients
    .filter(client => client.active && client.checkInFrequency !== 'none')
    .map(client => ({
      ...client,
      nextExpectedCheckIn: calculateNextExpectedCheckIn(client),
      daysUntilDue: getDaysUntilOrPastDue(client)
    }))
    .filter(client => client.daysUntilDue < 0 && client.daysUntilDue >= -2) // Due within next 2 days
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue); // Soonest first
}

// Calculate check-in adherence rate
export async function calculateCheckInAdherence(clientId: string): Promise<number> {
  const client = await getClientById(clientId);
  if (!client) return 0;

  const accountAge = differenceInDays(new Date(), new Date(client.createdAt));
  const frequencyDays = getFrequencyInDays(client.checkInFrequency, client.checkInFrequencyDays);

  if (frequencyDays === 0) return 100; // No expectation = 100% adherence

  const expectedCount = Math.floor(accountAge / frequencyDays);
  const actualCount = await getCheckInCount(clientId);

  if (expectedCount === 0) return 100; // Too new to calculate

  const adherenceRate = (actualCount / expectedCount) * 100;
  return Math.min(adherenceRate, 100); // Cap at 100%
}

// Update client adherence stats (run this as a scheduled job or trigger)
export async function updateClientAdherenceStats(clientId: string): Promise<void> {
  const adherenceRate = await calculateCheckInAdherence(clientId);
  const currentStreak = await calculateCurrentStreak(clientId);
  const longestStreak = await calculateLongestStreak(clientId);

  await supabaseAdmin
    .from('clients')
    .update({
      check_in_adherence_rate: adherenceRate,
      current_streak: currentStreak,
      longest_streak: longestStreak,
      updated_at: new Date().toISOString()
    })
    .eq('id', clientId);
}
```

### 2.2 Create Reminder Service

**File: `services/reminder-service.ts`**

```typescript
// Send check-in reminder to client
export async function sendCheckInReminder(
  clientId: string,
  reminderType: 'upcoming' | 'overdue' | 'follow_up',
  manualSend: boolean = false
): Promise<{ success: boolean; reminderId?: string }> {
  const client = await getClientById(clientId);
  if (!client) return { success: false };

  // Check if reminder already sent recently (avoid spam)
  if (!manualSend && client.lastReminderSentAt) {
    const hoursSinceLastReminder = differenceInHours(new Date(), new Date(client.lastReminderSentAt));
    if (hoursSinceLastReminder < 24) {
      return { success: false }; // Don't send if sent within last 24 hours
    }
  }

  // Generate new check-in token
  const { token, expiresAt } = await createCheckInToken(clientId);
  const checkInLink = generateCheckInLink(token);

  // TODO: Send email/SMS with link
  // For now, we'll just create the token and track the reminder

  // Log reminder in database
  const daysOverdue = getDaysUntilOrPastDue(client);
  const reminder = await supabaseAdmin
    .from('check_in_reminders')
    .insert({
      client_id: clientId,
      reminder_type: reminderType,
      days_overdue: daysOverdue > 0 ? daysOverdue : null,
      sent_via: manualSend ? 'manual' : 'system'
    })
    .select()
    .single();

  // Update last reminder sent timestamp
  await supabaseAdmin
    .from('clients')
    .update({ last_reminder_sent_at: new Date().toISOString() })
    .eq('id', clientId);

  return { success: true, reminderId: reminder.data?.id };
}

// Automated job to send reminders (run daily)
export async function sendAutomatedReminders(coachId: string): Promise<{ sent: number }> {
  const clients = await getClientsForCoach(coachId);
  let sentCount = 0;

  for (const client of clients) {
    // Skip if reminders disabled
    if (!client.reminderPreferences?.enabled || !client.reminderPreferences?.auto_send) {
      continue;
    }

    const daysOverdue = getDaysUntilOrPastDue(client);

    // Send "upcoming" reminder if due within send_before_hours
    const sendBeforeHours = client.reminderPreferences?.send_before_hours || 24;
    const hoursUntilDue = daysOverdue * -24; // Negative days = hours until due

    if (hoursUntilDue > 0 && hoursUntilDue <= sendBeforeHours) {
      const result = await sendCheckInReminder(client.id, 'upcoming', false);
      if (result.success) sentCount++;
    }

    // Send "overdue" reminder if 1+ days overdue
    else if (daysOverdue >= 1 && daysOverdue <= 3) {
      const result = await sendCheckInReminder(client.id, 'overdue', false);
      if (result.success) sentCount++;
    }

    // Send "follow_up" reminder if 4+ days overdue
    else if (daysOverdue >= 4) {
      const result = await sendCheckInReminder(client.id, 'follow_up', false);
      if (result.success) sentCount++;
    }
  }

  return { sent: sentCount };
}

// Mark reminder as responded when client submits check-in
export async function markReminderAsResponded(clientId: string, checkInId: string): Promise<void> {
  // Find most recent unanswered reminder for this client
  const { data: reminder } = await supabaseAdmin
    .from('check_in_reminders')
    .select('*')
    .eq('client_id', clientId)
    .eq('responded', false)
    .order('sent_at', { ascending: false })
    .limit(1)
    .single();

  if (reminder) {
    await supabaseAdmin
      .from('check_in_reminders')
      .update({
        responded: true,
        responded_at: new Date().toISOString(),
        check_in_id: checkInId
      })
      .eq('id', reminder.id);
  }
}
```

---

## Phase 3: API Routes & Data Access (1-2 days)

### 3.1 New API Endpoints

**File: `app/api/clients/overdue/route.ts`**

```typescript
// GET /api/clients/overdue
// Returns all overdue clients for the authenticated coach
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const coach = await getCoachByUserId(session.user.id);
  if (!coach) {
    return NextResponse.json({ error: 'Coach not found' }, { status: 404 });
  }

  const overdueClients = await getOverdueClients(coach.id);

  return NextResponse.json({
    clients: overdueClients,
    total: overdueClients.length
  });
}
```

**File: `app/api/clients/due-soon/route.ts`**

```typescript
// GET /api/clients/due-soon
// Returns clients with check-ins due in next 48 hours
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const coach = await getCoachByUserId(session.user.id);
  if (!coach) {
    return NextResponse.json({ error: 'Coach not found' }, { status: 404 });
  }

  const clientsDueSoon = await getClientsDueSoon(coach.id);

  return NextResponse.json({
    clients: clientsDueSoon,
    total: clientsDueSoon.length
  });
}
```

**File: `app/api/clients/[id]/reminder/route.ts`**

```typescript
// POST /api/clients/[id]/reminder
// Manually send a check-in reminder to a client
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { reminderType = 'overdue' } = await request.json();

  const result = await sendCheckInReminder(params.id, reminderType, true);

  if (result.success) {
    return NextResponse.json({
      success: true,
      reminderId: result.reminderId
    });
  } else {
    return NextResponse.json({
      error: 'Failed to send reminder'
    }, { status: 500 });
  }
}
```

**File: `app/api/clients/[id]/check-in-config/route.ts`**

```typescript
// PATCH /api/clients/[id]/check-in-config
// Update client's check-in frequency and reminder preferences
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const data = await request.json();
  const {
    checkInFrequency,
    checkInFrequencyDays,
    expectedCheckInDay,
    reminderPreferences
  } = data;

  const client = await updateClient(params.id, {
    check_in_frequency: checkInFrequency,
    check_in_frequency_days: checkInFrequencyDays,
    expected_check_in_day: expectedCheckInDay,
    reminder_preferences: reminderPreferences
  });

  return NextResponse.json({ client });
}
```

### 3.2 Update Existing Endpoints

**Modify: `app/api/check-in/submit/[token]/route.ts`**

After successful check-in submission, add:

```typescript
// Mark reminder as responded if there was one
await markReminderAsResponded(clientId, newCheckIn.id);

// Update client adherence stats
await updateClientAdherenceStats(clientId);
```

---

## Phase 4: Dashboard UI Enhancements (3-4 days)

### 4.1 Overdue Clients Banner Component

**File: `components/clients/overdue-banner.tsx`**

```tsx
'use client';

import { useOverdueClients } from '@/hooks/use-overdue-clients';
import { AlertTriangle, Send } from 'lucide-react';

export function OverdueBanner() {
  const { clients, isLoading } = useOverdueClients();

  if (isLoading || clients.length === 0) return null;

  const criticalCount = clients.filter(c => c.severity === 'critically_overdue').length;
  const overdueCount = clients.length;

  return (
    <div className="bg-amber-50 border-l-4 border-amber-400 p-4 mb-6">
      <div className="flex items-start">
        <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5" />
        <div className="ml-3 flex-1">
          <h3 className="text-sm font-medium text-amber-800">
            {overdueCount} {overdueCount === 1 ? 'client is' : 'clients are'} overdue for check-ins
          </h3>
          {criticalCount > 0 && (
            <p className="text-sm text-amber-700 mt-1">
              {criticalCount} critically overdue (4+ days)
            </p>
          )}
          <div className="mt-2">
            <button
              onClick={() => {/* Navigate to overdue filter view */}}
              className="text-sm font-medium text-amber-800 hover:text-amber-900"
            >
              View overdue clients →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Place this component:**
- Top of Clients Dashboard (`/app/clients/page.tsx`)
- Top of Coach Dashboard/Home (`/app/page.tsx` or `/app/dashboard/page.tsx`)

### 4.2 Enhanced Client List with Overdue Indicators

**Modify: `app/clients/page.tsx`**

Add filtering and visual indicators:

```tsx
// Add tabs/filters
const [filter, setFilter] = useState<'all' | 'overdue' | 'due_soon' | 'on_track'>('all');

// Filter logic
const filteredClients = useMemo(() => {
  switch (filter) {
    case 'overdue':
      return clients.filter(c => isClientOverdue(c));
    case 'due_soon':
      return clients.filter(c => {
        const days = getDaysUntilOrPastDue(c);
        return days < 0 && days >= -2;
      });
    case 'on_track':
      return clients.filter(c => !isClientOverdue(c));
    default:
      return clients;
  }
}, [clients, filter]);

// Visual badges in client list
{client.isOverdue && (
  <Badge variant="destructive" className="ml-2">
    {client.daysOverdue}d overdue
  </Badge>
)}
```

### 4.3 Client Card Enhancements

**File: `components/clients/client-card.tsx`**

Add visual indicators and quick actions:

```tsx
export function ClientCard({ client }: { client: ClientWithCheckInInfo }) {
  const daysOverdue = getDaysUntilOrPastDue(client);
  const severity = getOverdueSeverity(daysOverdue);
  const nextExpected = calculateNextExpectedCheckIn(client);

  return (
    <Card className={cn(
      "relative",
      severity === 'critically_overdue' && "border-red-500 border-2",
      severity === 'overdue' && "border-amber-500"
    )}>
      {/* Existing card content */}

      {/* Check-in status section */}
      <div className="mt-4 pt-4 border-t">
        <div className="flex items-center justify-between text-sm">
          <div>
            <p className="text-muted-foreground">Next check-in:</p>
            <p className="font-medium">
              {nextExpected ? format(nextExpected, 'MMM d, yyyy') : 'Not scheduled'}
            </p>
          </div>

          {daysOverdue > 0 && (
            <Badge variant="destructive">
              {daysOverdue}d overdue
            </Badge>
          )}

          {daysOverdue < 0 && daysOverdue >= -2 && (
            <Badge variant="warning">
              Due in {Math.abs(daysOverdue)}d
            </Badge>
          )}
        </div>

        {/* Quick action: Send reminder */}
        {daysOverdue >= 0 && (
          <Button
            variant="outline"
            size="sm"
            className="w-full mt-2"
            onClick={() => handleSendReminder(client.id)}
          >
            <Send className="h-4 w-4 mr-2" />
            Send Reminder
          </Button>
        )}
      </div>
    </Card>
  );
}
```

### 4.4 Overdue Clients View

**New Page: `app/clients/overdue/page.tsx`**

Dedicated page showing only overdue clients with detailed information:

```tsx
export default function OverdueClientsPage() {
  const { clients, isLoading } = useOverdueClients();

  const criticallyOverdue = clients.filter(c => c.daysOverdue > 3);
  const overdue = clients.filter(c => c.daysOverdue >= 1 && c.daysOverdue <= 3);

  return (
    <div className="container py-8">
      <h1 className="text-3xl font-bold mb-6">Overdue Check-Ins</h1>

      {criticallyOverdue.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-semibold text-red-600 mb-4">
            Critically Overdue (4+ days)
          </h2>
          <div className="grid gap-4">
            {criticallyOverdue.map(client => (
              <OverdueClientCard key={client.id} client={client} />
            ))}
          </div>
        </section>
      )}

      {overdue.length > 0 && (
        <section>
          <h2 className="text-xl font-semibold text-amber-600 mb-4">
            Overdue (1-3 days)
          </h2>
          <div className="grid gap-4">
            {overdue.map(client => (
              <OverdueClientCard key={client.id} client={client} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
```

### 4.5 Client Profile - Check-In Schedule Section

**Modify: `app/clients/[id]/page.tsx`**

Add a "Check-In Schedule" section to client profile:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Check-In Schedule</CardTitle>
  </CardHeader>
  <CardContent>
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium">Frequency</label>
        <Select
          value={client.checkInFrequency}
          onValueChange={(value) => updateCheckInConfig({ checkInFrequency: value })}
        >
          <SelectItem value="weekly">Weekly</SelectItem>
          <SelectItem value="biweekly">Bi-weekly</SelectItem>
          <SelectItem value="monthly">Monthly</SelectItem>
          <SelectItem value="custom">Custom</SelectItem>
          <SelectItem value="none">No schedule</SelectItem>
        </Select>
      </div>

      {client.checkInFrequency === 'custom' && (
        <div>
          <label className="text-sm font-medium">Every X days</label>
          <Input
            type="number"
            value={client.checkInFrequencyDays}
            onChange={(e) => updateCheckInConfig({ checkInFrequencyDays: parseInt(e.target.value) })}
          />
        </div>
      )}

      <div>
        <label className="text-sm font-medium">Expected day (optional)</label>
        <Select
          value={client.expectedCheckInDay}
          onValueChange={(value) => updateCheckInConfig({ expectedCheckInDay: value })}
        >
          <SelectItem value="null">Any day</SelectItem>
          <SelectItem value="monday">Monday</SelectItem>
          <SelectItem value="tuesday">Tuesday</SelectItem>
          {/* ... other days */}
        </Select>
      </div>

      <div className="pt-4 border-t">
        <h4 className="font-medium mb-2">Adherence Stats</h4>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Adherence Rate</p>
            <p className="text-2xl font-bold">{client.checkInAdherenceRate}%</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Current Streak</p>
            <p className="text-2xl font-bold">{client.currentStreak}</p>
          </div>
        </div>
      </div>
    </div>
  </CardContent>
</Card>
```

### 4.6 Reminder History Modal

**Component: `components/clients/reminder-history-modal.tsx`**

Show history of reminders sent to a client:

```tsx
export function ReminderHistoryModal({ clientId }: { clientId: string }) {
  const { reminders, isLoading } = useClientReminders(clientId);

  return (
    <Dialog>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reminder History</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {reminders.map(reminder => (
            <div key={reminder.id} className="flex items-start gap-3 p-3 border rounded-lg">
              <div className="flex-1">
                <p className="font-medium">
                  {reminder.reminderType === 'upcoming' && 'Upcoming Check-In'}
                  {reminder.reminderType === 'overdue' && 'Overdue Reminder'}
                  {reminder.reminderType === 'follow_up' && 'Follow-Up Reminder'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {format(new Date(reminder.sentAt), 'MMM d, yyyy h:mm a')}
                </p>
                {reminder.daysOverdue && (
                  <p className="text-sm text-red-600">{reminder.daysOverdue} days overdue</p>
                )}
              </div>

              {reminder.responded ? (
                <Badge variant="success">Responded</Badge>
              ) : (
                <Badge variant="secondary">No response</Badge>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

---

## Phase 5: Data Hooks & Client-Side State (1 day)

### 5.1 Create Custom Hooks

**File: `hooks/use-overdue-clients.ts`**

```typescript
import useSWR from 'swr';

export function useOverdueClients() {
  const { data, error, mutate } = useSWR(
    '/api/clients/overdue',
    fetcher,
    { refreshInterval: 60000 } // Refresh every minute
  );

  return {
    clients: data?.clients || [],
    total: data?.total || 0,
    isLoading: !error && !data,
    isError: error,
    mutate
  };
}

export function useClientsDueSoon() {
  const { data, error, mutate } = useSWR(
    '/api/clients/due-soon',
    fetcher,
    { refreshInterval: 60000 }
  );

  return {
    clients: data?.clients || [],
    total: data?.total || 0,
    isLoading: !error && !data,
    isError: error,
    mutate
  };
}

export function useClientReminders(clientId: string) {
  const { data, error, mutate } = useSWR(
    `/api/clients/${clientId}/reminders`,
    fetcher
  );

  return {
    reminders: data?.reminders || [],
    isLoading: !error && !data,
    isError: error,
    mutate
  };
}
```

---

## Phase 6: Notifications & Alerts (2 days)

### 6.1 Coach Dashboard Notifications

**Add to navbar or dedicated notifications dropdown:**

```tsx
export function NotificationsDropdown() {
  const { clients: overdueClients } = useOverdueClients();
  const { clients: dueSoonClients } = useClientsDueSoon();

  const totalAlerts = overdueClients.length + dueSoonClients.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Bell className="h-5 w-5" />
        {totalAlerts > 0 && (
          <Badge variant="destructive" className="absolute -top-2 -right-2">
            {totalAlerts}
          </Badge>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80">
        {overdueClients.length > 0 && (
          <div className="p-3 border-b">
            <h4 className="font-medium text-sm mb-2">Overdue Check-Ins</h4>
            {overdueClients.slice(0, 3).map(client => (
              <div key={client.id} className="flex items-center justify-between py-2">
                <span className="text-sm">{client.name}</span>
                <Badge variant="destructive" size="sm">{client.daysOverdue}d</Badge>
              </div>
            ))}
            {overdueClients.length > 3 && (
              <Link href="/clients/overdue" className="text-xs text-blue-600">
                View all {overdueClients.length} overdue clients
              </Link>
            )}
          </div>
        )}

        {dueSoonClients.length > 0 && (
          <div className="p-3">
            <h4 className="font-medium text-sm mb-2">Due Soon</h4>
            {dueSoonClients.slice(0, 3).map(client => (
              <div key={client.id} className="flex items-center justify-between py-2">
                <span className="text-sm">{client.name}</span>
                <span className="text-xs text-muted-foreground">
                  in {Math.abs(client.daysUntilDue)}d
                </span>
              </div>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

### 6.2 Browser Notifications (Optional)

Add Web Push API integration to send browser notifications when clients become overdue.

---

## Phase 7: Email/SMS Reminder System (3-4 days)

### 7.1 Email Template for Reminders

**File: `emails/check-in-reminder.tsx`** (using React Email or similar)

```tsx
export function CheckInReminderEmail({
  clientName,
  coachName,
  checkInLink,
  daysOverdue
}: CheckInReminderProps) {
  return (
    <Html>
      <Head />
      <Body>
        <Container>
          <Heading>Hi {clientName}!</Heading>

          {daysOverdue === 0 ? (
            <Text>
              Your weekly check-in with {coachName} is ready! Taking just a few
              minutes to complete this helps {coachName} provide you with the best
              possible coaching.
            </Text>
          ) : (
            <Text>
              It looks like we haven't received your check-in yet (now {daysOverdue}
              {daysOverdue === 1 ? ' day' : ' days'} overdue). {coachName} is looking
              forward to seeing your progress!
            </Text>
          )}

          <Button href={checkInLink}>
            Complete Check-In Now
          </Button>

          <Text className="text-sm text-gray-500">
            This link expires in 7 days. If you have questions, reply to this email
            to reach {coachName} directly.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
```

### 7.2 Email Sending Integration

**Options:**
- **Resend** (recommended - simple, affordable)
- **SendGrid**
- **Postmark**
- **AWS SES**

**Implementation in reminder service:**

```typescript
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendCheckInReminderEmail(
  client: Client,
  coach: Coach,
  checkInLink: string,
  daysOverdue: number
) {
  await resend.emails.send({
    from: `${coach.name} <noreply@yourdomain.com>`,
    to: client.email,
    subject: daysOverdue > 0
      ? `Check-In Reminder - ${daysOverdue}d overdue`
      : 'Time for your check-in!',
    react: CheckInReminderEmail({
      clientName: client.name,
      coachName: coach.name,
      checkInLink,
      daysOverdue
    })
  });
}
```

---

## Phase 8: Automated Jobs & Cron Tasks (1-2 days)

### 8.1 Set Up Cron Job for Automated Reminders

**Option 1: Vercel Cron (if using Vercel)**

**File: `app/api/cron/send-reminders/route.ts`**

```typescript
export async function GET(request: Request) {
  // Verify cron secret to prevent unauthorized access
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get all coaches
  const coaches = await getAllCoaches();

  let totalSent = 0;
  for (const coach of coaches) {
    const result = await sendAutomatedReminders(coach.id);
    totalSent += result.sent;
  }

  return NextResponse.json({
    success: true,
    remindersSent: totalSent
  });
}
```

**Configure in `vercel.json`:**

```json
{
  "crons": [
    {
      "path": "/api/cron/send-reminders",
      "schedule": "0 9 * * *"
    }
  ]
}
```

**Option 2: Supabase Edge Functions with pg_cron**

**Option 3: External cron service (cron-job.org, EasyCron)**

### 8.2 Daily Adherence Stats Update Job

**File: `app/api/cron/update-adherence/route.ts`**

```typescript
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const clients = await getAllActiveClients();

  for (const client of clients) {
    await updateClientAdherenceStats(client.id);
  }

  return NextResponse.json({
    success: true,
    clientsUpdated: clients.length
  });
}
```

Run daily at midnight.

---

## Phase 9: Analytics & Reporting (2 days)

### 9.1 Coach Analytics Dashboard

**New page: `app/analytics/page.tsx`**

Show coach-level analytics:
- Overall client adherence rate
- Clients at risk (consistently overdue)
- Response rate to reminders
- Best/worst check-in days
- Trends over time

### 9.2 Individual Client Trends

**Add to client profile:**
- Check-in adherence chart over time
- Response to reminders (how quickly they respond after reminder sent)
- Identify patterns (e.g., always late on Mondays)

---

## TypeScript Type Additions

**File: `types/check-in.ts`**

```typescript
export type CheckInFrequency = 'weekly' | 'biweekly' | 'monthly' | 'custom' | 'none';

export type ReminderType = 'upcoming' | 'overdue' | 'follow_up';

export type OverdueSeverity = 'upcoming' | 'due_soon' | 'overdue' | 'critically_overdue';

export type ReminderPreferences = {
  enabled: boolean;
  auto_send: boolean;
  send_before_hours: number; // Send reminder X hours before due
};

export type ClientCheckInConfig = {
  checkInFrequency: CheckInFrequency;
  checkInFrequencyDays?: number; // For 'custom' frequency
  expectedCheckInDay?: string; // 'monday', 'tuesday', etc.
  reminderPreferences: ReminderPreferences;
};

export type OverdueClient = Client & {
  nextExpectedCheckIn: Date | null;
  daysOverdue: number;
  severity: OverdueSeverity;
  lastReminderSent?: string;
};

export type ClientDueSoon = Client & {
  nextExpectedCheckIn: Date | null;
  daysUntilDue: number; // Negative number (e.g., -1 = due in 1 day)
};

export type CheckInReminder = {
  id: string;
  clientId: string;
  sentAt: string;
  reminderType: ReminderType;
  daysOverdue: number | null;
  responded: boolean;
  respondedAt?: string;
  checkInId?: string;
  sentVia: 'system' | 'manual';
  notes?: string;
  createdAt: string;
};

export type ClientAdherenceStats = {
  totalCheckInsExpected: number;
  totalCheckInsCompleted: number;
  checkInAdherenceRate: number; // Percentage 0-100
  currentStreak: number;
  longestStreak: number;
};
```

---

## Migration Script

**File: `supabase/migrations/008_add_check_in_tracking.sql`**

```sql
-- Add check-in configuration fields to clients table
ALTER TABLE clients
ADD COLUMN check_in_frequency TEXT DEFAULT 'weekly',
ADD COLUMN check_in_frequency_days INTEGER,
ADD COLUMN expected_check_in_day TEXT,
ADD COLUMN last_reminder_sent_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN reminder_preferences JSONB DEFAULT '{"enabled": true, "auto_send": false, "send_before_hours": 24}',
ADD COLUMN total_check_ins_expected INTEGER DEFAULT 0,
ADD COLUMN total_check_ins_completed INTEGER DEFAULT 0,
ADD COLUMN check_in_adherence_rate DECIMAL(5,2),
ADD COLUMN current_streak INTEGER DEFAULT 0,
ADD COLUMN longest_streak INTEGER DEFAULT 0;

-- Create check-in reminders table
CREATE TABLE check_in_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('upcoming', 'overdue', 'follow_up')),
  days_overdue INTEGER,
  responded BOOLEAN DEFAULT false,
  responded_at TIMESTAMP WITH TIME ZONE,
  check_in_id UUID REFERENCES check_ins(id) ON DELETE SET NULL,
  sent_via TEXT DEFAULT 'system' CHECK (sent_via IN ('system', 'manual')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_check_in_reminders_client_id ON check_in_reminders(client_id);
CREATE INDEX idx_check_in_reminders_sent_at ON check_in_reminders(sent_at DESC);
CREATE INDEX idx_check_in_reminders_responded ON check_in_reminders(responded, client_id);
CREATE INDEX idx_clients_check_in_frequency ON clients(check_in_frequency);
CREATE INDEX idx_clients_last_reminder_sent_at ON clients(last_reminder_sent_at);

-- RLS Policies for check_in_reminders
ALTER TABLE check_in_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coaches can view reminders for their clients"
  ON check_in_reminders
  FOR SELECT
  USING (
    client_id IN (
      SELECT id FROM clients
      WHERE coach_id IN (
        SELECT id FROM coaches WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Coaches can create reminders for their clients"
  ON check_in_reminders
  FOR INSERT
  WITH CHECK (
    client_id IN (
      SELECT id FROM clients
      WHERE coach_id IN (
        SELECT id FROM coaches WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Coaches can update reminders for their clients"
  ON check_in_reminders
  FOR UPDATE
  USING (
    client_id IN (
      SELECT id FROM clients
      WHERE coach_id IN (
        SELECT id FROM coaches WHERE user_id = auth.uid()
      )
    )
  );

-- Function to auto-update adherence stats (optional - can be done via cron instead)
CREATE OR REPLACE FUNCTION update_client_adherence_stats(client_uuid UUID)
RETURNS void AS $$
DECLARE
  account_age_days INTEGER;
  frequency_days INTEGER;
  expected_count INTEGER;
  actual_count INTEGER;
  adherence_rate DECIMAL(5,2);
BEGIN
  -- Get client's account age
  SELECT EXTRACT(DAY FROM NOW() - created_at)::INTEGER
  INTO account_age_days
  FROM clients
  WHERE id = client_uuid;

  -- Get frequency in days
  SELECT
    CASE check_in_frequency
      WHEN 'weekly' THEN 7
      WHEN 'biweekly' THEN 14
      WHEN 'monthly' THEN 30
      WHEN 'custom' THEN COALESCE(check_in_frequency_days, 7)
      ELSE 0
    END
  INTO frequency_days
  FROM clients
  WHERE id = client_uuid;

  -- Calculate expected count
  IF frequency_days > 0 THEN
    expected_count := FLOOR(account_age_days / frequency_days);
  ELSE
    expected_count := 0;
  END IF;

  -- Get actual count
  SELECT COUNT(*)::INTEGER
  INTO actual_count
  FROM check_ins
  WHERE client_id = client_uuid;

  -- Calculate adherence rate
  IF expected_count > 0 THEN
    adherence_rate := LEAST((actual_count::DECIMAL / expected_count::DECIMAL) * 100, 100);
  ELSE
    adherence_rate := 100;
  END IF;

  -- Update client record
  UPDATE clients
  SET
    total_check_ins_expected = expected_count,
    total_check_ins_completed = actual_count,
    check_in_adherence_rate = adherence_rate,
    updated_at = NOW()
  WHERE id = client_uuid;
END;
$$ LANGUAGE plpgsql;

-- Trigger to mark reminder as responded when check-in is created
CREATE OR REPLACE FUNCTION mark_reminder_responded()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE check_in_reminders
  SET
    responded = true,
    responded_at = NOW(),
    check_in_id = NEW.id
  WHERE
    client_id = NEW.client_id
    AND responded = false
    AND id = (
      SELECT id FROM check_in_reminders
      WHERE client_id = NEW.client_id AND responded = false
      ORDER BY sent_at DESC
      LIMIT 1
    );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_mark_reminder_responded
  AFTER INSERT ON check_ins
  FOR EACH ROW
  EXECUTE FUNCTION mark_reminder_responded();

COMMENT ON TABLE check_in_reminders IS 'Tracks all check-in reminders sent to clients';
COMMENT ON COLUMN clients.check_in_frequency IS 'Expected check-in frequency: weekly, biweekly, monthly, custom, none';
COMMENT ON COLUMN clients.check_in_adherence_rate IS 'Percentage of expected check-ins completed (0-100)';
```

---

## Implementation Timeline

### Week 1: Foundation & Data Layer
- **Days 1-2:** Database schema migrations + TypeScript types
- **Day 3:** Service layer functions (check-in-tracking-service.ts, reminder-service.ts)
- **Days 4-5:** API routes + testing

### Week 2: UI & Dashboard Enhancements
- **Days 1-2:** Overdue banner, client list enhancements, filters
- **Day 3:** Client profile check-in schedule section
- **Days 4-5:** Overdue clients page, reminder history modal

### Week 3 (Optional): Automation & Polish
- **Days 1-2:** Email/SMS reminder system integration
- **Day 3:** Cron jobs for automated reminders + adherence updates
- **Days 4-5:** Analytics dashboard, polish, bug fixes

---

## Success Metrics

**For Coaches:**
- Reduction in time spent manually tracking overdue clients
- Increase in client check-in completion rate
- Improved client accountability

**For Clients:**
- Increased check-in adherence
- Better habit formation through reminders
- Clearer expectations

**Measurable KPIs:**
- Average client adherence rate (target: 80%+)
- Response rate to reminders (target: 60%+)
- Time to complete check-in after reminder sent (target: <24 hours)
- Percentage of coaches using overdue tracking features daily (target: 90%+)

---

## Future Enhancements (Phase 4+)

1. **Smart Scheduling:** AI-suggested best check-in days based on client history
2. **Client-Side Reminders:** Push notifications to client mobile app (when built)
3. **Accountability Leaderboards:** Gamify check-in adherence (opt-in)
4. **Custom Reminder Messages:** Per-client personalized reminder text
5. **Integration with Calendar:** Add check-in reminders to client's Google/Apple Calendar
6. **SMS Reminders:** For clients who prefer text messages
7. **Streak Rewards:** Celebrate client milestones (10 consecutive on-time check-ins, etc.)
8. **Coach Digest Email:** Weekly summary of overdue clients, trends, etc.

---

## Technical Considerations

### Performance Optimization

- Index all date fields used in overdue calculations
- Cache overdue client queries (SWR with 1-minute refresh)
- Consider materialized view for adherence stats if calculation becomes slow
- Batch reminder sending to avoid rate limits

### Edge Cases to Handle

- Client timezone differences (store timezone preference)
- Holidays/vacation mode (pause reminders temporarily)
- Frequency changes mid-cycle (how to calculate adherence?)
- Client reactivation after being inactive
- Multiple coaches per client (future - who tracks adherence?)

### Security & Privacy

- Ensure RLS policies prevent cross-coach data access
- Rate limit reminder sending to prevent abuse
- Allow clients to opt out of reminders (GDPR compliance)
- Secure cron endpoints with secret tokens

---

## Conclusion

This feature addresses a critical pain point for busy coaches: **accountability at scale**. By automating the tracking, surfacing overdue clients prominently, and providing actionable reminder tools, coaches can spend less time on administrative work and more time actually coaching.

The phased approach allows you to deliver value quickly (Week 1-2) while building toward a fully automated system (Week 3). The foundation laid here also supports future features like habit tracking, client engagement scoring, and predictive analytics.

**Recommended Starting Point:**
1. Implement Phase 1 (Database) + Phase 2 (Business Logic)
2. Build Phase 4.1-4.3 (Overdue Banner + Client List)
3. Ship MVP, gather feedback
4. Add automation and advanced features based on usage patterns

This MVP gives coaches immediate visibility into overdue clients without overwhelming them with too many features upfront.
