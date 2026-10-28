-- Run once in the Supabase SQL editor after deploying the function.
-- Replace <PROJECT_REF> and <SERVICE_ROLE_KEY> (store the key in Vault so it is not in plain text).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'fetch-events-every-6h',
  '0 */6 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/fetch-events',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <SERVICE_ROLE_KEY>'),
    body    := '{}'::jsonb
  );
  $$
);
