-- Remind Me: database setup. Paste this whole file into the Supabase SQL Editor and click Run.
-- It is safe to run more than once.

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  category text not null default 'Other',
  type text not null check (type in ('repeating','expiry','renewal')),
  due_date date not null,
  repeat_every int check (repeat_every > 0),
  repeat_unit text check (repeat_unit in ('days','weeks','months','years')),
  warn_days int[] not null default '{}',
  notes text not null default '',
  cost numeric(12,2),
  photo_path text,
  done_at timestamptz,
  last_done_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists items_user_due on public.items (user_id, due_date);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_reminders boolean not null default true,
  timezone text
);

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription jsonb not null
);

create table if not exists public.reminder_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  sent_on date not null,
  email_sent boolean not null default false,
  push_sent boolean not null default false,
  primary key (user_id, sent_on)
);

-- Privacy: every person can only ever see and change their own rows.
alter table public.items enable row level security;
alter table public.profiles enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reminder_log enable row level security;

drop policy if exists "own items" on public.items;
create policy "own items" on public.items for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own push" on public.push_subscriptions;
create policy "own push" on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- reminder_log has no policies: only the server job (service role) can touch it.

-- Private photo storage: each person can only reach the folder named after their own id.
insert into storage.buckets (id, name, public) values ('photos', 'photos', false) on conflict (id) do nothing;
drop policy if exists "own photos" on storage.objects;
create policy "own photos" on storage.objects for all
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
