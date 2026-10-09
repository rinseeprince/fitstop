# Atletafit

A modern fitness coaching platform that helps trainers manage clients, create personalized nutrition and training plans, and track progress through regular check-ins.

## Features

- **Client Management** - Add, edit, and organize clients with detailed profiles including fitness goals, body metrics, and activity levels
- **Client Invitations** - Token-based invitation system with email integration for seamless client onboarding
- **Nutrition Planning** - AI-powered meal plan generation with customizable macros, BMR calculations, and dietary preferences
- **Training Plans** - Author reusable multi-week programs in a full-page builder (per-set prescription, drag-and-drop scheduling), then place them onto any client's calendar
- **AI Draft Assistant** - A chat copilot inside the program builder that executes natural-language edits on the program you're authoring ("duplicate this week but add 2kg and an extra set")
- **Check-in System** - Scheduled client check-ins with progress photos, measurements, and goal tracking
- **Reminders & Notifications** - Automated reminder system for overdue check-ins
- **Progress Analytics** - Visual dashboards showing client progress over time with comparison tools

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 |
| UI Components | Radix UI, shadcn/ui |
| Database | Supabase (PostgreSQL) |
| Authentication | Better Auth |
| Email Service | Resend |
| AI Integration | OpenAI API |
| State Management | SWR, React Hook Form |
| Validation | Zod |
| Icons | Lucide React |
| Charts | Recharts |
| Drag & Drop | dnd-kit |

## Getting Started

### Prerequisites

- Node.js 22+
- npm
- Supabase account

### Setup

1. **Clone and install dependencies**
   ```bash
   git clone <repository-url>
   cd FitStop
   npm ci
   ```
   `npm ci` installs the lockfile as committed; a plain `npm install` fails on it (CONVENTIONS.md §2, "Don't install packages without asking").

2. **Configure environment variables**
   ```bash
   touch .env.local
   ```
   There is no `.env.example` in the repo yet — populate `.env.local` from the Environment Variables section below.

3. **Set up Supabase**
   - Create a new Supabase project
   - Run the database migrations from `/supabase`

4. **Start the development server**
   ```bash
   npm run dev
   ```

5. **Create your coach login**
   ```bash
   npm run coach:create -- --project <your_project_ref> --email you@example.com --name "Your Name"
   ```
   Nobody can sign up on the site: this command makes a coach's login and emails "Set your password" to that address. `--project` must name the project your repo is linked to (`npx supabase link`), the one `DATABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL` point at. On any project but the team's DEV project, `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` must be an https address, which the emailed link opens. Without `EMAIL_FROM`, Resend's sandbox delivers only to the Resend account's own address; on DEV, `npm run auth:last-link -- --email you@example.com` prints the link instead.

6. **Open [http://localhost:3000](http://localhost:3000)** and sign in.

## Environment Variables

Create a `.env.local` file with the following variables:

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Better Auth (lib/auth.ts refuses to start without each of these but AUTH_ADMIN_USER_IDS,
# and without NEXT_PUBLIC_APP_URL below)
# DATABASE_URL: Supabase dashboard → Connect → Transaction pooler, as given (no ?parameters);
# percent-encode any @ # / ? : or % in the password
DATABASE_URL=postgresql://postgres.your_project_ref:your_db_password@your_region.pooler.supabase.com:6543/postgres
BETTER_AUTH_SECRET=output_of_openssl_rand_base64_32
BETTER_AUTH_URL=http://localhost:3000      # the same origin as NEXT_PUBLIC_APP_URL
# Continue with Google: a Google Cloud OAuth client (Web application) whose authorized
# redirect URI is <BETTER_AUTH_URL>/api/auth/callback/google
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
# AUTH_ADMIN_USER_IDS=your_user_id         # optional: the admin plugin's admins

# OpenAI Configuration (check-in AI summaries)
OPENAI_API_KEY=your_openai_api_key

# Anthropic Configuration (the program-builder draft assistant)
ANTHROPIC_API_KEY=your_anthropic_api_key
# Optional overrides — the assistant returns a clear 500 without the key above.
# ASSISTANT_MODEL=claude-opus-4-8      # cost/quality knob; cheaper tiers measured at parity
# ASSISTANT_EFFORT=medium              # low | medium | high | xhigh | max
# ASSISTANT_THINKING=off               # strongest latency lever after model choice

# Email Service Configuration
RESEND_API_KEY=your_resend_api_key
# EMAIL_FROM="Atletafit <hello@your_verified_domain>"  # optional: without it, Resend's sandbox sender, which delivers only to the Resend account's own address

# App Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Project Structure

```
├── app/                        # Next.js App Router pages
│   ├── (coach)/               # Coach pages: dashboard/, clients/, crm/, automation/, settings/
│   ├── (marketing)/           # Public marketing pages
│   ├── client/                # Client portal pages
│   ├── api/                   # API routes
│   ├── login/, forgot-password/, reset-password/, set-password/  # Sign-in and the password pages
│   └── invite/                # Client invitation pages
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
├── emails/                    # Email templates (React Email)
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

## Client Invitation System

Atletafit features a secure token-based invitation system that allows coaches to seamlessly onboard clients:

### How It Works
1. **Coach sends invitation** - Creates client profile and sends invitation via email
2. **Secure token generation** - Cryptographically secure 64-character tokens
3. **Email delivery** - Professional invitation emails sent via Resend
4. **Client account** - The invite page shows the invited address with its middle hidden and asks only for a password; the login is made on that address
5. **Account linking** - Automatic connection to coach's client record

### Key Features
- **Security**: Cryptographically secure tokens with expiry (7 days)
- **User Experience**: Clean, branded email templates with fallback text
- **Validation**: Multi-layer validation (client, server, database)
- **Error Handling**: Comprehensive error states and recovery
- **Email Service**: Resend integration with professional templates

### Implementation
- **Database**: `client_invitations` table with unique token indexing
- **Email Templates**: React Email components with responsive design
- **API Endpoints**: RESTful token validation and acceptance
- **Frontend**: Dedicated invitation pages with form validation

## Database

The app uses Supabase (PostgreSQL) with the following core tables:

- `coaches` - Coach profiles and settings
- `clients` - Client information and goals
- `client_invitations` - Token-based invitation system with email tracking
- `check_ins` - Client check-in submissions
- `nutrition_plans` - Generated meal plans
- `training_plans` - Workout programs
- `training_sessions` - Individual workout sessions
- `external_activities` - Non-structured activity logs

## License

Private - All rights reserved
