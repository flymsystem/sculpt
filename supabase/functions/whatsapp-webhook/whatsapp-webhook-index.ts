// supabase/functions/whatsapp-webhook/index.ts
// ─────────────────────────────────────────────────────────────────
// WhatsApp Cloud API Webhook endpoint.
//
// GET  → Meta verification challenge (one-time setup)
// POST → Incoming events: message status updates, incoming messages
//
// Deploy:
//   supabase functions deploy whatsapp-webhook --no-verify-jwt
//   (must disable JWT — Meta sends raw HTTP, no Supabase auth header)
//
// Env vars needed:
//   WA_WEBHOOK_VERIFY_TOKEN  — random string you set in Meta dashboard
//
// Register in Meta Developer Dashboard → WhatsApp → Configuration:
//   Callback URL:  https://<project-ref>.supabase.co/functions/v1/whatsapp-webhook
//   Verify Token:  <your WA_WEBHOOK_VERIFY_TOKEN value>
//   Subscribe to:  messages
// ─────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  // ── GET: Meta webhook verification challenge ─────────────────
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode      = url.searchParams.get('hub.mode');
    const token     = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    const expectedToken = Deno.env.get('WA_WEBHOOK_VERIFY_TOKEN');

    if (mode === 'subscribe' && token === expectedToken) {
      console.log('[whatsapp-webhook] Verification challenge accepted');
      return new Response(challenge, { status: 200 });
    }

    console.warn('[whatsapp-webhook] Verification failed — token mismatch');
    return new Response('Forbidden', { status: 403 });
  }

  // ── POST: Incoming webhook events ────────────────────────────
  if (req.method === 'POST') {
    // Meta expects 200 within 5 seconds — always respond 200 first,
    // process asynchronously. But Edge Functions are request-scoped,
    // so we process inline but keep it fast.
    try {
      const body = await req.json();

      // Validate it's a WhatsApp webhook payload
      if (body.object !== 'whatsapp_business_account') {
        return new Response('OK', { status: 200 });
      }

      const admin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { auth: { persistSession: false } }
      );

      // Process each entry (usually 1, but Meta can batch)
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field !== 'messages') continue;

          const value = change.value;
          if (!value) continue;

          // ── Status updates (sent → delivered → read → failed) ──
          if (value.statuses && Array.isArray(value.statuses)) {
            for (const status of value.statuses) {
              await handleStatusUpdate(admin, status);
            }
          }

          // ── Incoming messages (customer replies) ───────────────
          if (value.messages && Array.isArray(value.messages)) {
            for (const msg of value.messages) {
              await handleIncomingMessage(admin, msg, value.contacts);
            }
          }

          // ── Errors at the value level ─────────────────────────
          if (value.errors && Array.isArray(value.errors)) {
            for (const err of value.errors) {
              await logWebhookEvent(admin, {
                event_type: 'error',
                error_code: String(err.code || ''),
                error_title: err.title || err.message || 'Unknown error',
                payload: err,
              });
            }
          }
        }
      }

      return new Response('OK', { status: 200 });
    } catch (err) {
      // Always return 200 — Meta will retry on non-2xx and can
      // disable the webhook after repeated failures
      console.error('[whatsapp-webhook] Processing error:', err);
      return new Response('OK', { status: 200 });
    }
  }

  // Other methods
  return new Response('Method not allowed', { status: 405 });
});

// ─────────────────────────────────────────────────────────────────
// handleStatusUpdate
// Updates broadcast_recipients when a message is delivered/read/failed.
// Meta sends: sent → delivered → read (progressive)
// ─────────────────────────────────────────────────────────────────
async function handleStatusUpdate(
  admin: ReturnType<typeof createClient>,
  status: {
    id: string;           // wamid
    status: string;       // 'sent' | 'delivered' | 'read' | 'failed'
    timestamp: string;    // Unix timestamp
    recipient_id: string; // phone number
    errors?: Array<{ code: number; title: string }>;
  }
) {
  const wamid = status.id;
  const newStatus = status.status;
  const ts = new Date(parseInt(status.timestamp) * 1000).toISOString();

  // Log raw event
  await logWebhookEvent(admin, {
    event_type: 'status',
    wamid,
    phone: status.recipient_id,
    status: newStatus,
    error_code: status.errors?.[0]?.code ? String(status.errors[0].code) : null,
    error_title: status.errors?.[0]?.title || null,
    payload: status,
  });

  if (!wamid) return;

  // Status progression: only advance forward, never regress
  // sent(1) → delivered(2) → read(3). failed can happen at any point.
  const statusRank: Record<string, number> = {
    pending: 0,
    sent: 1,
    delivered: 2,
    read: 3,
    failed: 99,
  };

  // Find the broadcast_recipient row by wamid
  const { data: recipient } = await admin
    .from('broadcast_recipients')
    .select('id, status')
    .eq('wamid', wamid)
    .limit(1)
    .maybeSingle();

  if (!recipient) {
    // wamid not found — could be from send-reminders or a message
    // sent outside the broadcast system. Log and move on.
    return;
  }

  const currentRank = statusRank[recipient.status] ?? 0;
  const newRank = statusRank[newStatus] ?? 0;

  // Only update if advancing (or if failed)
  if (newRank <= currentRank && newStatus !== 'failed') return;

  const updateData: Record<string, unknown> = { status: newStatus };

  if (newStatus === 'delivered') {
    updateData.delivered_at = ts;
  } else if (newStatus === 'read') {
    updateData.read_at = ts;
    // Also set delivered_at if we somehow missed the delivered event
    updateData.delivered_at = ts;
  } else if (newStatus === 'failed') {
    updateData.error_message = status.errors?.[0]?.title || 'Message failed';
  }

  await admin
    .from('broadcast_recipients')
    .update(updateData)
    .eq('id', recipient.id);
}

// ─────────────────────────────────────────────────────────────────
// handleIncomingMessage
// Logs incoming WhatsApp messages from gym members.
// Phase 1: log only. Phase 2 will add two-way chat inbox.
// ─────────────────────────────────────────────────────────────────
async function handleIncomingMessage(
  admin: ReturnType<typeof createClient>,
  msg: {
    id: string;        // wamid
    from: string;      // sender phone
    timestamp: string;
    type: string;      // 'text', 'image', 'document', etc.
    text?: { body: string };
  },
  contacts?: Array<{ profile: { name: string }; wa_id: string }>
) {
  const senderName = contacts?.find(c => c.wa_id === msg.from)?.profile?.name || '';

  await logWebhookEvent(admin, {
    event_type: 'message',
    wamid: msg.id,
    phone: msg.from,
    status: msg.type,
    payload: {
      type: msg.type,
      text: msg.text?.body || null,
      sender_name: senderName,
      timestamp: msg.timestamp,
    },
  });

  // Phase 2: insert into wa_incoming_messages table and
  // route to the correct gym based on member phone lookup
}

// ─────────────────────────────────────────────────────────────────
// logWebhookEvent — fire-and-forget event logging
// ─────────────────────────────────────────────────────────────────
async function logWebhookEvent(
  admin: ReturnType<typeof createClient>,
  event: {
    event_type: string;
    wamid?: string | null;
    phone?: string | null;
    status?: string | null;
    error_code?: string | null;
    error_title?: string | null;
    payload?: unknown;
  }
) {
  try {
    await admin.from('wa_webhook_events').insert({
      event_type: event.event_type,
      wamid: event.wamid || null,
      phone: event.phone || null,
      status: event.status || null,
      error_code: event.error_code || null,
      error_title: event.error_title || null,
      payload: event.payload || null,
    });
  } catch (err) {
    // Never let logging failures break the webhook response
    console.error('[whatsapp-webhook] Failed to log event:', err);
  }
}
