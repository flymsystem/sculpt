// src/lib/broadcast.js
// ─────────────────────────────────────────────────────────────────
// Broadcast messaging — Edge Function calls + Razorpay checkout
// ─────────────────────────────────────────────────────────────────

import { supabase } from './supabase.js';

const COST_PER_MSG_PAISE = 150; // ₹1.50 per message — must match Edge Function

/**
 * Calculate cost for a given number of recipients.
 * Returns { count, costPaise, costRupees, costDisplay }
 */
export function calculateBroadcastCost(recipientCount) {
  const count = Math.max(0, parseInt(recipientCount) || 0);
  const costPaise = count * COST_PER_MSG_PAISE;
  const costRupees = costPaise / 100;
  return {
    count,
    costPaise,
    costRupees,
    costDisplay: '\u20B9' + costRupees.toLocaleString('en-IN'),
    perMsgDisplay: '\u20B9' + (COST_PER_MSG_PAISE / 100).toFixed(2),
  };
}

/**
 * Create a broadcast + Razorpay order via Edge Function.
 *
 * Only member IDs are sent. The Edge Function looks the names and phone
 * numbers up itself, scoped to the gym and excluding cancelled/removed
 * members — so the browser cannot dictate who Flym's WhatsApp number
 * messages, and the charge is based on what the server resolved.
 *
 * @param {string[]} memberIds
 * @returns { broadcast_id, razorpay_order_id, razorpay_key_id, amount_paise, total_recipients }
 */
export async function createBroadcastOrder(gymId, message, memberIds) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await supabase.functions.invoke('create-broadcast-order', {
    body: { gym_id: gymId, message, member_ids: memberIds },
  });

  if (res.error) throw new Error(res.error.message || 'Failed to create broadcast order');
  if (res.data?.error) throw new Error(res.data.error);
  return res.data;
}

/**
 * Open Razorpay checkout modal. Returns a Promise that resolves with
 * { razorpay_order_id, razorpay_payment_id, razorpay_signature } on success,
 * or rejects on failure/dismiss.
 */
export function openRazorpayCheckout({ orderId, keyId, amountPaise, gymName, recipientCount }) {
  return new Promise((resolve, reject) => {
    if (typeof window.Razorpay === 'undefined') {
      reject(new Error('Razorpay SDK not loaded. Please refresh and try again.'));
      return;
    }

    const options = {
      key: keyId,
      amount: amountPaise,
      currency: 'INR',
      name: 'Flym',
      description: `WhatsApp broadcast to ${recipientCount} members`,
      order_id: orderId,
      handler: function (response) {
        resolve({
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature,
        });
      },
      prefill: {
        name: gymName || '',
      },
      notes: {
        gym_name: gymName || '',
        broadcast_type: 'whatsapp_bulk',
      },
      theme: {
        color: '#2A8FFF',
      },
      modal: {
        ondismiss: function () {
          reject(new Error('Payment cancelled'));
        },
      },
    };

    const rzp = new window.Razorpay(options);
    rzp.on('payment.failed', function (response) {
      reject(new Error(response.error?.description || 'Payment failed'));
    });
    rzp.open();
  });
}

/**
 * After Razorpay payment succeeds, call the process-broadcast Edge Function
 * to verify payment and start sending messages.
 */
export async function processBroadcast(broadcastId, paymentDetails) {
  const res = await supabase.functions.invoke('process-broadcast', {
    body: {
      broadcast_id: broadcastId,
      razorpay_order_id: paymentDetails.razorpay_order_id,
      razorpay_payment_id: paymentDetails.razorpay_payment_id,
      razorpay_signature: paymentDetails.razorpay_signature,
    },
  });

  if (res.error) throw new Error(res.error.message || 'Failed to process broadcast');
  if (res.data?.error) throw new Error(res.data.error);
  return res.data;
}

/**
 * Fetch broadcast history for a gym (most recent first).
 */
export async function getBroadcasts(gymId, limit = 50) {
  const { data, error } = await supabase
    .from('broadcasts')
    .select('*')
    .eq('gym_id', gymId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

/**
 * Fetch recipients for a specific broadcast.
 */
// A broadcast can have up to 5,000 recipients and the detail view
// renders every one into a single table. Bounded to keep that view from
// freezing the tab; the summary counts on the same screen come from the
// broadcasts row, so they stay accurate regardless.
export const BROADCAST_RECIPIENTS_MAX = 500;

export async function getBroadcastRecipients(broadcastId, limit = BROADCAST_RECIPIENTS_MAX) {
  const { data, error } = await supabase
    .from('broadcast_recipients')
    .select('*')
    .eq('broadcast_id', broadcastId)
    .order('sent_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

/**
 * Poll a broadcast's current status (for the progress bar).
 */
export async function getBroadcastStatus(broadcastId) {
  const { data, error } = await supabase
    .from('broadcasts')
    .select('status, sent_count, failed_count, total_recipients, completed_at')
    .eq('id', broadcastId)
    .single();
  if (error) throw error;
  return data;
}