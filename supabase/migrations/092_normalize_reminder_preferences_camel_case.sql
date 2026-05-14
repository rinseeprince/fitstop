-- Normalize reminder_preferences JSONB keys to camelCase.
--
-- Migration 008 seeded this column with snake_case keys (auto_send,
-- send_before_hours), but every TypeScript consumer expects camelCase
-- (autoSend, sendBeforeHours). The mismatch made the cron skip-guard in
-- services/reminder-service.ts:129 silently true and broke the new client
-- Settings page form (Session 2.6) by causing zodResolver to reject submits.
--
-- This migration:
--   1. Rewrites every non-null row to use camelCase keys, preserving existing
--      values whether they were stored as snake_case or camelCase. Missing keys
--      fall back to the cron defaults.
--   2. Updates the column default so newly created clients get camelCase JSONB.

UPDATE clients
SET reminder_preferences = jsonb_build_object(
  'enabled',         COALESCE(reminder_preferences->'enabled',         to_jsonb(true)),
  'autoSend',        COALESCE(reminder_preferences->'autoSend',        reminder_preferences->'auto_send',        to_jsonb(false)),
  'sendBeforeHours', COALESCE(reminder_preferences->'sendBeforeHours', reminder_preferences->'send_before_hours', to_jsonb(24))
)
WHERE reminder_preferences IS NOT NULL;

ALTER TABLE clients
  ALTER COLUMN reminder_preferences
  SET DEFAULT '{"enabled": true, "autoSend": false, "sendBeforeHours": 24}'::jsonb;

COMMENT ON COLUMN clients.reminder_preferences IS
  'Reminder settings: {enabled, autoSend, sendBeforeHours}. Migration 092 normalised legacy snake_case keys to camelCase.';
