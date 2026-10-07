import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Item, ItemInput } from "../types";
import { isRepeating, rollForward, todayLocal } from "./dates";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** With no Supabase keys the app runs in "demo mode": data stays on this device only. */
export const demoMode = !url || !key;
const supabase: SupabaseClient | null = demoMode ? null : createClient(url!, key!);

export interface Profile {
  email_reminders: boolean;
  timezone: string;
}

export interface Session {
  email: string;
}

export interface Store {
  getSession(): Promise<Session | null>;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<{ needsConfirm: boolean }>;
  signOut(): Promise<void>;
  list(): Promise<Item[]>;
  create(input: ItemInput): Promise<void>;
  update(id: string, input: ItemInput): Promise<void>;
  remove(id: string): Promise<void>;
  markDone(item: Item): Promise<void>;
  undoDone(item: Item): Promise<void>;
  uploadPhoto(file: Blob): Promise<string>;
  photoUrl(path: string): Promise<string>;
  getProfile(): Promise<Profile>;
  saveProfile(p: Profile): Promise<void>;
  savePushSubscription(sub: PushSubscriptionJSON | null): Promise<void>;
}

function nextDue(item: Item): string | null {
  return isRepeating(item) ? rollForward(item.due_date, item.repeat_every!, item.repeat_unit!, todayLocal()) : null;
}

// ---------- Supabase ----------
const remote: Store = {
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
    await supabase!.auth.signOut();
  },
  async list() {
    const { data, error } = await supabase!.from("items").select("*").order("due_date");
    if (error) throw error;
    return data as Item[];
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
    const next = nextDue(item);
    const patch = next ? { due_date: next, done_at: null, last_done_at: new Date().toISOString() } : { done_at: new Date().toISOString() };
    const { error } = await supabase!.from("items").update(patch).eq("id", item.id);
    if (error) throw error;
  },
  async undoDone(item) {
    const { error } = await supabase!.from("items").update({ done_at: null }).eq("id", item.id);
    if (error) throw error;
  },
  async uploadPhoto(file) {
    const { data: u } = await supabase!.auth.getUser();
    const path = `${u.user!.id}/${crypto.randomUUID()}.jpg`;
    const { error } = await supabase!.storage.from("photos").upload(path, file, { contentType: "image/jpeg" });
    if (error) throw error;
    return path;
  },
  async photoUrl(path) {
    const { data, error } = await supabase!.storage.from("photos").createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
  },
  async getProfile() {
    const { data: u } = await supabase!.auth.getUser();
    const { data } = await supabase!.from("profiles").select("*").eq("user_id", u.user!.id).maybeSingle();
    const profile = {
      email_reminders: data?.email_reminders ?? true,
      timezone: data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    // First launch: remember this phone's time zone so the 7am email arrives at 7am for you.
    if (!data?.timezone) await supabase!.from("profiles").upsert({ user_id: u.user!.id, ...profile });
    return profile;
  },
  async saveProfile(p) {
    const { data: u } = await supabase!.auth.getUser();
    const { error } = await supabase!.from("profiles").upsert({ user_id: u.user!.id, ...p });
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
      .upsert({ user_id: uid, endpoint: sub.endpoint, subscription: sub }, { onConflict: "endpoint" });
    if (error) throw error;
  },
};

// ---------- Demo (this device only) ----------
const LS = "remindme-demo-items";
const LS_SESSION = "remindme-demo-session";
const read = (): Item[] => JSON.parse(localStorage.getItem(LS) ?? "[]");
const write = (items: Item[]) => localStorage.setItem(LS, JSON.stringify(items));

const demo: Store = {
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
  async list() {
    return read();
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
    const next = nextDue(item);
    write(read().map((i) => (i.id !== item.id ? i : next ? { ...i, due_date: next } : { ...i, done_at: new Date().toISOString() })));
  },
  async undoDone(item) {
    write(read().map((i) => (i.id === item.id ? { ...i, done_at: null } : i)));
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
    return { email_reminders: true, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  },
  async saveProfile() {},
  async savePushSubscription() {},
};

export const store: Store = demoMode ? demo : remote;
