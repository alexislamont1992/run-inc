-- Run Inc — Supabase schema
-- Paste into Supabase → SQL Editor → New query → Run. Safe to re-run.

create table if not exists public.runs (
  id                  uuid primary key default gen_random_uuid(),
  runner              text not null check (runner in ('Alexis', 'Ryan', 'Justin')),
  run_date            date not null,
  type                text not null default 'Easy'
                      check (type in ('Easy','Long','Tempo','Intervals','Recovery','Race','Cross-training','Rest')),
  planned_distance_km numeric(6,2),
  planned_duration_s  integer,
  notes               text,
  status              text not null default 'planned'
                      check (status in ('planned','done','swapped','missed')),
  actual_type         text
                      check (actual_type is null or actual_type in ('Easy','Long','Tempo','Intervals','Recovery','Race','Cross-training','Rest')),
  actual_distance_km  numeric(6,2),
  actual_duration_s   integer,
  -- Interval blocks: [{ reps, distance_m, target_pace_s, recovery_s, recovery_kind, splits: [seconds|null, ...] }]
  intervals           jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists runs_run_date_idx on public.runs (run_date);

-- Keep updated_at fresh
create or replace function public.runs_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists runs_touch_updated_at on public.runs;
create trigger runs_touch_updated_at
  before update on public.runs
  for each row execute function public.runs_touch_updated_at();

-- Row Level Security: no login, anyone with the anon key may read/write runs.
alter table public.runs enable row level security;

grant select, insert, update, delete on public.runs to anon;

drop policy if exists "anon can read runs"   on public.runs;
drop policy if exists "anon can insert runs" on public.runs;
drop policy if exists "anon can update runs" on public.runs;
drop policy if exists "anon can delete runs" on public.runs;

create policy "anon can read runs"   on public.runs for select to anon using (true);
create policy "anon can insert runs" on public.runs for insert to anon with check (true);
create policy "anon can update runs" on public.runs for update to anon using (true) with check (true);
create policy "anon can delete runs" on public.runs for delete to anon using (true);

-- Realtime: broadcast row changes to connected browsers
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'runs'
  ) then
    alter publication supabase_realtime add table public.runs;
  end if;
end $$;
