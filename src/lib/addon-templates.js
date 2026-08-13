import { supabase } from './supabase.js';

const txt = v => { const s = (v ?? '').toString().trim(); return s || null; };
const num = v => { const raw = (v ?? '').toString().replace(/,/g, ''); const n = parseFloat(raw); return isNaN(n) ? null : n; };

export async function getAddonTemplates(gymId) {
  const { data, error } = await supabase
    .from('addon_templates')
    .select('*')
    .eq('gym_id', gymId)
    .eq('is_active', true)
    .order('sort_order')
    .order('name');
  if (error) throw error;
  return data || [];
}

export async function addAddonTemplate(gymId, d) {
  const name = txt(d.name);
  if (!name) throw new Error('Add-on name is required.');
  const price = num(d.defaultPrice);
  if (price === null || price < 0) throw new Error('Price must be ₹0 or more.');

  const { data, error } = await supabase.from('addon_templates').insert({
    gym_id: gymId,
    name,
    default_price: price,
    is_one_time: !!d.isOneTime,
    sort_order: parseInt(d.sortOrder, 10) || 0,
  }).select().single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || { id: 'local_' + Date.now(), gym_id: gymId, name, default_price: price, is_one_time: !!d.isOneTime, is_active: true };
}

export async function updateAddonTemplate(id, gymId, u) {
  const payload = {};
  if (u.name !== undefined)         payload.name          = txt(u.name);
  if (u.defaultPrice !== undefined) payload.default_price  = num(u.defaultPrice);
  if (u.isOneTime !== undefined)    payload.is_one_time    = !!u.isOneTime;
  if (u.sortOrder !== undefined)    payload.sort_order     = parseInt(u.sortOrder, 10) || 0;

  const { data, error } = await supabase
    .from('addon_templates').update(payload)
    .eq('id', id).eq('gym_id', gymId)
    .select().single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || { id, ...payload };
}

export async function deleteAddonTemplate(id, gymId) {
  const { error } = await supabase
    .from('addon_templates').update({ is_active: false })
    .eq('id', id).eq('gym_id', gymId);
  if (error) throw error;
}
