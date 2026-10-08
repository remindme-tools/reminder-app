// Fires once per (item_id, fired_at, channel) — safe to call every minute via pg_cron.
// The reminder_fires table primary key makes every run idempotent.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";
import { buildItemEmail, buildItemPush, firedAtKey, isDueNow, type DueItem } from "./logic.ts";

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
  const dry = new URL(req.url).searchParams.has("dry"); // ?dry shows what would fire, sends nothing
  const pushOn = !!(env("VAPID_PUBLIC_KEY") && env("VAPID_PRIVATE_KEY"));
  if (pushOn) webpush.setVapidDetails(
    env("VAPID_SUBJECT") || "mailto:admin@example.com",
    env("VAPID_PUBLIC_KEY"),
    env("VAPID_PRIVATE_KEY")
  );

  const now = new Date();

  // Fetch all active items with their due times and user associations
  const { data: items, error } = await db
    .from("items")
    .select("id,user_id,name,category,due_date,due_at,snoozed_until,warn_days,cost,notify_via,repeat_every,repeat_unit")
    .is("done_at", null);
  if (error) return new Response(error.message, { status: 500 });

  const report: Record<string, unknown>[] = [];

  for (const item of (items ?? []) as (DueItem & { user_id: string })[]) {
    // Get user's timezone to correctly evaluate null due_at (treated as 09:00 local)
    const { data: profile } = await db.from("profiles").select("timezone,email_reminders").eq("user_id", item.user_id).maybeSingle();
    const tz = profile?.timezone ?? "UTC";

    if (!isDueNow(item, now, tz)) continue;

    const fired_at = firedAtKey(item, tz);
    const wantEmail = (!item.notify_via || item.notify_via === "email" || item.notify_via === "both") && (profile?.email_reminders ?? true);
    const wantPush  = !item.notify_via || item.notify_via === "push"  || item.notify_via === "both";

    // --- Email ---
    if (wantEmail) {
      const { data: alreadySent } = await db
        .from("reminder_fires")
        .select("item_id")
        .eq("item_id", item.id)
        .eq("fired_at", fired_at)
        .eq("channel", "email")
        .maybeSingle();

      if (!alreadySent) {
        const msg = buildItemEmail(item, now, tz);
        if (msg) {
          if (dry) {
            report.push({ item: item.name, channel: "email", status: "would-send", subject: msg.subject });
          } else {
            const { data: { user } } = await db.auth.admin.getUserById(item.user_id);
            if (user?.email) {
              try {
                await sendEmail(user.email, msg.subject, msg.html, msg.text);
                await db.from("reminder_fires").insert({ item_id: item.id, fired_at, channel: "email" });
                report.push({ item: item.name, channel: "email", status: "sent" });
              } catch (e) {
                report.push({ item: item.name, channel: "email", error: (e as Error).message });
              }
            }
          }
        }
      }
    }

    // --- Push ---
    if (pushOn && wantPush) {
      const { data: alreadySent } = await db
        .from("reminder_fires")
        .select("item_id")
        .eq("item_id", item.id)
        .eq("fired_at", fired_at)
        .eq("channel", "push")
        .maybeSingle();

      if (!alreadySent) {
        if (dry) {
          report.push({ item: item.name, channel: "push", status: "would-send" });
        } else {
          const { data: subs } = await db.from("push_subscriptions").select("endpoint,subscription").eq("user_id", item.user_id);
          const push = buildItemPush(item);
          let sent = false;
          for (const s of subs ?? []) {
            try {
              await webpush.sendNotification(
                s.subscription,
                JSON.stringify({
                  title: push.title,
                  body:  push.body,
                  tag:   push.tag,
                  data:  { itemId: item.id },
                })
              );
              sent = true;
            } catch (e) {
              const code = (e as { statusCode?: number }).statusCode;
              if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
            }
          }
          if (sent) {
            await db.from("reminder_fires").insert({ item_id: item.id, fired_at, channel: "push" });
            report.push({ item: item.name, channel: "push", status: "sent" });
          }
        }
      }
    }
  }

  return Response.json({ ok: true, fired: report.length, report });
});
