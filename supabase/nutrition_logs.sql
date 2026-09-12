-- SyncVitals: nutrition_logs table
-- Project: qbaougugtogrybssgjwb (dedicated SyncVitals Supabase project)
-- Already applied via Supabase MCP on 2026-09-12 — kept here for reference/reproducibility.

create table if not exists nutrition_logs (
  id uuid primary key default gen_random_uuid(),
  patient_id text not null,
  log_date date not null,
  breakfast jsonb not null default '[]',
  lunch jsonb not null default '[]',
  dinner jsonb not null default '[]',
  snacks jsonb not null default '[]',
  activities jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  unique (patient_id, log_date)
);

-- Demo-appropriate open access: this app has no real patient login system,
-- so RLS is enabled but permissive (anon can read/write). This mirrors the
-- pattern used for the SyncVitals leads table. NOT appropriate once real
-- patient auth exists — tighten to auth.uid()-scoped policies at that point.
alter table nutrition_logs enable row level security;

create policy "anon can read nutrition_logs"
  on nutrition_logs for select
  to anon
  using (true);

create policy "anon can insert nutrition_logs"
  on nutrition_logs for insert
  to anon
  with check (true);

create policy "anon can update nutrition_logs"
  on nutrition_logs for update
  to anon
  using (true)
  with check (true);

-- Enable Realtime so Nurse Portal gets live updates the moment a patient logs food
alter publication supabase_realtime add table nutrition_logs;
