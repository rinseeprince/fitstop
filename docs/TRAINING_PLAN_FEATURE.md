# AI-Powered Training Plan Generator

An intelligent workout programming feature that uses GPT-4o to generate personalized training plans based on client data and coach expertise.

## Overview

The Training Plan Generator sits in the client profile page under the **Training** tab. Coaches write a natural language prompt describing what they want for the client, and the AI generates a complete, structured training program tailored to that client's metrics, goals, and recovery status.

## Key Features

- **AI-Generated Programs**: GPT-4o creates complete workout programs with exercises, sets, reps, RPE, rest periods, and coaching notes
- **Context-Aware**: Automatically incorporates client metrics, recent check-in data, and nutrition targets
- **Fully Editable**: Coaches can modify any aspect of the generated plan inline
- **History Tracking**: Every plan version is saved with a snapshot of the context at generation time
- **Regenerate**: One-click regeneration that uses the latest client data

---

## User Experience

### For Personal Trainers

#### 1. Creating an Initial Plan

Navigate to a client's profile → **Training** tab → Write a prompt describing the program:

```
"Client wants to build muscle while staying lean. Intermediate lifter,
4 days per week available. Focus on compound movements with some
isolation work. Include progressive overload structure."
```

Click **Generate Plan** and the AI produces:
- Program name & description
- Training split (e.g., Upper/Lower, PPL)
- Sessions with full exercise prescriptions
- Sets, reps, RPE targets, rest periods
- Form cues and coaching notes

#### 2. Reviewing & Editing

The plan displays as collapsible accordion cards (one per session). Coaches can:

- **View mode**: See the full program at a glance
- **Edit mode**: Click "Edit" to enable inline editing of all fields
- Add/remove exercises
- Add/remove entire sessions
- Modify any parameter (sets, reps, RPE, rest, notes)

#### 3. Regenerating Plans

When client circumstances change (injury, goal shift, plateau), click **Regenerate**:
1. Write a new prompt explaining the changes
2. System automatically pulls fresh metrics and check-in data
3. Old plan is archived to history
4. New plan generated with updated context

#### 4. Viewing History

Click **History** to see all previous plans with:
- The coach prompt that generated each version
- Client metrics snapshot at that time
- Check-in data snapshot (energy, sleep, stress, adherence)
- Full plan structure

---

## Data Context Sent to AI

When generating a plan, the system automatically includes:

### Client Profile
- Current weight & goal weight
- Body fat % & goal body fat %
- Gender
- TDEE (Total Daily Energy Expenditure)
- BMR (Basal Metabolic Rate)

### Recent Check-In Data (last 4 check-ins)
- Average mood (1-5)
- Average energy level (1-10)
- Average sleep quality (1-10)
- Average stress level (1-10)
- Program adherence percentage
- Recent challenges mentioned
- Recent PRs achieved

### Nutrition Context
- Daily calorie target
- Daily protein target

This allows the AI to make intelligent decisions about volume, intensity, and recovery needs.

---

## Technical Architecture

### Database Schema

```
training_plans (1:many)
    └── training_sessions (1:many)
            └── training_exercises

training_plan_history (stores snapshots)
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/clients/[id]/training` | Generate new plan |
| GET | `/api/clients/[id]/training` | Get active plan |
| PATCH | `/api/clients/[id]/training/[planId]` | Update plan metadata |
| DELETE | `/api/clients/[id]/training/[planId]` | Archive plan |
| POST | `/api/clients/[id]/training/[planId]/sessions` | Add session |
| PATCH/DELETE | `/api/clients/[id]/training/[planId]/sessions/[sessionId]` | Update/delete session |
| POST | `/api/clients/[id]/training/[planId]/sessions/[sessionId]/exercises` | Add exercise |
| PATCH/DELETE | `/api/clients/[id]/training/.../exercises/[exerciseId]` | Update/delete exercise |
| GET | `/api/clients/[id]/training/history` | Get plan history |

### Key Files

| File | Purpose |
|------|---------|
| `services/training-ai-service.ts` | OpenAI integration & prompt building |
| `services/training-service.ts` | Database CRUD operations |
| `components/clients/training-plan-card.tsx` | Main UI component |
| `components/clients/training-session-card.tsx` | Accordion session display |
| `components/clients/training-exercise-row.tsx` | Inline editable exercise row |
| `types/training.ts` | TypeScript type definitions |
| `lib/validations/training.ts` | Zod validation schemas |

---

## AI Prompt Engineering

The system prompt instructs GPT-4o to act as an expert strength and conditioning coach. Key guidelines:

1. Consider stated goals, current metrics, and recovery capacity
2. Adjust volume/intensity based on check-in data (sleep, stress, energy)
3. Include warm-up exercises marked appropriately
4. Use progressive overload principles
5. Balance pushing and pulling movements
6. Provide practical form cues and substitution options
7. Set appropriate rest periods (60-90s hypertrophy, 2-3min strength)

### Output Format

The AI returns structured JSON:

```json
{
  "name": "Strength & Hypertrophy Program",
  "description": "4-day upper/lower split focused on...",
  "splitType": "upper_lower",
  "frequencyPerWeek": 4,
  "programDurationWeeks": 8,
  "sessions": [
    {
      "name": "Upper Body A",
      "focus": "Horizontal Push/Pull",
      "estimatedDurationMinutes": 60,
      "exercises": [
        {
          "name": "Bench Press",
          "sets": 4,
          "repsMin": 6,
          "repsMax": 8,
          "rpeTarget": 8,
          "restSeconds": 180,
          "notes": "Full ROM, control the eccentric"
        }
      ]
    }
  ]
}
```

---

## Database Migration

Run the migration to create the required tables:

```bash
npx supabase db push
```

Or apply manually: `supabase/migrations/015_add_training_plan_tables.sql`

---

## Future Enhancements

Potential improvements for future iterations:

- **Template Library**: Save and reuse successful programs as templates
- **Exercise Database**: Searchable exercise library with video demos
- **Progression Tracking**: Track weights/reps over time within the plan
- **Client View**: Allow clients to view their program (read-only)
- **PDF Export**: Generate printable workout sheets
- **Periodization**: Multi-phase program planning (mesocycles)
