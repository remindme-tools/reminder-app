# Remind Me — UI & Feature Overhaul Design

Date: 2026-10-06

## Overview

A comprehensive improvement to the Remind Me PWA covering: category colors, persistent sessions, forgot-password flow, a friendlier reminder list, and clearer notification settings. The app is used by non-technical users on iPhone (primary) and other phones.

---

## 1. Database Changes

**File to create:** `supabase/migration-001.sql` (idempotent — safe to run twice)

### New column: `profiles.category_colors`
```sql
alter table public.profiles
  add column if not exists category_colors jsonb not null default '{}';
```
Stores a JSON object mapping category name → hex color string, e.g. `{"Home":"#f87171","Car":"#60a5fa"}`. Missing keys fall back to the built-in default palette. Synced across all devices the user logs in on.

### New column: `items.notify_via`
```sql
alter table public.items
  add column if not exists notify_via text not null default 'both'
  check (notify_via in ('email','push','both'));
```
Existing items default to `'both'`. Used by the daily-reminders Edge Function to decide whether to send email, push, or both for each item.

---

## 2. Session Persistence

### Problem
`createClient` is called without persistence options. Every app open re-fetches the session from the server and the user sees a flash of the sign-in screen.

### Solution
- Pass `auth: { persistSession: true, autoRefreshToken: true, storageKey: 'remindme-auth' }` to `createClient`.
- In `App.tsx`, subscribe to `supabase.auth.onAuthStateChange` instead of a one-shot `getSession()`. The initial event fires synchronously from the stored token so `session` is never `undefined` for a returning user.
- Keep the `undefined` loading state only for the very first paint while the stored token is validated.
- Never call `signOut` in response to a failed token refresh — only on explicit user tap.

### Safari banner
Condition: iOS device (`/iPad|iPhone|iPod/.test(navigator.userAgent)`) AND not standalone (`!window.navigator.standalone`) AND not already dismissed (stored in `localStorage` key `remindme-safari-banner-dismissed`).

Banner text: *"For the best experience and to stay logged in, add Remind Me to your Home Screen: tap Share → Add to Home Screen."* One dismiss button. Never shown again after dismissed.

---

## 3. Forgot Password Flow

### New auth states in `Auth.tsx`
Mode field expands from `'in' | 'up'` to `'in' | 'up' | 'forgot' | 'reset'`.

| Mode | What the user sees |
|------|--------------------|
| `in` | Sign-in form (existing) |
| `up` | Sign-up form (existing) |
| `forgot` | Email field + "Send reset email" button |
| `reset` | New password field + "Set new password" button |

### Forgot flow
1. User taps "Forgot password?" link on sign-in screen.
2. `mode` → `'forgot'`. User enters email, taps button.
3. `store.resetPasswordForEmail(email)` called → Supabase sends email.
4. Success: banner "Check your email! We sent a reset link." Mode stays on `forgot`.
5. Error: friendly banner, e.g. "That didn't work. Please check the email address."

### Reset flow
1. User taps link in email → app opens at `/#type=recovery&...` (Supabase hash fragment).
2. `App.tsx` detects `window.location.hash` contains `type=recovery` on mount → passes `showReset=true` to Auth → `mode` starts as `'reset'`.
3. `store.updatePassword(newPassword)` called → navigates to `mode='in'` with a "Password updated! Please sign in." message.

### Show/hide password
Both sign-in and sign-up forms get an eye-icon button inside the password field that toggles `type="password"` / `type="text"`. Uses a simple SVG eye icon (inline, no library needed).

### Supabase URL config (tell user to set these)
- **Site URL:** `https://<your-github-username>.github.io/<repo-name>` (or custom domain if set)
- **Redirect URLs (Additional):** `https://<your-github-username>.github.io/<repo-name>/**`

Add `resetPasswordForEmail(email: string): Promise<void>` and `updatePassword(password: string): Promise<void>` to the `Store` interface and both `remote` and `demo` implementations.

---

## 4. Category Colors

### Default palette (7 categories)
| Category | Default color |
|----------|---------------|
| Home | `#f87171` (soft red) |
| Car | `#60a5fa` (soft blue) |
| Health | `#4ade80` (soft green) |
| Money | `#fbbf24` (amber) |
| Documents | `#a78bfa` (purple) |
| Pets | `#fb923c` (orange) |
| Other | `#94a3b8` (slate/grey) |

All chosen for WCAG AA contrast against both dark (`#1e293b`) and light (`#ffffff`) card backgrounds.

### UI
- **Reminder card:** 6 px left border, colored by category (already exists structurally; currently only shows urgency color). Category color takes over the border; urgency is still shown via the due-date text color.
- **Category chips (filter row and form):** A 10 px solid color dot (CSS `border-radius: 50%`) to the left of the category name.
- **Category color editor:** In Settings, a "Categories" section. Tapping a category row opens a small inline palette of 12 colors (the 7 defaults + 5 extras). Selected color gets a checkmark. Saved to `profiles.category_colors` immediately.

### Data flow
- `store.getProfile()` returns `category_colors: Record<string, string>` (new field).
- `store.saveProfile()` accepts and saves the updated map.
- A `useCategoryColors()` hook in `src/lib/categoryColors.ts` makes the map available to `App`, `ItemForm`, and `Settings` without prop-drilling.
- Demo mode: colors stored in `localStorage` key `remindme-demo-colors`.

---

## 5. Reminder List UI

### Grouping
Three sections in order:
1. **Overdue** — `daysUntil < 0` — red section header
2. **Due soon** — `0 ≤ daysUntil ≤ 7` — amber section header
3. **Later** — `daysUntil > 7` — no color on section header

### Plain-language dates
Replace the raw date display. New `describeDueDetailed(days: number, due_date: string): string`:

| Days | Text |
|------|------|
| < 0 | "X days overdue" (X = abs value) |
| 0 | "Today" |
| 1 | "Tomorrow" |
| 2–13 | "In X days" |
| 14–59 | "In X weeks" (rounded) |
| 60+ | "In X months" (rounded) |

The raw YYYY-MM-DD date is removed from the card front. It remains visible when you open the edit form.

### Card actions
- **Done (✓):** existing behavior, unchanged.
- **Snooze (💤):** new button on the right side of each upcoming card. Tapping opens a small bottom sheet:
  - "Snooze 1 day" / "Snooze 3 days" / "Snooze 1 week" — three buttons
  - Tapping any option calls `store.update(item.id, { ...item, due_date: newDate })`, closes the sheet, reloads.
  - The undo toast is not shown for snooze (the change is easily reversed by editing the item).

### Empty state
When `shown.length === 0` and `view === 'upcoming'`:
```
All clear! Nothing coming up.

[Add your first reminder]

Ideas:  [Furnace filter]  [Car registration]  [Passport]
```
Each example chip pre-fills the add form with that name.

### Loading state
While items are loading (initial fetch), show three skeleton cards (grey rounded rectangles, CSS animation pulse) instead of the empty state or stale data.

---

## 6. Notifications Settings

### Push status display
Replace the checkbox with:
- A labelled toggle switch (`role="switch"`) showing **On / Off**.
- Below the toggle: 
  - If **not standalone on iOS**: the Add-to-Home-Screen instruction.
  - If **standalone, push blocked by browser**: "Notifications are blocked. Go to your phone's Settings → Remind Me → Notifications and turn them on."
  - If **standalone, push supported but off**: "Tap to turn on."
  - If **on**: "Push notifications are active on this device."

### Test notification button
Appears only when push is On. Sends a push via the service worker's `showNotification` API locally (no server round-trip needed for a test). Text: "Test from Remind Me — it's working!"

### Per-reminder notify_via
In `ItemForm`, inside the "More options" section, a new field:
```
Notify me by:  [Email]  [Push]  [Both ✓]
```
Three-way segmented control. Default: Both.

### iPhone explanation in Settings
Displayed when `!standalone && /iPhone|iPad|iPod/.test(navigator.userAgent)`:
> "Push notifications only work when you open Remind Me from your Home Screen icon — not from Safari. Tap Share (the box with an arrow) then 'Add to Home Screen'."

---

## 7. Edge Function Update

The `daily-reminders` Edge Function's `logic.ts` must be updated to respect `notify_via`:
- `notify_via === 'email'`: send email only, skip push.
- `notify_via === 'push'`: send push only, skip email.
- `notify_via === 'both'` (or null/missing): existing behavior.

The `logic.ts` file currently doesn't reference this field. Add a `notifyVia: string` field to the item type there and add the conditional logic.

---

## 8. Store Interface Changes

New methods to add to `Store`, `remote`, and `demo`:
```ts
resetPasswordForEmail(email: string): Promise<void>;
updatePassword(password: string): Promise<void>;
```

`Profile` interface gains:
```ts
category_colors: Record<string, string>;
```

---

## 9. Files Changed

| File | What changes |
|------|-------------|
| `supabase/migration-001.sql` | NEW — two column additions |
| `src/lib/store.ts` | persistSession, new auth methods, category_colors in Profile |
| `src/lib/categoryColors.ts` | NEW — default palette, useCategoryColors hook |
| `src/lib/dates.ts` | new `describeDueDetailed` helper |
| `src/App.tsx` | onAuthStateChange, grouping, snooze sheet, skeleton, empty state, category colors context |
| `src/components/Auth.tsx` | forgot/reset modes, show/hide password |
| `src/components/ItemForm.tsx` | notify_via field, category color dots |
| `src/components/Settings.tsx` | push toggle, test button, category color editor, iPhone note |
| `src/styles.css` | toggle switch, skeleton, color dot, snooze sheet, misc polish |
| `src/types.ts` | add `notify_via` field to `Item` |
| `supabase/functions/daily-reminders/logic.ts` | respect notify_via |

---

## 10. Supabase Settings the User Must Change

After deploying:

1. **Authentication → URL Configuration → Site URL:**
   `https://remindme-tools.github.io/reminder-app/`

2. **Authentication → URL Configuration → Redirect URLs (add):**
   `https://remindme-tools.github.io/reminder-app/**`

These ensure password-reset emails link back to the live app, not localhost.

---

## 11. SQL the User Must Run

Paste `supabase/migration-001.sql` into Supabase SQL Editor → Run.
