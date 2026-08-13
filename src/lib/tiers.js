// src/lib/tiers.js — Subscription tier feature gating
// ─────────────────────────────────────────────────────────────────
// Single source of truth for which features require Pro.
// Imported by sidebar, index, edge functions, settings.
// ─────────────────────────────────────────────────────────────────

/**
 * Features that require Pro tier.
 * Everything NOT listed here is available in Core.
 */
const PRO_FEATURES = new Set([
  'broadcast',
  'auto_reminders',
  'staff_login',
  'analytics',
]);

/**
 * Check if a feature is available for the given tier.
 * @param {string} tier - 'core' or 'pro'
 * @param {string} feature - feature key from PRO_FEATURES
 * @returns {boolean}
 */
export function hasFeature(tier, feature) {
  if (!PRO_FEATURES.has(feature)) return true; // not gated = always available
  return tier === 'pro';
}

/**
 * Check if any feature in a list is available.
 * Useful for sidebar section visibility.
 */
export function hasAnyFeature(tier, features) {
  return features.some(f => hasFeature(tier, f));
}

/**
 * Get all Pro-only feature keys (for upgrade prompts).
 */
export function getProFeatures() {
  return [...PRO_FEATURES];
}
