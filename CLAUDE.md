# Remind Me — project notes and decisions

Phone-first personal reminder PWA. Owner is not a programmer: explain things in plain language, give click-by-click steps for anything they must do by hand.

## What it does
Items have name, category, type (repeating | expiry | renewal), due date, optional repeat interval, custom early-warning days, notes, cost, optional photo. Main screen: upcoming list sorted by date, category filter chips, overdue pinned on top, ✓ marks done (repeating items roll forward to the next future occurrence, others move to the Done list; Undo toast). Quick-add: name + type + date + category, "More options" holds the rest.

## Decisions (and why)
- **Stack**: React + Vite + TypeScript, installable PWA (vite-plugin-pwa, `injectManifest`, custom service worker `src/sw.ts` for push). Plain and widely known.
- **Backend: Supabase free tier** — email+password login, Postgres, private photo bucket. Row-level security in `supabase/schema.sql` makes every row visible only to its owner, so multiple people can safely use one deployment (owner chose "multiple people").
- **Hosting: GitHub Pages** (free, static). **Scheduler: GitHub Actions cron, hourly** (`.github/workflows/reminders.yml`) calling the Supabase Edge Function `daily-reminders`. Hourly (not once a day) so each person gets their summary at 7am *their* time and a missed run self-heals; `reminder_log` guarantees one message per person per day. It also keeps the free Supabase project from auto-pausing. Cost: $0.
- **Email: Resend** free tier. The shared sender `onboarding@resend.dev` can only email the Resend account owner; sending to other people needs a verified domain (set `RESEND_FROM`).
- **Push (phase 2)**: Web Push with VAPID keys, sent by the same function. iPhone needs the app added to the Home Screen (iOS 16.4+).
- **Demo mode**: with no `VITE_SUPABASE_*` env vars the app stores data in localStorage so it can be developed/tested without accounts. Never used in production builds that have the keys.
- **Dates** are plain `YYYY-MM-DD` strings handled in UTC (no DST bugs). Month math clamps (Jan 31 + 1 month = Feb 28) and rolls forward from the original date so it does not drift.
- Date rules exist twice on purpose: `src/lib/dates.ts` (app) and `supabase/functions/daily-reminders/logic.ts` (server, import-free for Deno). Keep in step; both are tested.
- Secrets never go in the repo. The Supabase anon key is public by design (RLS protects data). Private keys live in Supabase function secrets / GitHub Actions secrets. `MY-SECRETS.local.txt` (git-ignored) holds generated values awaiting paste.

## Commands
`npm run dev` · `npm test` · `npm run build` · `npm run icons` (regenerate icons)

## Layout
`src/App.tsx` list screen · `src/components/` Auth, ItemForm, Settings · `src/lib/store.ts` data layer (Supabase + demo) · `src/lib/dates.ts` date rules · `supabase/` schema + function · `README.md` setup guide.
