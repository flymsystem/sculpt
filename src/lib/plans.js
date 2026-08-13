// src/lib/plans.js
// ─────────────────────────────────────────────────────────────────
// Membership plan CRUD — scoped per gym
// ─────────────────────────────────────────────────────────────────

import { supabase } from './supabase.js';

export async function getPlans(gymId) {
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('gym_id', gymId)
    .eq('is_active', true)
    .order('duration_months');

  if (error) throw error;
  return data;
}

export async function addPlan(gymId, planData) {
  const name  = (planData.name || '').trim();
  const dur   = parseInt(planData.durationMonths, 10);
  const price = parseFloat(planData.price);

  if (!name)           throw new Error('Plan name is required.');
  if (!dur || dur < 1) throw new Error('Duration must be at least 1 month.');
  if (isNaN(price) || price <= 0) throw new Error('Price must be greater than ₹0.');

  const { data, error } = await supabase
    .from('plans')
    .insert({
      gym_id:          gymId,
      name,
      duration_months: dur,
      price,
      features:        planData.features || '',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updatePlan(planId, gymId, updates) {
  const name  = (updates.name || '').trim();
  const dur   = parseInt(updates.durationMonths, 10);
  const price = parseFloat(updates.price);

  if (!name)           throw new Error('Plan name is required.');
  if (!dur || dur < 1) throw new Error('Duration must be at least 1 month.');
  if (isNaN(price) || price <= 0) throw new Error('Price must be greater than ₹0.');

  const { data, error } = await supabase
    .from('plans')
    .update({
      name,
      duration_months: dur,
      price,
      features:        updates.features || '',
    })
    .eq('id', planId)
    .eq('gym_id', gymId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deletePlan(planId, gymId) {
  // Soft delete so existing members keep their plan snapshot
  const { error } = await supabase
    .from('plans')
    .update({ is_active: false })
    .eq('id', planId)
    .eq('gym_id', gymId);

  if (error) throw error;
}
