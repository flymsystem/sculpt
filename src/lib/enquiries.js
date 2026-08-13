// src/lib/enquiries.js
// ─────────────────────────────────────────────────────────────────
// Enquiry CRUD — walk-in tracking for gym owners.
// Soft delete (is_active = false) to match the rest of the codebase.
//
// 2026-08: added 'Google Maps' as a source. `enquiries.source` is plain
// text with a DEFAULT (migration 018) and NO check constraint, so this
// needs no migration — existing rows are untouched.
// ─────────────────────────────────────────────────────────────────
import { supabase } from './supabase.js';

export async function getEnquiries(gymId) {
  const { data, error } = await supabase
    .from('enquiries')
    .select('*')
    .eq('gym_id', gymId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return data || [];
}

export async function addEnquiry(gymId, { name, phone, source, notes }) {
  const { data, error } = await supabase
    .from('enquiries')
    .insert({
      gym_id: gymId,
      name: name.trim(),
      phone: phone ? phone.trim() : null,
      source: source || 'Walk-in',
      notes: notes ? notes.trim() : null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateEnquiry(id, gymId, updates) {
  const payload = {};
  if (updates.name !== undefined)   payload.name   = updates.name.trim();
  if (updates.phone !== undefined)  payload.phone  = updates.phone ? updates.phone.trim() : null;
  if (updates.source !== undefined) payload.source = updates.source;
  if (updates.status !== undefined) payload.status = updates.status;
  if (updates.notes !== undefined)  payload.notes  = updates.notes ? updates.notes.trim() : null;
  if (updates.followed_up_at !== undefined) payload.followed_up_at = updates.followed_up_at;

  const { data, error } = await supabase
    .from('enquiries')
    .update(payload)
    .eq('id', id)
    .eq('gym_id', gymId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteEnquiry(id, gymId) {
  // Soft delete
  const { error } = await supabase
    .from('enquiries')
    .update({ is_active: false })
    .eq('id', id)
    .eq('gym_id', gymId);
  if (error) throw error;
}

// 'Google Maps' sits next to 'Google' deliberately — gym owners treat an
// organic search hit and a Maps listing tap as different lead channels,
// and separating them is the whole point of the request.
export const ENQUIRY_SOURCES = [
  'Walk-in',
  'Google Maps',
  'Google',
  'Instagram',
  'Referral',
  'Facebook',
  'WhatsApp',
  'Other',
];

export const ENQUIRY_STATUSES = ['New', 'Contacted', 'Converted', 'Lost'];
