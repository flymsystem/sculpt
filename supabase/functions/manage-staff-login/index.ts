// supabase/functions/manage-staff-login/index.ts
// ─────────────────────────────────────────────────────────────────
// Edge Function — Owner-only staff login management.
// Actions: reset_password | disable | enable | remove | change_email
//
// Same trust boundary and shape as create-staff-user/index.ts (which
// this deliberately mirrors rather than introducing a new pattern):
// the caller's own JWT proves who they are, a service-role client
// then does the actual writes, and "is this caller an owner of this
// gym" is checked against gym_users on every single call — never
// trusted from the request body, and never skipped for any action.
// A staff account (role = 'staff' in gym_users) fails that check the
// same way an anonymous caller would, so staff cannot manage staff
// logins even by calling this function directly with a crafted
// request — the enforcement lives here, in the one place with
// enough privilege to touch auth.users, not in the dashboard UI.
//
// Deploy: supabase functions deploy manage-staff-login
// ─────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const ACTIONS = ['reset_password', 'disable', 'enable', 'remove', 'change_email'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    // ── Auth: verify the caller is a gym owner ──────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'No authorization header' }, 401);

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    const { data: ownerRow, error: ownerError } = await admin
      .from('gym_users')
      .select('role, gym_id')
      .eq('user_id', user.id)
      .eq('role', 'owner')
      .limit(1)
      .maybeSingle();

    if (ownerError) {
      console.error('[manage-staff-login] owner lookup failed:', ownerError.message);
      return json({ error: 'Could not verify your account. Please try again.' }, 500);
    }
    if (!ownerRow) {
      return json({ error: 'Forbidden: only gym owners can manage staff logins' }, 403);
    }
    const gymId = ownerRow.gym_id;

    // ── Parse request body ──────────────────────────────────────
    let payload: any;
    try {
      payload = await req.json();
    } catch {
      return json({ error: 'Invalid request body' }, 400);
    }

    const { staffId, action } = payload || {};
    if (!staffId) return json({ error: 'Missing staffId' }, 400);
    if (!ACTIONS.includes(action)) {
      return json({ error: `action must be one of: ${ACTIONS.join(', ')}` }, 400);
    }

    const { data: staffRow, error: staffFetchError } = await admin
      .from('staff')
      .select('id, full_name, user_id, login_enabled, gym_id')
      .eq('id', staffId)
      .eq('gym_id', gymId)
      .maybeSingle();

    if (staffFetchError) {
      console.error('[manage-staff-login] staff lookup failed:', staffFetchError.message);
      return json({ error: 'Could not look up this staff member. Please try again.' }, 500);
    }
    if (!staffRow) {
      return json({ error: 'Staff member not found or does not belong to your gym' }, 404);
    }
    // Defence in depth: this screen only ever lists rows from `staff`,
    // and the owner's own login lives in gym_users, not staff — but if
    // the two ever coincided for the same auth user, never let the
    // owner disable/remove/reset their own account through this path.
    if (staffRow.user_id === user.id) {
      return json({ error: 'You cannot manage your own login from here.' }, 403);
    }
    if (!staffRow.user_id) {
      return json({ error: 'This staff member does not have a login yet.' }, 409);
    }

    if (action === 'reset_password') {
      const { newPassword } = payload;
      if (!newPassword || String(newPassword).length < 6) {
        return json({ error: 'Password must be at least 6 characters' }, 400);
      }
      const { error } = await admin.auth.admin.updateUserById(staffRow.user_id, { password: newPassword });
      if (error) return json({ error: error.message || 'Failed to reset password' }, 400);
      return json({ ok: true, staffName: staffRow.full_name });
    }

    if (action === 'change_email') {
      const { newEmail } = payload;
      const cleanEmail = String(newEmail || '').trim().toLowerCase();
      if (!cleanEmail || !cleanEmail.includes('@')) {
        return json({ error: 'Valid email is required' }, 400);
      }
      const { error } = await admin.auth.admin.updateUserById(staffRow.user_id, {
        email: cleanEmail,
        email_confirm: true,
      });
      if (error) {
        const msg = error.message || '';
        if (msg.includes('already been registered') || msg.includes('already exists')) {
          return json({ error: 'This email address is already in use.' }, 409);
        }
        return json({ error: msg || 'Failed to change email' }, 400);
      }
      const { error: updateError } = await admin
        .from('staff')
        .update({ login_email: cleanEmail })
        .eq('id', staffId)
        .eq('gym_id', gymId);
      if (updateError) console.error('[manage-staff-login] login_email sync failed:', updateError.message);
      return json({ ok: true, staffName: staffRow.full_name, email: cleanEmail });
    }

    if (action === 'disable' || action === 'enable') {
      const enabled = action === 'enable';
      const { error } = await admin
        .from('staff')
        .update({ login_enabled: enabled })
        .eq('id', staffId)
        .eq('gym_id', gymId);
      if (error) return json({ error: error.message || `Failed to ${action} login` }, 400);
      return json({ ok: true, staffName: staffRow.full_name, loginEnabled: enabled });
    }

    if (action === 'remove') {
      // Order matters: delete the auth user first. If that fails,
      // nothing else has changed and the action can be retried safely.
      const { error: deleteAuthError } = await admin.auth.admin.deleteUser(staffRow.user_id);
      if (deleteAuthError) {
        console.error('[manage-staff-login] deleteUser failed:', deleteAuthError.message);
        return json({ error: deleteAuthError.message || 'Failed to remove the login account' }, 400);
      }
      // gym_users has no FK-cascade from auth.users in this schema, so
      // the row is removed explicitly rather than relying on cascade.
      const { error: unlinkError } = await admin
        .from('gym_users')
        .delete()
        .eq('user_id', staffRow.user_id)
        .eq('gym_id', gymId)
        .eq('role', 'staff');
      if (unlinkError) console.error('[manage-staff-login] gym_users cleanup failed:', unlinkError.message);

      // staff.id / attendance / salary history are untouched on
      // purpose — this removes access, not the person's record.
      const { error: staffUpdateError } = await admin
        .from('staff')
        .update({ user_id: null, login_enabled: false, login_email: null, login_created_at: null })
        .eq('id', staffId)
        .eq('gym_id', gymId);
      if (staffUpdateError) console.error('[manage-staff-login] staff cleanup failed:', staffUpdateError.message);

      return json({ ok: true, staffName: staffRow.full_name });
    }

    return json({ error: 'Unhandled action' }, 400);
  } catch (err: any) {
    console.error('[manage-staff-login] unhandled:', err?.message, err?.stack);
    return json({ error: err?.message || 'Unexpected server error' }, 500);
  }
});
