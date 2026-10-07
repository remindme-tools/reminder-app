import { store } from "./store";

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && !!VAPID;
}

function keyToBytes(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function pushEnabled(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.ready;
  return !!(await reg.pushManager.getSubscription());
}

export async function enablePush(): Promise<void> {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications were not allowed. You can change this in your phone's Settings.");
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(VAPID!) as BufferSource }));
  await store.savePushSubscription(sub.toJSON());
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  await sub?.unsubscribe();
  await store.savePushSubscription(null);
}
