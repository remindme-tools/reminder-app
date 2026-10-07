-- migration-001.sql
-- Remind Me: schema additions. Safe to run more than once.

-- Category color preferences per user (JSON: {"Home":"#f87171", ...})
alter table public.profiles
  add column if not exists category_colors jsonb not null default '{}';

-- Per-reminder notification channel: 'email', 'push', or 'both'
alter table public.items
  add column if not exists notify_via text not null default 'both'
  constraint items_notify_via_check check (notify_via in ('email','push','both'));
