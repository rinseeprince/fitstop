-- Backfill profiles for existing coaches
INSERT INTO public.profiles (user_id, role)
SELECT user_id, 'trainer'
FROM public.coaches
WHERE user_id IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;
