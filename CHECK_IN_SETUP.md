# Client Progress Tracking + Check-ins Setup Guide

This guide will walk you through setting up the check-in feature for FitStop.

## Prerequisites

- Node.js 18+ installed
- A Supabase account (free tier works fine)
- An OpenAI API key

---

## Step 1: Configure Environment Variables

1. Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

2. Fill in the values in `.env.local`:
```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# OpenAI Configuration
OPENAI_API_KEY=sk-your-openai-api-key-here

# App Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## Step 2: Setup Supabase Database

### Option A: Using Supabase Dashboard (Easiest)

1. Go to https://app.supabase.com/project/{your-project-id}/sql
2. Copy the contents of `supabase/migrations/001_create_check_ins_table.sql`
3. Paste and click "Run"
4. Copy the contents of `supabase/migrations/002_create_check_in_tokens_table.sql`
5. Paste and click "Run"

### Option B: Using Supabase CLI

```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link to your project
supabase link --project-ref your-project-ref

# Apply migrations
supabase db push
```

---

## Step 3: Create Supabase Storage Bucket

1. Go to https://app.supabase.com/project/{your-project-id}/storage
2. Click "New bucket"
3. Name it `progress-photos`
4. Set to **Private**
5. Click "Create bucket"

### Setup Storage Policies

Go to the SQL editor and run:

```sql
-- Allow authenticated users to upload
CREATE POLICY "Allow upload for authenticated users" ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'progress-photos');

-- Allow read access
CREATE POLICY "Allow read access" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'progress-photos');
```

---

## Step 4: Get Your Supabase Keys

### Find Your Keys:

1. Go to https://app.supabase.com/project/{your-project-id}/settings/api

2. Copy the following:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (keep this secret!)

---

## Step 5: Get Your OpenAI API Key

1. Go to https://platform.openai.com/api-keys
2. Click "Create new secret key"
3. Give it a name (e.g., "FitStop Check-ins")
4. Copy the key → `OPENAI_API_KEY`

**Note:** You'll need credits in your OpenAI account. Each AI summary costs ~$0.01-0.02.

---

## Step 6: Install Dependencies

```bash
npm install
```

All required packages are already in package.json:
- @supabase/supabase-js
- openai
- swr
- And others already installed

---

## Step 7: Run the Development Server

```bash
npm run dev
```

Navigate to http://localhost:3000

---

## Testing the Check-in Flow

### Test as a Coach:

1. Go to http://localhost:3000/clients/client-1
2. Click "Send Check-In" button
3. Copy the generated link
4. Open link in a new incognito window

### Test as a Client:

1. Open the check-in link you copied
2. Complete all 4 steps of the form
3. Submit the check-in
4. Go back to the coach dashboard

### Review the Check-in:

1. Refresh the client profile page
2. You should see:
   - New check-in in the timeline
   - Updated progress charts
   - Progress photos (if submitted)
3. Click on the check-in to review
4. AI summary should be generated automatically
5. Edit and send your response

---

## Feature Overview

### What's Built:

✅ **Client-facing Check-in Form**
- 4-step wizard (Feeling, Metrics, Photos, Training)
- Mobile-optimized with camera integration
- Auto-saves progress
- No login required (magic link authentication)

✅ **AI-Powered Coach Summaries**
- Automatic analysis of check-ins
- Identifies strengths, concerns, and trends
- Generates draft responses
- Uses OpenAI GPT-4o

✅ **Progress Visualization**
- Weight, adherence, mood, energy charts
- Before/after photo comparisons
- Timeline of all check-ins

✅ **Coach Dashboard Integration**
- Send check-in links
- Review check-ins with AI assistance
- Track client progress over time

### Folder Structure:

```
/app
  /api/check-in          - API routes
  /check-in/[token]      - Client form page
  /clients/[id]          - Updated coach view
/components/check-in     - All check-in components
/services                - Business logic
/types                   - TypeScript types
/hooks                   - Custom React hooks
/lib                     - Utilities
/supabase/migrations     - Database schema
```

---

## Production Deployment

### Environment Variables for Production:

Update these in your hosting platform (Vercel, etc.):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OPENAI_API_KEY=sk-your-key
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

### Additional Production Setup:

1. **Enable Supabase Email Auth** (if adding client portal later)
2. **Setup Email Provider** (for sending check-in responses)
3. **Configure CORS** (if needed for API routes)
4. **Setup Error Monitoring** (Sentry, etc.)

---

## Troubleshooting

### "Failed to create check-in token"
- Check your `SUPABASE_SERVICE_ROLE_KEY` is set correctly
- Verify migrations ran successfully
- Check Supabase dashboard for errors

### "Failed to generate AI summary"
- Verify `OPENAI_API_KEY` is valid
- Check you have OpenAI credits
- Look at browser console for errors

### "Failed to upload photo"
- Verify storage bucket `progress-photos` exists
- Check storage policies are set correctly
- Ensure image is under 5MB

### Check-in link shows "Invalid or expired"
- Token might be older than 7 days
- Generate a new link
- Check `check_in_tokens` table in Supabase

---

## Next Steps

### Recommended Enhancements:

1. **Email/SMS Integration**
   - Use Resend or SendGrid for email
   - Use Twilio for SMS
   - Auto-send check-in links weekly

2. **Client Portal** (future)
   - Let clients view their own progress
   - See coach responses
   - Track their journey

3. **Advanced Analytics**
   - Compare clients
   - Benchmark progress
   - Export reports

4. **Automation**
   - Auto-send check-ins on schedule
   - Reminder emails if not completed
   - Flag at-risk clients

---

## Support

For issues or questions:
- Check the Supabase logs
- Review browser console errors
- Verify all environment variables are set
- Ensure migrations ran successfully

---

## Credits

Built with:
- Next.js 16
- Supabase (PostgreSQL + Storage)
- OpenAI GPT-4o
- Tailwind CSS + shadcn/ui
- Recharts for visualizations
