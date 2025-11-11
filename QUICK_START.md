# 🚀 Quick Start - Fix the Errors

You're seeing errors because Supabase is not configured yet. Here's how to fix it in **5 minutes**:

## Option 1: Quick Mock Setup (Test Without Supabase - 1 minute)

If you just want to see the UI working without setting up Supabase, I can create mock data for you.

## Option 2: Full Supabase Setup (5 minutes)

### Step 1: Create a Supabase Account
1. Go to https://supabase.com
2. Click "Start your project"
3. Sign up (it's free!)

### Step 2: Create a New Project
1. Click "New Project"
2. Name it "FitStop" (or anything you like)
3. Create a **strong database password** (save it somewhere!)
4. Choose a region close to you
5. Click "Create new project"
6. **Wait 2-3 minutes** for the project to be ready

### Step 3: Get Your API Keys
1. Once ready, click on the **Settings** icon (gear) in the left sidebar
2. Click **API** in the settings menu
3. You'll see:
   - **Project URL** - copy this
   - **anon public** key - copy this
   - **service_role** key - copy this (click "Reveal" first)

### Step 4: Update Your `.env.local` File

Open `/Users/samuel.k/Desktop/FitStop/.env.local` and replace the placeholders:

```bash
# Replace these with your actual Supabase values
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# OpenAI is optional for now - you can test without it
OPENAI_API_KEY=your-openai-api-key-here

# This should already be correct
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Step 5: Run the Database Migrations

1. In Supabase, click the **SQL Editor** icon (</>) in the left sidebar
2. Click "New query"
3. Copy the contents of `supabase/migrations/001_create_check_ins_table.sql`
4. Paste into the SQL editor
5. Click "Run" (bottom right)
6. Repeat for `supabase/migrations/002_create_check_in_tokens_table.sql`

### Step 6: Create the Storage Bucket

1. Click the **Storage** icon (bucket) in the left sidebar
2. Click "New bucket"
3. Name it: `progress-photos`
4. Keep it **Private**
5. Click "Create bucket"

### Step 7: Restart Your Dev Server

```bash
# Stop the current server (Ctrl+C)
npm run dev
```

## ✅ That's It!

The errors will be gone. You should now be able to:
- Click "Send Check-In" button ✅
- Generate magic links ✅
- See charts (they'll be empty until you submit check-ins) ✅

---

## Testing the Full Flow

1. Go to http://localhost:3000/clients/client-1
2. Click "Send Check-In"
3. Copy the generated link
4. Open it in an incognito window
5. Fill out the check-in form
6. Submit!
7. Go back to the client page and refresh
8. You should see the check-in in the timeline!

---

## Still Getting Errors?

### Error: "Invalid supabaseUrl"
- Make sure you've updated `.env.local` with real values
- Restart the dev server after updating .env
- Check there are no extra spaces in the .env file

### Error: "Failed to create check-in token"
- Make sure you ran both SQL migrations
- Check the Supabase dashboard for any errors

### Charts showing warnings
- This is normal when there's no data yet
- Submit a check-in and the warnings will go away

---

## Need Help?

Let me know if you get stuck and I can help debug!
