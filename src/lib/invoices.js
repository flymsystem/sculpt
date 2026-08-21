// src/lib/invoices.js
// ─────────────────────────────────────────────────────────────────
// Uploads generated invoice PDFs to the 'invoices' storage bucket
// so a link can be dropped straight into the WhatsApp message text.
// Bucket: PRIVATE, gym-scoped write (migration 029), gym- and
// member-scoped read (migrations 101 + 110). Path:
// {gymId}/{memberId}/{invoiceNo}.pdf
//
// The bucket was public read until migration 110 — any receipt was
// readable by anyone who had or guessed the URL. Now that the member
// portal lists receipts, links are signed instead. A 1-year expiry
// keeps this a non-issue in practice for a WhatsApp link sent today,
// while the object itself is otherwise unreachable without a session.
// ─────────────────────────────────────────────────────────────────
import { supabase } from './supabase.js';

const SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24 * 365; // 1 year

async function uploadInvoicePdf(blob, gymId, memberId, invoiceNo) {
  if (!blob || !gymId || !memberId || !invoiceNo) return null;

  const path = `${gymId}/${memberId}/${invoiceNo}.pdf`;

  const { error: uploadErr } = await supabase.storage
    .from('invoices')
    .upload(path, blob, { contentType: 'application/pdf', upsert: true });

  if (uploadErr) {
    if (uploadErr.message?.includes('not found') || uploadErr.message?.includes('Bucket')) {
      throw new Error('Storage bucket "invoices" not found. Create it in Supabase → Storage and run migration 029.');
    }
    if (uploadErr.message?.includes('policy') || uploadErr.message?.includes('security') || uploadErr.message?.includes('Unauthorized')) {
      throw new Error('Storage permission denied. Check bucket policies for invoices.');
    }
    throw new Error(uploadErr.message);
  }

  return getSignedInvoiceUrl(path);
}

async function getSignedInvoiceUrl(path) {
  const { data, error } = await supabase.storage
    .from('invoices')
    .createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
  if (error) return null;
  return data?.signedUrl || null;
}

/** Lists a member's own uploaded receipts (member portal, own folder only). */
async function listMemberInvoices(gymId, memberId) {
  if (!gymId || !memberId) return [];
  const { data, error } = await supabase.storage
    .from('invoices')
    .list(`${gymId}/${memberId}`, { sortBy: { column: 'created_at', order: 'desc' } });
  if (error || !data) return [];

  const withUrls = await Promise.all(
    data.filter(f => f.name.endsWith('.pdf')).map(async (f) => ({
      name: f.name,
      createdAt: f.created_at,
      url: await getSignedInvoiceUrl(`${gymId}/${memberId}/${f.name}`),
    }))
  );
  return withUrls.filter(f => f.url);
}

export { uploadInvoicePdf, getSignedInvoiceUrl, listMemberInvoices };
