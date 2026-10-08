-- supabase/migration-002.sql
-- Safe to run twice (uses IF NOT EXISTS; no data is dropped or overwritten).
--
-- due_at is intentionally left NULL for existing rows.
-- The app and edge function treat NULL as 09:00 in the user's profile timezone.

-- 1. Exact due time: set by the app when the user picks a time.
--    NULL means "treat as 09:00 in the user's profile timezone".
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS due_at timestamptz;

-- 2. Snooze: delay this occurrence without changing the canonical due_date or due_at.
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;

-- 3. Widen repeat_unit to include sub-day and month-boundary values.
ALTER TABLE public.items DROP CONSTRAINT IF EXISTS items_repeat_unit_check;
ALTER TABLE public.items ADD CONSTRAINT items_repeat_unit_check CHECK (
  repeat_unit IS NULL OR repeat_unit IN (
    'minutes', 'hours', 'days', 'weeks', 'months', 'years',
    'last_day_of_month', 'first_day_of_month'
  )
);

-- 4. Per-item-per-occurrence fire log.
--    The old reminder_log table is left untouched.
--    Primary key (item_id, fired_at, channel) makes every minute-cron run idempotent:
--    inserting a duplicate simply fails, so the send is skipped.
CREATE TABLE IF NOT EXISTS public.reminder_fires (
  item_id  uuid        NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  fired_at timestamptz NOT NULL,
  channel  text        NOT NULL CHECK (channel IN ('email', 'push')),
  sent_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, fired_at, channel)
);

-- RLS on: no policies means only the service role (used by the edge function) can read/write.
ALTER TABLE public.reminder_fires ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS reminder_fires_item_idx ON public.reminder_fires (item_id, fired_at);
