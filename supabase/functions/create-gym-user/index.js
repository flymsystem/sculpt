// supabase/functions/create-gym-user/index.js
// ─────────────────────────────────────────────────────────────────
// Supabase Edge Function — Create a new gym owner account
// Uses the service role key (never exposed to browser)
// Deploy: supabase functions deploy create-gym-user
// ─────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Verify the caller is an authenticated Flym admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('No authorization header');

    // Admin client (uses service role — only safe server-side)
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false } }
    );

    // Verify the requester is a Flym admin
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_ANON_KEY'),
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) throw new Error('Unauthorized');

    const { data: gymUser } = await adminClient
      .from('gym_users')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (!gymUser || gymUser.role !== 'admin') {
      throw new Error('Forbidden: only Flym admins can create gym users');
    }

    // Parse the request body
    const { email, password, gymId, gymName } = await req.json();
    if (!email || !password || !gymId) {
      throw new Error('Missing required fields: email, password, gymId');
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

    return new Response(
      JSON.stringify({ success: true, userId: newUser.user.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
