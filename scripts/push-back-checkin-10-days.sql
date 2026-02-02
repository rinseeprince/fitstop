-- Script to push back the most recent check-in by 10 days for testing overdue functionality
-- User email: s.kalepa91@gmail.com

-- Step 1: Find the client ID for the email
DO $$
DECLARE
  client_id_var UUID;
  latest_checkin_id UUID;
  new_created_at TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Get the client ID
  SELECT id INTO client_id_var
  FROM clients
  WHERE email = 's.kalepa91@gmail.com'
  LIMIT 1;

  IF client_id_var IS NULL THEN
    RAISE NOTICE 'No client found with email s.kalepa91@gmail.com';
    RETURN;
  END IF;

  RAISE NOTICE 'Found client ID: %', client_id_var;

  -- Get the most recent check-in for this client
  SELECT id, created_at INTO latest_checkin_id, new_created_at
  FROM check_ins
  WHERE client_id = client_id_var
  ORDER BY created_at DESC
  LIMIT 1;

  IF latest_checkin_id IS NULL THEN
    RAISE NOTICE 'No check-ins found for this client';
    RETURN;
  END IF;

  RAISE NOTICE 'Found check-in ID: %', latest_checkin_id;
  RAISE NOTICE 'Original created_at: %', new_created_at;

  -- Calculate the new timestamp (10 days ago)
  new_created_at := new_created_at - INTERVAL '10 days';

  RAISE NOTICE 'New created_at: %', new_created_at;

  -- Update the check-in's created_at timestamp
  UPDATE check_ins
  SET created_at = new_created_at,
      updated_at = new_created_at
  WHERE id = latest_checkin_id;

  RAISE NOTICE 'Successfully pushed back check-in by 10 days';
END $$;

-- Verify the change
SELECT
  c.email,
  c.name,
  ci.id as checkin_id,
  ci.created_at,
  NOW() - ci.created_at as days_since_checkin
FROM clients c
JOIN check_ins ci ON c.id = ci.client_id
WHERE c.email = 's.kalepa91@gmail.com'
ORDER BY ci.created_at DESC
LIMIT 1;
