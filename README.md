# CoachHub

A modern fitness coaching platform that helps trainers manage clients, create personalized nutrition and training plans, and track progress through regular check-ins.

## Features

- **Client Management** - Add, edit, and organize clients with detailed profiles including fitness goals, body metrics, and activity levels
- **Nutrition Planning** - AI-powered meal plan generation with customizable macros, BMR calculations, and dietary preferences
- **Training Plans** - Create structured workout programs with exercise tracking, sets/reps, and progression
- **Check-in System** - Scheduled client check-ins with progress photos, measurements, and goal tracking
- **Reminders & Notifications** - Automated reminder system for overdue check-ins
- **Progress Analytics** - Visual dashboards showing client progress over time with comparison tools
- **External Activity Tracking** - Log activities outside of structured training (cardio, sports, etc.)

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 |
| UI Components | Radix UI, shadcn/ui |
| Database | Supabase (PostgreSQL) |
| Authentication | Supabase Auth |
| AI Integration | OpenAI API |
| State Management | SWR, React Hook Form |
| Validation | Zod |
| Icons | Lucide React |
| Charts | Recharts |
| Drag & Drop | dnd-kit |

## Getting Started

### Prerequisites

- Node.js 18+
- npm or pnpm
- Supabase account

### Setup

1. **Clone and install dependencies**
   ```bash
   git clone <repository-url>
   cd FitStop
   npm install
   ```

2. **Configure environment variables**
   ```bash
   cp .env.example .env.local
   ```
   Then fill in your credentials (see Environment Variables below)

3. **Set up Supabase**
   - Create a new Supabase project
   - Run the database migrations from `/supabase`

4. **Start the development server**
   ```bash
   npm run dev
   ```

5. **Open [http://localhost:3000](http://localhost:3000)**

## Environment Variables

Create a `.env.local` file with the following variables:

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key

# App Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Project Structure

```
├── app/                        # Next.js App Router pages
│   ├── api/                   # API routes
│   ├── auth/                  # Authentication pages
│   ├── clients/               # Client management pages
│   ├── check-in/              # Check-in submission pages
│   └── settings/              # App settings
├── components/                # React components
│   ├── ui/                   # Base UI components (shadcn)
│   ├── clients/              # Client-specific components
│   │   ├── nutrition/
│   │   │   ├── builder/      # Nutrition plan builder
│   │   │   └── display/      # Nutrition display/tracking
│   │   ├── training/
│   │   │   ├── builder/      # Training plan builder
│   │   │   ├── schedule/     # Workout scheduling & drag-drop
│   │   │   └── sessions/     # Session management
│   │   ├── activities/       # External activities integration
│   │   ├── check-in/         # Client check-in flow
│   │   └── shared/           # Shared UI components
│   └── check-in/             # Check-in flow components
├── services/                  # Business logic & API calls
├── hooks/                     # Custom React hooks
├── lib/                       # Utility libraries & configs
├── types/                     # TypeScript type definitions
├── utils/                     # Helper functions
├── contexts/                  # React Context providers
└── supabase/                 # Database migrations & types
```

Organized by feature domain. See [CONVENTIONS.md](./CONVENTIONS.md) for details.

## Development

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Run linter
npm run lint
```

## Key Conventions

This project follows strict coding conventions documented in [CONVENTIONS.md](./CONVENTIONS.md). Key points:

- **File Size Limits**: Components max 200 lines, Services max 300 lines
- **Styling**: Tailwind CSS only, Lucide icons
- **State Management**: SWR for server state, React Hook Form for forms
- **Validation**: Zod schemas for all inputs
- **Error Handling**: try-catch with proper HTTP status codes
- **API Design**: RESTful routes with `{ success, data, error }` response format

## API Response Format

All API endpoints return consistent JSON:

```typescript
{
  success: boolean;
  data?: T;
  error?: string;
}
```

## Database

The app uses Supabase (PostgreSQL) with the following core tables:

- `coaches` - Coach profiles and settings
- `clients` - Client information and goals
- `check_ins` - Client check-in submissions
- `nutrition_plans` - Generated meal plans
- `training_plans` - Workout programs
- `training_sessions` - Individual workout sessions
- `external_activities` - Non-structured activity logs

## License

Private - All rights reserved
