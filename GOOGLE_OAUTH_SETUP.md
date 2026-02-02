# Google OAuth Setup Guide

This guide will help you configure Google OAuth authentication for CoachHub.

## Prerequisites

- A Supabase project (you already have this)
- A Google Cloud Platform account

## Step 1: Create Google OAuth Credentials

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)

2. Create a new project or select an existing one

3. Enable the Google+ API:
   - Go to "APIs & Services" > "Library"
   - Search for "Google+ API"
   - Click "Enable"

4. Create OAuth 2.0 credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Choose "Web application" as the application type
   - Give it a name (e.g., "CoachHub Auth")

5. Configure Authorized Redirect URIs:
   - Add your Supabase callback URL: `https://[YOUR-PROJECT-REF].supabase.co/auth/v1/callback`
   - For local development, also add: `http://localhost:3000/auth/callback`

6. Save and copy:
   - **Client ID** (looks like: `123456789-abc123.apps.googleusercontent.com`)
   - **Client Secret** (looks like: `GOCSPX-abc123xyz`)

## Step 2: Configure Supabase

1. Go to your [Supabase Dashboard](https://app.supabase.com/)

2. Navigate to: **Authentication** > **Providers**

3. Find **Google** in the list and click to expand

4. Enable Google provider:
   - Toggle "Enable Sign in with Google" to ON
   - Enter your **Client ID**
   - Enter your **Client Secret**
   - Click "Save"

## Step 3: Test the Integration

1. Start your development server:
   ```bash
   npm run dev
   ```

2. Navigate to `http://localhost:3000/login`

3. Click "Continue with Google"

4. You should be redirected to Google's login page

5. After logging in with Google, you'll be redirected back to your app

## Troubleshooting

### Redirect URI Mismatch Error

If you see a "redirect_uri_mismatch" error:
- Double-check that the redirect URI in Google Cloud Console matches exactly: `https://[YOUR-PROJECT-REF].supabase.co/auth/v1/callback`
- For local development, make sure `http://localhost:3000/auth/callback` is added

### OAuth Not Working Locally

- Make sure you've added the local callback URL in Google Cloud Console
- Clear your browser cache and cookies
- Check that your Supabase environment variables are set correctly in `.env.local`

### Profile Not Created

If Google OAuth succeeds but no coach profile is created:
- Check your Supabase logs in the Dashboard
- Verify that the `coaches` table exists and RLS policies are correct
- The auth context should automatically create a coach profile on first login

## Production Deployment

When deploying to production:

1. Update authorized redirect URIs in Google Cloud Console:
   - Add your production domain: `https://yourdomain.com/auth/callback`
   - Add your Supabase callback: `https://[YOUR-PROJECT-REF].supabase.co/auth/v1/callback`

2. Verify environment variables are set in your production environment

3. Test the flow in production before announcing to users

## Security Best Practices

- Never commit your Client Secret to version control
- Rotate credentials if they're ever exposed
- Use different OAuth credentials for development and production
- Regularly review and audit authorized applications in Google Cloud Console

## Support

- [Supabase Auth Documentation](https://supabase.com/docs/guides/auth)
- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
