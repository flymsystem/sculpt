// src/lib/invoices.js
// ─────────────────────────────────────────────────────────────────
// Uploads generated invoice PDFs to the 'invoices' storage bucket
// so a link can be dropped straight into the WhatsApp message text.
// Bucket: public read, gym-scoped write (see migration 029).
// Path: {gymId}/{memberId}/{invoiceNo}.pdf
// ─────────────────────────────────────────────────────────────────
import { supabase } from './supabase.js';

async function uploadInvoicePdf(blob, gymId, memberId, invoiceNo) {
  if (!blob || !gymId || !memberId || !invoiceNo) return null;

  const path = `${gymId}/${memberId}/${invoiceNo}.pdf`;

  const { error: uploadErr } = await supabase.storage
    .from('invoices')
    .upload(path, blob, { contentType: 'application/pdf', upsert: true });

  if (uploadErr) {
    if (uploadErr.message?.includes('not found') || uploadErr.message?.includes('Bucket')) {
      throw new Error('Storage bucket "invoices" not found. Create it in Supabase \u2192 Storage and run migration 029.');
    }
    if (uploadErr.message?.includes('policy') || uploadErr.message?.includes('security') || uploadErr.message?.includes('Unauthorized')) {
      throw new Error('Storage permission denied. Check bucket policies for invoices.');
    }
    throw new Error(uploadErr.message);
  }

  const { data: urlData } = supabase.storage.from('invoices').getPublicUrl(path);
  return urlData?.publicUrl || null;
}

export { uploadInvoicePdf };
