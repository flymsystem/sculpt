// src/lib/supabase.js
// ─────────────────────────────────────────────────────────────────
// Supabase client singleton
// persistSession: true — session is saved to localStorage so page
// refreshes do not log the user out.
// autoRefreshToken: true — however, on iOS PWA the refresh interval
// stalls while backgrounded, so app.js also calls ensureFreshSession()
// on visibility return.
// ─────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    '[Sculpt] Missing Supabase env vars. Copy .env.example → .env.local and fill in your values.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,   // we do our own routing
    storageKey: 'sculpt-session',
  },
});

/**
 * Force the auth client to check the token and refresh if expired.
 * Called from app.js on visibilitychange → visible so a PWA returning
 * from background does not silently 401 on the next user action.
 *
 * Returns true if a valid session exists after the check, false otherwise.
 */
export async function ensureFreshSession() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) return false;
    if (!session) return false;

    // If token expires within 60s, force a refresh
    const expAt = session.expires_at ? session.expires_at * 1000 : 0;
    if (expAt && expAt - Date.now() < 60_000) {
      const { data: r, error: rErr } = await supabase.auth.refreshSession();
      if (rErr || !r?.session) return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}
