// supabase/functions/create-gym-user/index.ts
// ─────────────────────────────────────────────────────────────────
// Supabase Edge Function — Create a new gym owner account
// Uses the service role key (never exposed to browser)
// Deploy: supabase functions deploy create-gym-user
//
// ── RENAMED FROM index.js (2026-08) ──────────────────────────────
// The Supabase CLI resolves a function's entrypoint as index.ts and
// nothing else. While this file was index.js, `functions deploy
// create-gym-user` failed with
//   "Entrypoint path does not exist - .../create-gym-user/index.ts"
// so this function could never be deployed — the same defect
// AUDIT.md D2 found in whatsapp-webhook, which was renamed but this
// one was missed. Logic is unchanged from the .js version; only the
// extension and the type annotations below differ.
// ─────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Verify the caller is an authenticated Flym admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'No authorization header' }, 401);

    // Admin client (uses service role — only safe server-side)
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    // Verify the requester is a Flym admin
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    // .single() used to be used here. Migration 023 dropped
    // UNIQUE(user_id) on gym_users to support multi-branch owners, so a
    // user with more than one row makes .single() throw -- and the
    // failure surfaced as a generic 400. Filter by role and take one.
    const { data: gymUser } = await adminClient
      .from('gym_users')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .limit(1)
      .maybeSingle();

    if (!gymUser) {
      return json({ error: 'Forbidden: only Flym admins can create gym users' }, 403);
    }

    // Parse the request body
    const { email, password, gymId, gymName } = await req.json();
    if (!email || !password || !gymId) {
      return json({ error: 'Missing required fields: email, password, gymId' }, 400);
    }

    // Create the Auth user
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError) throw createError;

    // Link user to gym
    const { error: linkError } = await adminClient.from('gym_users').insert({
      user_id: newUser.user.id,
      gym_id:  gymId,
      role:    'owner',
    });

    if (linkError) throw linkError;

    // Log the action
    await adminClient.from('activity_log').insert({
      action:      'gym_user_created',
      description: `New gym owner account created for ${gymName}`,
      metadata:    { email, gym_id: gymId },
    });

    return json({ success: true, userId: newUser.user.id }, 200);

  } catch (err: any) {
    // An unexpected throw is a server fault, not a client mistake.
    // Returning 400 for everything made "our database is down"
    // indistinguishable from "you sent bad input", and leaked the raw
    // internal message to the browser either way.
    console.error('[create-gym-user] unhandled:', err?.message, err?.stack);
    return json({ error: 'Something went wrong creating this account. Please try again.' }, 500);
  }
});
