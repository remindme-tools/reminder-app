/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener("message", (e) => {
  if (e.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? { title: "Remind Me", body: "You have items due." };
  // `actions` is a SW-only extension not in the standard NotificationOptions type
  const opts = {
    body: data.body,
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: data.tag ?? "remindme",
    data: data.data ?? {},
    actions: [
      { action: "snooze", title: "Snooze 10 min" },
      { action: "done",   title: "Done" },
    ],
  } as NotificationOptions;
  event.waitUntil(self.registration.showNotification(data.title, opts));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const itemId = (event.notification.data as { itemId?: string })?.itemId;
  const action = (event as NotificationEvent & { action?: string }).action;

  // Build the URL to navigate to:
  //   bare tap (no action) → open snooze sheet for this item
  //   snooze action        → snooze 10 min immediately via URL param
  //   done action          → mark done immediately via URL param
  let path = self.registration.scope;
  if (itemId) {
    if (action === "snooze") path += `?action=snooze&item=${encodeURIComponent(itemId)}`;
    else if (action === "done") path += `?action=done&item=${encodeURIComponent(itemId)}`;
    else path += `?snooze=${encodeURIComponent(itemId)}`;
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((cs) => {
      const existing = cs.find((c) => c.url.startsWith(self.registration.scope));
      if (existing) return existing.navigate(path).then((c) => c?.focus());
      return self.clients.openWindow(path);
    })
  );
});
