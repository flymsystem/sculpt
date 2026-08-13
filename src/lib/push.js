// src/lib/push.js
// ─────────────────────────────────────────────────────────────────
// Web Push subscription management (Phase 2 of notifications).
//
// Platform reality check — read this before debugging:
//  * Android Chrome / desktop Chrome / Edge / Firefox: works from the
//    normal browser tab, no install needed.
//  * iOS Safari: push ONLY works when the PWA has been ADDED TO HOME
//    SCREEN and opened from there (iOS 16.4+). In a normal Safari tab
//    `window.Notification` is undefined and this module no-ops.
//  * Permission MUST be requested from a real user gesture (a tap),
//    never automatically on load — iOS silently denies otherwise.
// ─────────────────────────────────────────────────────────────────
import { supabase } from './supabase.js';

// Set this to your VAPID *public* key. Generate with:
//   npx web-push generate-vapid-keys
// Public key goes here + into VITE_VAPID_PUBLIC_KEY.
// Private key goes ONLY into Supabase secrets (VAPID_PRIVATE_KEY).
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';

/** True when this browser/context can actually do Web Push. */
export function pushSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && typeof window.Notification !== 'undefined';
}

/** True when running as an installed PWA (home screen / standalone). */
export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)')?.matches === true
    || window.navigator.standalone === true;
}

export function isIOS() {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** 'granted' | 'denied' | 'default' | 'unsupported' */
export function permissionState() {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission;
}

/**
 * Human-readable reason push is unavailable, or null if it's fine.
 * Used by the bell UI to show the right hint instead of a dead button.
 */
export function unavailableReason() {
  if (typeof window === 'undefined') return 'Not supported here.';
  if (isIOS() && !isStandalone()) {
    return 'On iPhone/iPad, add Flym to your Home Screen first (Share → Add to Home Screen), then open it from there to enable notifications.';
  }
  if (!pushSupported()) return 'This browser does not support push notifications.';
  if (!VAPID_PUBLIC_KEY) return 'Push is not configured for this deployment yet.';
  if (Notification.permission === 'denied') {
    return 'Notifications are blocked. Enable them for flym.in in your browser/site settings.';
  }
  return null;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bufToBase64Url(buf) {
  if (!buf) return '';
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return window.btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Ask for permission and register a push subscription for this device.
 * MUST be called from a user gesture.
 *
 * @returns {Promise<{ok:boolean, reason?:string}>}
 */
export async function enablePush(gymId) {
  const blocked = unavailableReason();
  if (blocked) return { ok: false, reason: blocked };
  if (!gymId) return { ok: false, reason: 'No gym selected.' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, reason: 'Permission was not granted.' };
  }

  const reg = await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = sub.toJSON ? sub.toJSON() : {};
  const p256dh = json.keys?.p256dh || bufToBase64Url(sub.getKey?.('p256dh'));
  const auth   = json.keys?.auth   || bufToBase64Url(sub.getKey?.('auth'));

  if (!p256dh || !auth) {
    return { ok: false, reason: 'Could not read the push keys from this browser.' };
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'Not signed in.' };

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({
      gym_id:     gymId,
      user_id:    user.id,
      endpoint:   sub.endpoint,
      p256dh,
      auth_key:   auth,
      user_agent: navigator.userAgent.slice(0, 250),
      is_active:  true,
      last_used_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });

  if (error) {
    console.warn('[Flym] push subscribe save failed:', error.message);
    return { ok: false, reason: error.message };
  }

  return { ok: true };
}

/** Unsubscribe this device and deactivate the row. */
export async function disablePush() {
  if (!pushSupported()) return { ok: true };
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => {});
      await supabase
        .from('push_subscriptions')
        .update({ is_active: false })
        .eq('endpoint', endpoint);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/** Is this specific device currently subscribed? */
export async function isSubscribed() {
  if (!pushSupported()) return false;
  try {
    if (Notification.permission !== 'granted') return false;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch { return false; }
}

/**
 * Ask the send-push Edge Function to deliver a push to every registered
 * device for this gym. Fire-and-forget — never block the UI on it.
 */
export async function sendPushToGym(gymId, { title, body, section, tag }) {
  if (!gymId || !title) return;
  try {
    await supabase.functions.invoke('send-push', {
      body: { gymId, title, body: body || '', section: section || '', tag: tag || '' },
    });
  } catch (err) {
    console.warn('[Flym] sendPushToGym:', err.message);
  }
}
