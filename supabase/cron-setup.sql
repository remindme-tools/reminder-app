-- supabase/cron-setup.sql
-- Run this ONCE in the Supabase SQL Editor.
--
-- BEFORE running this file you must:
--   1. Go to Supabase Dashboard → Settings → Vault → New Secret
--      Name:  cron_secret
--      Value: (paste the value of your CRON_SECRET — same secret that is in GitHub Actions)
--
--   2. Replace <YOUR-PROJECT-REF> below with your project reference ID.
--      Find it at: Dashboard → Settings → General → Reference ID
--      Example:    abcdefghijklmnop
--
-- To re-run safely the script removes the old job first.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove previous job if re-running
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fire-reminders-every-minute') THEN
    PERFORM cron.unschedule('fire-reminders-every-minute');
  END IF;
END
$$;

SELECT cron.schedule(
  'fire-reminders-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/daily-reminders',
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-cron-secret',  (
        SELECT decrypted_secret
        FROM   vault.decrypted_secrets
        WHERE  name = 'cron_secret'
        LIMIT  1
      )
    ),
    body    := '{}'::jsonb
  );
  $$
);
