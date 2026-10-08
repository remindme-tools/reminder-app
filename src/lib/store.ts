import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Item, ItemInput } from "../types";
import { isRepeating, rollForward, rollForwardAt, isSpecialUnit, todayLocal } from "./dates";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const demoMode = !url || !key;
const supabase: SupabaseClient | null = demoMode
  ? null
  : createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "remindme-auth" },
    });

export interface Profile {
  email_reminders: boolean;
  timezone: string;
  category_colors: Record<string, string>;
}

export interface Session {
  email: string;
  needsPasswordReset?: boolean;
}

export interface Store {
  subscribeToAuth(cb: (session: Session | null) => void): () => void;
  getSession(): Promise<Session | null>;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<{ needsConfirm: boolean }>;
  signOut(): Promise<void>;
  resetPasswordForEmail(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  list(): Promise<Item[]>;
  create(input: ItemInput): Promise<void>;
  update(id: string, input: ItemInput): Promise<void>;
  remove(id: string): Promise<void>;
  markDone(item: Item): Promise<void>;
  undoDone(item: Item): Promise<void>;
  snooze(id: string, snoozedUntil: string | null): Promise<void>;
  uploadPhoto(file: Blob): Promise<string>;
  photoUrl(path: string): Promise<string>;
  getProfile(): Promise<Profile>;
  saveProfile(p: Profile): Promise<void>;
  savePushSubscription(sub: PushSubscriptionJSON | null): Promise<void>;
}

/** Compute the next due_date + due_at for a repeating item after it is marked done. */
function nextDueAt(item: Item): { due_date: string; due_at: string | null } | null {
  if (!isRepeating(item)) return null;
  const n = isSpecialUnit(item.repeat_unit) ? 1 : (item.repeat_every ?? 1);
  const unit = item.repeat_unit!;
  if (item.due_at) {
    const nextAt = rollForwardAt(item.due_at, n, unit, new Date().toISOString());
    return { due_date: nextAt.slice(0, 10), due_at: nextAt };
  }
  const next = rollForward(item.due_date, n, unit, todayLocal());
  return { due_date: next, due_at: null };
}

// ---------- Supabase ----------
let _explicitSignOut = false;

const remote: Store = {
  subscribeToAuth(cb) {
    const {
      data: { subscription },
    } = supabase!.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY" && s) {
        cb({ email: s.user.email ?? "", needsPasswordReset: true });
      } else if (s) {
        cb({ email: s.user.email ?? "" });
      } else if (event === "INITIAL_SESSION") {
        cb(null);
      } else if (event === "SIGNED_OUT" && _explicitSignOut) {
        _explicitSignOut = false;
        cb(null);
      }
      // TOKEN_REFRESH_FAILED and unexpected SIGNED_OUT: ignore — keep user logged in
    });
    return () => subscription.unsubscribe();
  },
  async getSession() {
    const { data } = await supabase!.auth.getSession();
    return data.session ? { email: data.session.user.email ?? "" } : null;
  },
  async signIn(email, password) {
    const { error } = await supabase!.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },
  async signUp(email, password) {
    const { data, error } = await supabase!.auth.signUp({ email, password });
    if (error) throw error;
    return { needsConfirm: !data.session };
  },
  async signOut() {
    _explicitSignOut = true;
    await supabase!.auth.signOut();
  },
  async resetPasswordForEmail(email) {
    const { error } = await supabase!.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
    });
    if (error) throw error;
  },
  async updatePassword(password) {
    const { error } = await supabase!.auth.updateUser({ password });
    if (error) throw error;
  },
  async list() {
    const { data, error } = await supabase!.from("items").select("*").order("due_date");
    if (error) throw error;
    return (data as Item[]).map((i) => ({
      ...i,
      notify_via: i.notify_via ?? "both",
      due_at: i.due_at ?? null,
      snoozed_until: i.snoozed_until ?? null,
    }));
  },
  async create(input) {
    const { data: u } = await supabase!.auth.getUser();
    const { error } = await supabase!.from("items").insert({ ...input, user_id: u.user!.id });
    if (error) throw error;
  },
  async update(id, input) {
    const { error } = await supabase!.from("items").update(input).eq("id", id);
    if (error) throw error;
  },
  async remove(id) {
    const { error } = await supabase!.from("items").delete().eq("id", id);
    if (error) throw error;
  },
  async markDone(item) {
    const next = nextDueAt(item);
    const patch = next
      ? { due_date: next.due_date, due_at: next.due_at, snoozed_until: null, done_at: null, last_done_at: new Date().toISOString() }
      : { done_at: new Date().toISOString() };
    const { error } = await supabase!.from("items").update(patch).eq("id", item.id);
    if (error) throw error;
  },
  async undoDone(item) {
    const { error } = await supabase!.from("items").update({ done_at: null }).eq("id", item.id);
    if (error) throw error;
  },
  async snooze(id, snoozedUntil) {
    const { error } = await supabase!.from("items").update({ snoozed_until: snoozedUntil }).eq("id", id);
    if (error) throw error;
  },
  async uploadPhoto(file) {
    const { data: u } = await supabase!.auth.getUser();
    const path = `${u.user!.id}/${crypto.randomUUID()}.jpg`;
    const { error } = await supabase!.storage
      .from("photos")
      .upload(path, file, { contentType: "image/jpeg" });
    if (error) throw error;
    return path;
  },
  async photoUrl(path) {
    const { data, error } = await supabase!.storage
      .from("photos")
      .createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
  },
  async getProfile() {
    const { data: u } = await supabase!.auth.getUser();
    const { data } = await supabase!
      .from("profiles")
      .select("*")
      .eq("user_id", u.user!.id)
      .maybeSingle();
    const profile: Profile = {
      email_reminders: data?.email_reminders ?? true,
      timezone: data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      category_colors: (data?.category_colors as Record<string, string>) ?? {},
    };
    if (!data?.timezone)
      await supabase!.from("profiles").upsert({ user_id: u.user!.id, ...profile });
    return profile;
  },
  async saveProfile(p) {
    const { data: u } = await supabase!.auth.getUser();
    const { error } = await supabase!
      .from("profiles")
      .upsert({ user_id: u.user!.id, ...p });
    if (error) throw error;
  },
  async savePushSubscription(sub) {
    const { data: u } = await supabase!.auth.getUser();
    const uid = u.user!.id;
    if (!sub) {
      await supabase!.from("push_subscriptions").delete().eq("user_id", uid);
      return;
    }
    const { error } = await supabase!
      .from("push_subscriptions")
      .upsert(
        { user_id: uid, endpoint: sub.endpoint, subscription: sub },
        { onConflict: "endpoint" }
      );
    if (error) throw error;
  },
};

// ---------- Demo (this device only) ----------
const LS = "remindme-demo-items";
const LS_SESSION = "remindme-demo-session";
const read = (): Item[] => JSON.parse(localStorage.getItem(LS) ?? "[]");
const write = (items: Item[]) => localStorage.setItem(LS, JSON.stringify(items));

const demo: Store = {
  subscribeToAuth(cb) {
    const s = localStorage.getItem(LS_SESSION);
    Promise.resolve().then(() => cb(s ? { email: "demo@this-device" } : null));
    return () => {};
  },
  async getSession() {
    return localStorage.getItem(LS_SESSION) ? { email: "demo@this-device" } : null;
  },
  async signIn() {
    localStorage.setItem(LS_SESSION, "1");
  },
  async signUp() {
    localStorage.setItem(LS_SESSION, "1");
    return { needsConfirm: false };
  },
  async signOut() {
    localStorage.removeItem(LS_SESSION);
  },
  async resetPasswordForEmail() {},
  async updatePassword() {},
  async list() {
    return read().map((i) => ({
      ...i,
      notify_via: i.notify_via ?? "both",
      due_at: i.due_at ?? null,
      snoozed_until: i.snoozed_until ?? null,
    }));
  },
  async create(input) {
    write([...read(), { ...input, id: crypto.randomUUID(), done_at: null }]);
  },
  async update(id, input) {
    write(read().map((i) => (i.id === id ? { ...i, ...input } : i)));
  },
  async remove(id) {
    write(read().filter((i) => i.id !== id));
  },
  async markDone(item) {
    const next = nextDueAt(item);
    write(
      read().map((i) =>
        i.id !== item.id ? i
        : next
          ? { ...i, due_date: next.due_date, due_at: next.due_at, snoozed_until: null, done_at: null }
          : { ...i, done_at: new Date().toISOString() }
      )
    );
  },
  async undoDone(item) {
    write(read().map((i) => (i.id === item.id ? { ...i, done_at: null } : i)));
  },
  async snooze(id, snoozedUntil) {
    write(read().map((i) => (i.id === id ? { ...i, snoozed_until: snoozedUntil } : i)));
  },
  async uploadPhoto(file) {
    return await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.readAsDataURL(file);
    });
  },
  async photoUrl(path) {
    return path;
  },
  async getProfile() {
    const raw = localStorage.getItem("remindme-demo-colors");
    return {
      email_reminders: true,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      category_colors: raw ? (JSON.parse(raw) as Record<string, string>) : {},
    };
  },
  async saveProfile(p) {
    localStorage.setItem("remindme-demo-colors", JSON.stringify(p.category_colors));
  },
  async savePushSubscription() {},
};

export const store: Store = demoMode ? demo : remote;
