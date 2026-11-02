-- Run this once in the Supabase SQL Editor, after the first GitHub deploy.
-- Replace the two values marked below before you press Run.
-- It makes Supabase call the collector every 15 minutes.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://YOUR-PROJECT-ID.supabase.co', 'rainfall_project_url');
select vault.create_secret('YOUR-CRON-SECRET', 'rainfall_cron_secret');

-- These minutes are deliberately off the hour. Yr asks users to avoid requests
-- on the dot. The collector only calls Yr for towns whose data has expired.
select cron.schedule(
  'collect-rainfall',
  '7,22,37,52 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'rainfall_project_url')
           || '/functions/v1/collect-rainfall',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'rainfall_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 140000
  );
  $$
);
