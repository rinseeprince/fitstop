# Supabase Migrations

## Running Migrations

### Option 1: Using Supabase Dashboard
1. Go to https://app.supabase.com/project/{your-project-id}/sql
2. Copy and paste each SQL file content in order:
   - `001_create_check_ins_table.sql`
   - `002_create_check_in_tokens_table.sql`
3. Click "Run" to execute

### Option 2: Using Supabase CLI
```bash
# Install Supabase CLI
npm install -g supabase

# Link to your project
supabase link --project-ref {your-project-ref}

# Apply migrations
supabase db push
```

## Migration Files

- **001_create_check_ins_table.sql**: Creates the main check_ins table with all fields for tracking client progress
- **002_create_check_in_tokens_table.sql**: Creates the check_in_tokens table for magic link authentication

## Setup Storage Bucket

After running migrations, create a storage bucket for progress photos:

1. Go to https://app.supabase.com/project/{your-project-id}/storage
2. Create a new bucket named `progress-photos`
3. Set bucket to **private** (we'll use signed URLs)
4. Enable RLS policies:

```sql
-- Allow authenticated users to upload
CREATE POLICY "Allow upload for authenticated users" ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'progress-photos');

-- Allow public read access via signed URLs
CREATE POLICY "Allow read access" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'progress-photos');
```
