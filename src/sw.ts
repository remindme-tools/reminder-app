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
  event.waitUntil(
    self.registration.showNotification(data.title, { body: data.body, icon: "icon-192.png", badge: "icon-192.png", tag: "daily" })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow(self.registration.scope)))
  );
});
