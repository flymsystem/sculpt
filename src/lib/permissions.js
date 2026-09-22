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
 *
 * ── Staff get two pages, and only two (client decision, 2026-09-22)
 * A staff login exists to mark that staff member's own attendance by
 * scanning the rotating desk QR (`checkin_scan`), and to take walk-in
 * enquiries at the desk (`leads: 'limited'`). It grants no dashboard,
 * no member list, no money. Every other staff key below is `false`,
 * and dashboard/index.js renders a minimal two-page shell (no
 * sidebar, no command palette, no FAB, no loadData()) rather than the
 * full app with things hidden. Before you add a third staff
 * permission, read the note on `checkin_scan` and the "staff shell"
 * comment in dashboard/index.js — the near-empty matrix is the
 * feature, not an oversight.
 *
 * NOTE ON `leads`: staff hold `'limited'`, the owner `'full'`. The
 * difference is exactly two buttons in dashboard/enquiries.js —
 * Remove and Convert to member — both of which are gated on
 * `can(role,'leads') === 'full'`. Convert in particular must stay
 * owner-only for a structural reason, not a policy one: it opens the
 * Add Member modal, which needs S.members, S.plans and S.addonTemplates
 * — data a staff session deliberately never fetches. Attribution is
 * handled server-side (enquiries.created_by_name, migration 132), so
 * every enquiry a staff member records shows up in the owner's list
 * stamped with their name.
 *
 * NOTE ON `checkin_scan`: it is the OWNER who has this false, not
 * staff. sculpt_staff_checkin() resolves the caller via
 * `staff.user_id = auth.uid()`, and an owner has no `staff` row, so
 * an owner scan can only ever come back NOT_STAFF ("This account is
 * not an active staff member"). The sidebar used to key this page off
 * `attendance`, which the owner has, so it offered the owner a Check
 * In page that could not succeed — and testing staff attendance from
 * the owner account is exactly how this feature looks broken when it
 * isn't. `attendance` still gates the two pages an owner genuinely
 * uses: the desk display and the check-ins log.
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
    attendance:       'full',     // desk display + check-ins log
    checkin_scan:     false,      // owner has no staff row — see above
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
    dashboard:        false,
    members:          false,
    add_member:       false,
    edit_member:      false,
    delete_member:    false,
    cancel_member:    false,
    payments:         false,
    attendance:       false,      // no desk display, no gym-wide log
    checkin_scan:     true,       // the one thing a staff login is for
    renew_member:     false,
    plans:            false,
    plans_showcase:   false,
    pt_management:    false,
    leads:            'limited', // add + edit walk-in enquiries; no remove, no convert
    expenses:         false,
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
    { id: 'checkin-scan',    perm: 'checkin_scan' },
    { id: 'checkin-display', perm: 'attendance' },
    { id: 'checkins',        perm: 'attendance' },
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
