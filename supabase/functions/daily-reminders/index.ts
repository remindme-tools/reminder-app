// Runs every hour (triggered by GitHub Actions). For each person whose local time is
// past 7am and who has not yet been told today, send one summary by email and push.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";
import { buildDigest, shouldSendNow, type DueItem } from "./logic.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

async function sendEmail(to: string, subject: string, html: string, text: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env("RESEND_FROM") || "Remind Me <onboarding@resend.dev>", to: [to], subject, html, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

Deno.serve(async (req) => {
  if (!env("CRON_SECRET") || req.headers.get("x-cron-secret") !== env("CRON_SECRET")) {
    return new Response("Unauthorized", { status: 401 });
  }
  const q = new URL(req.url).searchParams;
  const dry = q.has("dry"); // ?dry=1 shows what would be sent, sends nothing
  const force = q.has("force"); // ?force=1 ignores the 7am / once-a-day rule (for testing)
  const pushOn = !!(env("VAPID_PUBLIC_KEY") && env("VAPID_PRIVATE_KEY"));
  if (pushOn) webpush.setVapidDetails(env("VAPID_SUBJECT") || "mailto:admin@example.com", env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));

  const { data: users, error } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (error) return new Response(error.message, { status: 500 });

  const report: Record<string, unknown>[] = [];
  for (const u of users.users) {
    try {
      const [{ data: profile }, { data: log }] = await Promise.all([
        db.from("profiles").select("*").eq("user_id", u.id).maybeSingle(),
        db.from("reminder_log").select("*").eq("user_id", u.id).order("sent_on", { ascending: false }).limit(1).maybeSingle(),
      ]);
      const tz = profile?.timezone ?? "UTC";
      const { send, today } = shouldSendNow(tz, log?.sent_on ?? null);
      const sameDay = log?.sent_on === today;
      if (!send && !force) continue;

      const { data: items } = await db.from("items").select("name,category,due_date,warn_days,cost").eq("user_id", u.id).is("done_at", null);
      const digest = buildDigest((items ?? []) as DueItem[], today);
      if (!digest) continue;

      const wantEmail = (profile?.email_reminders ?? true) && !!u.email;
      const row: Record<string, unknown> = { user: u.email, subject: digest.subject, count: digest.count };
      if (dry) {
        report.push({ ...row, text: digest.text });
        continue;
      }

      let emailSent = sameDay && log?.email_sent;
      let pushSent = sameDay && log?.push_sent;
      if (wantEmail && !emailSent) {
        await sendEmail(u.email!, digest.subject, digest.html, digest.text);
        emailSent = true;
      }
      if (pushOn && !pushSent) {
        const { data: subs } = await db.from("push_subscriptions").select("endpoint,subscription").eq("user_id", u.id);
        for (const s of subs ?? []) {
          try {
            await webpush.sendNotification(s.subscription, JSON.stringify({ title: digest.pushTitle, body: digest.pushBody }));
            pushSent = true;
          } catch (e) {
            const code = (e as { statusCode?: number }).statusCode;
            if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          }
        }
      }
      await db.from("reminder_log").upsert({ user_id: u.id, sent_on: today, email_sent: !!emailSent, push_sent: !!pushSent });
      report.push({ ...row, emailSent: !!emailSent, pushSent: !!pushSent });
    } catch (e) {
      report.push({ user: u.email, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return Response.json({ ok: true, report });
});
