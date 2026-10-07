# Remind Me — setup guide (about 30 minutes, all free)

You need three free accounts: **GitHub**, **Supabase**, **Resend**. No credit card for any of them.
Your private values (keys) are in `MY-SECRETS.local.txt` in this folder. Never share that file.

## 1. Supabase (your private database and login)
1. Go to https://supabase.com → **Start your project** → sign up (use "Continue with GitHub" if you already have it).
2. Click **New project**. Name: `remind-me`. Choose a Database Password (save it in your password manager; you won't need it daily). Pick the region closest to you. Plan: **Free**. Click **Create new project** and wait ~2 minutes.
3. Left menu → **SQL Editor** → **New query**. Open `supabase/schema.sql` from this folder, copy everything, paste it in, click **Run**. You should see "Success".
4. Left menu → **Project Settings (gear)** → **API**. Copy and keep: **Project URL** and the **anon public** key. (The `service_role` key is secret: do not copy it anywhere.)
5. Left menu → **Authentication** → **Sign In / Providers** → **Email**. For quickest start, turn **Confirm email** off (otherwise you must tap an email link when you sign up). Save.
6. Project Settings → **General** → copy the **Project ID** (a short code like `abcdefghijklmnop`).
7. Click your profile picture (bottom left) → **Account Preferences** → **Access Tokens** → **Generate new token**, name it `github`, copy it now (shown once).

## 2. Resend (sends the reminder emails)
1. Go to https://resend.com → **Sign up** with the email you want reminders sent to.
2. Left menu → **API Keys** → **Create API Key**, name `remind-me`, permission **Sending access** → copy the key.
Note: until you verify your own domain, Resend only delivers to the email you signed up with. That is fine for just you; other people need a domain (ask me to help later).

## 3. Put the secrets into Supabase
Supabase → **Edge Functions** (left menu) → **Secrets** → add each one (name, value, **Save**):
- `RESEND_API_KEY` = the Resend key
- `CRON_SECRET` = from `MY-SECRETS.local.txt`
- `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` = from `MY-SECRETS.local.txt`
- `VAPID_SUBJECT` = `mailto:` followed by your email

## 4. GitHub (hosts the app and runs the hourly job)
1. https://github.com → sign up. Click **+** (top right) → **New repository**. Name it `reminder-app`, choose **Public**, do not add any files, click **Create repository**. (Public is required for free hosting. Nothing private is in the code.)
2. Repository → **Settings** → **Pages** → under **Build and deployment → Source** choose **GitHub Actions**.
3. Repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Add these six (name, then value):
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_PROJECT_REF` (the Project ID), `SUPABASE_ACCESS_TOKEN` (step 1.7), `CRON_SECRET`, `VAPID_PUBLIC_KEY`.
4. Upload the code: in a terminal in this folder run the three lines GitHub shows under "push an existing repository" (replace the URL with yours). A browser window will ask you to sign in to GitHub once.
5. Repository → **Actions** tab → wait for **Deploy** to go green (about 2 minutes). Your app is at `https://YOUR-GITHUB-NAME.github.io/reminder-app/`.

## 5. Put it on your iPhone
1. Open the address above in **Safari** (must be Safari).
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Open **Remind Me** from your Home Screen, tap **Create an account**, sign up.
4. Tap ⚙ → switch on **Push notifications** → tap **Allow** (needs iOS 16.4 or newer).

## 6. Check emails work
Add an item due tomorrow. GitHub → **Actions** → **Send reminders** → **Run workflow**. (Emails normally arrive each morning at 7am your time.)
