// src/lib/permissions.js — Role-based permission matrix
// ─────────────────────────────────────────────────────────────────
// Centralised permission checks. Every UI gate and every
// action guard imports from here — no inline role checks.
// ─────────────────────────────────────────────────────────────────

/**
 * Permission matrix.
 * 'full'     = unrestricted
 * 'limited'  = partial access (details vary per module)
 * 'view'     = read-only
 * 'add'      = can add but not edit/delete
 * 'collect'  = can collect payments (clear balance, renew) but not view finance
 * 'assign'   = can assign (PT) but not manage
 * false      = no access
 */
const MATRIX = {
  owner: {
    dashboard:        'full',
    members:          'full',
    add_member:       true,
    edit_member:      true,
    delete_member:    true,       // soft-delete (is_active = false)
    cancel_member:    true,       // cancel membership (cancelled_at)
    payments:         'full',
    attendance:       'full',
    renew_member:     true,
    plans:            'full',
    plans_showcase:   true,
    pt_management:    'full',     // future
    leads:            'full',
    expenses:         'full',
    finance:          'full',
    reports:          'full',
    staff_management: 'full',
    settings:         'full',
    wa_settings:      'full',
    branding:         'full',
    backup:           'full',
    analytics:        'full',
  },
  staff: {
    dashboard:        'limited',  // no revenue/financial numbers
    members:          'full',
    add_member:       true,
    edit_member:      true,
    delete_member:    false,
    cancel_member:    false,
    payments:         'collect',  // clear balance + renew only, no finance page
    attendance:       'full',
    renew_member:     true,
    plans:            'view',
    plans_showcase:   true,
    pt_management:    'assign',   // future
    leads:            'full',
    expenses:         'add',      // can add, not edit/delete
    finance:          false,
    reports:          false,
    staff_management: false,
    settings:         false,
    wa_settings:      false,
    branding:         false,
    backup:           false,
    analytics:        false,
  },
};

/**
 * Check if a role has access to a module/action.
 * @param {string} role - 'owner' or 'staff'
 * @param {string} action - key from the matrix above
 * @returns {boolean|string} - false if no access, true/'full'/'limited'/etc if allowed
 */
export function can(role, action) {
  const perms = MATRIX[role];
  if (!perms) return false;
  const val = perms[action];
  return val === undefined ? false : val;
}

/**
 * Convenience: is the permission truthy at all?
 */
export function hasAccess(role, action) {
  return !!can(role, action);
}

/**
 * Get all sidebar-visible sections for a role.
 * Returns array of section IDs that should appear in nav.
 */
export function getVisibleSections(role) {
  const sections = [];
  const r = MATRIX[role];
  if (!r) return sections;

  // Map sidebar nav items to permission keys
  const navMap = [
    { id: 'overview',        perm: 'dashboard' },
    { id: 'members',         perm: 'members' },
    { id: 'enquiries',       perm: 'leads' },
    { id: 'alerts',          perm: 'members' },       // alerts need member access
    { id: 'staff',           perm: 'staff_management' },
    { id: 'finance',         perm: 'finance' },
    { id: 'expenses',        perm: 'expenses' },
    { id: 'plans-showcase',  perm: 'plans_showcase' },
    { id: 'plans',           perm: 'plans', requireFull: true },  // plan settings = full only
    { id: 'gymconfig',       perm: 'settings' },
    { id: 'backup',          perm: 'backup' },
    { id: 'analytics',       perm: 'analytics' },
  ];

  for (const { id, perm, requireFull } of navMap) {
    const val = can(role, perm);
    if (!val) continue;
    if (requireFull && val !== 'full' && val !== true) continue;
    sections.push(id);
  }

  return sections;
}
